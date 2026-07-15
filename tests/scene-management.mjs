import assert from "node:assert/strict";
import vm from "node:vm";
import {
  generateAthenaScene,
  generateSceneProjectManifest,
  normalizeScene,
  normalizeSceneProject,
} from "../editor/server.mjs";

const migrated = normalizeSceneProject({
  version: 1,
  activeSceneId: "level-two",
  scenes: [
    { id: "main", name: "Principal", objectCount: 4 },
    { id: "level-two", name: "Templo", uiCount: 2, graphCount: 1 },
  ],
});
assert.equal(migrated.version, 2);
assert.equal(migrated.activeSceneId, "level-two");
assert.equal(migrated.startupSceneId, "level-two", "Legacy projects should start from their formerly active scene");
assert.equal(migrated.scenes[1].graphCount, 1);

const project = normalizeSceneProject({
  version: 2,
  activeSceneId: "level-two",
  startupSceneId: "main",
  scenes: migrated.scenes,
});
const manifestSandbox = { globalThis: null };
manifestSandbox.globalThis = manifestSandbox;
vm.runInNewContext(generateSceneProjectManifest(project), manifestSandbox);
assert.equal(manifestSandbox.EDITOR_SCENE_PROJECT.startupSceneId, "main");
assert.deepEqual(
  Array.from(manifestSandbox.EDITOR_SCENE_PROJECT.scenes, (entry) => entry.file),
  ["scenes/main.generated.js", "scenes/level-two.generated.js"],
);

const scene = normalizeScene({ name: "Principal", objects: [], ui: [] });
const sceneSandbox = { globalThis: null };
sceneSandbox.globalThis = sceneSandbox;
vm.runInNewContext(generateAthenaScene(scene, { id: "main" }), sceneSandbox);
assert.equal(sceneSandbox.EDITOR_SCENE_META.id, "main");
assert.equal(sceneSandbox.EDITOR_SCENE_META.name, "Principal");

assert.throws(
  () => normalizeSceneProject({ scenes: [] }),
  /Empty scene project/,
  "A project must always preserve at least one scene",
);

console.log("Scene management test passed.");
