import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { setTimeout as delay } from "node:timers/promises";
import {
  generateAthenaScene,
  generateSceneProjectManifest,
  mergeSceneVariables,
  normalizeScene,
  normalizeSceneProject,
  writeJsonAtomic,
  writeTextIfChangedAtomic,
} from "../editor/server.mjs";
import { withSceneProjectFileLock } from "../editor/scene-project-lock.mjs";

const migrated = normalizeSceneProject({
  version: 1,
  activeSceneId: "level-two",
  variables: [{ id: "has-key", name: "Possui chave", type: "boolean", initialValue: false }],
  scenes: [
    { id: "main", name: "Principal", objectCount: 4 },
    { id: "level-two", name: "Templo", uiCount: 2, graphCount: 1, spawnPoints: [{ id: "temple-gate", name: "Portão", default: true }] },
  ],
});
assert.equal(migrated.version, 3);
assert.equal(migrated.activeSceneId, "level-two");
assert.equal(migrated.startupSceneId, "level-two", "Legacy projects should start from their formerly active scene");
assert.equal(migrated.scenes[1].graphCount, 1);
assert.equal(migrated.scenes[1].spawnPoints[0].id, "temple-gate");
assert.equal(migrated.variables[0].id, "has-key");
assert.deepEqual(
  mergeSceneVariables([
    { logic: { variables: migrated.variables } },
    { logic: { variables: [...migrated.variables, { id: "score", name: "Pontos", type: "number", initialValue: 2 }] } },
  ]).map((variable) => variable.id),
  ["has-key", "score"],
  "Legacy per-scene variables must migrate once into the project catalog",
);

const project = normalizeSceneProject({
  version: 3,
  activeSceneId: "level-two",
  startupSceneId: "main",
  variables: migrated.variables,
  scenes: migrated.scenes,
});
const manifestSandbox = { globalThis: null };
manifestSandbox.globalThis = manifestSandbox;
vm.runInNewContext(generateSceneProjectManifest(project), manifestSandbox);
assert.equal(manifestSandbox.EDITOR_SCENE_PROJECT.startupSceneId, "main");
assert.equal(manifestSandbox.EDITOR_SCENE_PROJECT.version, 2);
assert.equal(manifestSandbox.EDITOR_SCENE_PROJECT.variables[0].id, "has-key");
assert.deepEqual(
  Array.from(manifestSandbox.EDITOR_SCENE_PROJECT.scenes, (entry) => entry.file),
  ["scenes/main.generated.js", "scenes/level-two.generated.js"],
);
assert.deepEqual(
  Array.from(manifestSandbox.EDITOR_SCENE_PROJECT.scenes[1].spawnPoints, (entry) => entry.id),
  ["temple-gate"],
);

const scene = normalizeScene({ name: "Principal", objects: [], ui: [] });
const sceneSandbox = { globalThis: null };
sceneSandbox.globalThis = sceneSandbox;
vm.runInNewContext(generateAthenaScene(scene, { id: "main" }), sceneSandbox);
assert.equal(sceneSandbox.EDITOR_SCENE_META.id, "main");
assert.equal(sceneSandbox.EDITOR_SCENE_META.name, "Principal");
assert.deepEqual(Array.from(sceneSandbox.EDITOR_SPAWN_POINTS), []);
assert.deepEqual(Array.from(sceneSandbox.EDITOR_PORTALS), []);

assert.throws(
  () => normalizeSceneProject({ scenes: [] }),
  /Empty scene project/,
  "A project must always preserve at least one scene",
);

const atomicDirectory = await mkdtemp(path.join(os.tmpdir(), "athena-scenes-"));
try {
  const atomicFile = path.join(atomicDirectory, "index.json");
  const payloads = Array.from({ length: 24 }, (_, index) => ({ version: 2, index }));
  await Promise.all(payloads.map((payload) => writeJsonAtomic(atomicFile, payload)));
  const stored = JSON.parse(await readFile(atomicFile, "utf8"));
  assert.ok(payloads.some((payload) => payload.index === stored.index), "Concurrent atomic writes must leave one complete JSON document");
  assert.deepEqual(await readdir(atomicDirectory), ["index.json"], "Unique temporary files must always be cleaned up");

  await writeTextIfChangedAtomic(atomicFile, "repaired\n");
  assert.equal(await readFile(atomicFile, "utf8"), "repaired\n", "Generated derivatives must be repaired by content, not timestamps");

  let activeLocks = 0;
  let maximumLocks = 0;
  await Promise.all(Array.from({ length: 8 }, () => withSceneProjectFileLock(atomicDirectory, async () => {
    activeLocks++;
    maximumLocks = Math.max(maximumLocks, activeLocks);
    await delay(8);
    activeLocks--;
  })));
  assert.equal(maximumLocks, 1, "Editor and build lock must serialize scene project access across callers");
  assert.ok(!(await readdir(atomicDirectory)).includes(".project.lock"), "Scene project lock must be released after use");

  activeLocks = 0;
  maximumLocks = 0;
  await Promise.all([
    withSceneProjectFileLock(atomicDirectory, async () => {
      activeLocks++;
      maximumLocks = Math.max(maximumLocks, activeLocks);
      await delay(90);
      activeLocks--;
    }, { timeoutMs: 500, staleMs: 25, heartbeatMs: 5 }),
    delay(10).then(() => withSceneProjectFileLock(atomicDirectory, async () => {
      activeLocks++;
      maximumLocks = Math.max(maximumLocks, activeLocks);
      activeLocks--;
    }, { timeoutMs: 500, staleMs: 25, heartbeatMs: 5 })),
  ]);
  assert.equal(maximumLocks, 1, "Heartbeat must prevent a long active operation from being mistaken for a stale lock");
} finally {
  await rm(atomicDirectory, { recursive: true, force: true });
}

const exporterSource = await readFile(new URL("../scripts/export-editor-scene.mjs", import.meta.url), "utf8");
assert.ok(
  exporterSource.includes("for (const id of discoveredIds)") && exporterSource.includes("await writeJsonAtomic(sceneProjectFile, project)"),
  "Build export must reconcile orphan canonical scenes back into the catalog",
);
assert.ok(
  exporterSource.includes("await stageBuildSnapshot()") && exporterSource.includes("await cp(path.join(projectRoot, \"assets\")"),
  "Build must snapshot all assets while holding the shared scene lock",
);
const buildSource = await readFile(new URL("../scripts/build.ps1", import.meta.url), "utf8");
assert.ok(
  buildSource.includes("ATHENA_BUILD_STAGE") && buildSource.includes("[System.IO.FileShare]::None") && buildSource.includes("[guid]::NewGuid()"),
  "Build must consume a unique staged snapshot and reject concurrent dist writers",
);
const serverSource = await readFile(new URL("../editor/server.mjs", import.meta.url), "utf8");
const deleteStart = serverSource.indexOf("async function deleteProjectScene");
const deleteEnd = serverSource.indexOf("async function renameProjectScene", deleteStart);
const deleteSource = serverSource.slice(deleteStart, deleteEnd);
assert.ok(
  deleteSource.indexOf("await writeSceneProjectFiles(project)") < deleteSource.indexOf("await rename("),
  "Scene deletion must commit the catalog before archiving its canonical JSON",
);

console.log("Scene management test passed.");
