import { copyFile, cp, mkdir, readFile, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateAthenaScene,
  generateSceneProjectManifest,
  normalizeScene,
  normalizeSceneProject,
  writeJsonAtomic,
  writeTextIfChangedAtomic,
} from "../editor/server.mjs";
import { withSceneProjectFileLock } from "../editor/scene-project-lock.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const editorRoot = path.join(projectRoot, "editor");
const scenesRoot = path.join(editorRoot, "scenes");
const sceneProjectFile = path.join(scenesRoot, "index.json");
const generatedScenesRoot = path.join(projectRoot, "assets", "scenes");
const generatedSceneFile = path.join(projectRoot, "assets", "scene.generated.js");

async function stageBuildSnapshot() {
  if (!process.env.ATHENA_BUILD_STAGE) return;
  const buildRoot = path.join(projectRoot, "build");
  const stageRoot = path.resolve(process.env.ATHENA_BUILD_STAGE);
  const relative = path.relative(buildRoot, stageRoot);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("ATHENA_BUILD_STAGE precisa apontar para uma subpasta de build.");
  }
  await mkdir(stageRoot, { recursive: true });
  await cp(path.join(projectRoot, "assets"), path.join(stageRoot, "assets"), { recursive: true, force: true });
  await copyFile(path.join(projectRoot, "main.js"), path.join(stageRoot, "main.js"));
  await copyFile(path.join(projectRoot, "athena.ini"), path.join(stageRoot, "athena.ini"));
}

async function canonicalSceneIds() {
  return (await readdir(scenesRoot, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "index.json")
    .map((entry) => entry.name.slice(0, -5))
    .filter((id) => /^[a-z0-9_-]+$/.test(id))
    .sort((left, right) => left === "main" ? -1 : right === "main" ? 1 : left.localeCompare(right));
}

async function readCanonicalScene(id) {
  try {
    return normalizeScene(JSON.parse(await readFile(path.join(scenesRoot, `${id}.json`), "utf8")));
  } catch (error) {
    throw new Error(`Não foi possível exportar a cena ${id}; nenhum fallback foi usado: ${error.message}`);
  }
}

function sceneSummary(scene) {
  return {
    name: scene.name,
    objectCount: scene.objects.length,
    uiCount: scene.ui.length,
    graphCount: scene.logic.graphs.length,
    spawnPoints: scene.objects
      .filter((item) => item.source.kind === "spawn" && item.runtime && item.visible)
      .map((item) => ({ id: item.id, name: item.name, default: item.spawn?.default === true })),
  };
}

await withSceneProjectFileLock(scenesRoot, async () => {
  const discoveredIds = await canonicalSceneIds();
  let project;
  try {
    project = normalizeSceneProject(JSON.parse(await readFile(sceneProjectFile, "utf8")));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw new Error(`O catálogo de cenas está inválido e foi preservado: ${error.message}`);
    }
    if (discoveredIds.length === 0) {
      const legacy = normalizeScene(JSON.parse(await readFile(path.join(editorRoot, "scene.json"), "utf8")));
      await writeJsonAtomic(path.join(scenesRoot, "main.json"), legacy);
      discoveredIds.push("main");
    }
    let activeSceneId = discoveredIds.includes("main") ? "main" : discoveredIds[0];
    try {
      const legacyMirror = normalizeScene(JSON.parse(await readFile(path.join(editorRoot, "scene.json"), "utf8")));
      for (const id of discoveredIds) {
        const canonical = await readCanonicalScene(id);
        if (JSON.stringify(canonical) === JSON.stringify(legacyMirror) || canonical.name === legacyMirror.name) {
          activeSceneId = id;
          break;
        }
      }
    } catch {
      // Canonical scenes are enough to rebuild the project.
    }
    let startupSceneId = activeSceneId;
    try {
      const generatedStartup = await readFile(generatedSceneFile, "utf8");
      const match = generatedStartup.match(/globalThis\.EDITOR_SCENE_META\s*=\s*\{\s*"id"\s*:\s*"([a-z0-9_-]+)"/);
      if (match && discoveredIds.includes(match[1])) startupSceneId = match[1];
    } catch {
      // Use the recovered active scene when no startup derivative exists.
    }
    project = normalizeSceneProject({
      version: 2,
      activeSceneId,
      startupSceneId,
      scenes: discoveredIds.map((id) => ({ id, name: id, updatedAt: new Date(0).toISOString() })),
    });
  }

  const discoveredSet = new Set(discoveredIds);
  for (const entry of project.scenes) {
    if (!discoveredSet.has(entry.id)) {
      throw new Error(`A cena ${entry.id} está no catálogo, mas seu JSON canônico está ausente.`);
    }
  }
  const knownIds = new Set(project.scenes.map((entry) => entry.id));
  for (const id of discoveredIds) {
    if (knownIds.has(id)) continue;
    const info = await stat(path.join(scenesRoot, `${id}.json`));
    project.scenes.push({ id, name: id, updatedAt: info.mtime.toISOString() });
    knownIds.add(id);
  }
  project = normalizeSceneProject(project);

  const loadedScenes = new Map();
  for (const entry of project.scenes) {
    const scene = await readCanonicalScene(entry.id);
    loadedScenes.set(entry.id, scene);
    Object.assign(entry, sceneSummary(scene));
  }

  // The index is the canonical commit. Generated scripts are deterministic
  // derivatives and are repaired by content whenever editor or build runs.
  await writeJsonAtomic(sceneProjectFile, project);
  await mkdir(generatedScenesRoot, { recursive: true });
  for (const entry of project.scenes) {
    await writeTextIfChangedAtomic(
      path.join(generatedScenesRoot, `${entry.id}.generated.js`),
      generateAthenaScene(loadedScenes.get(entry.id), { id: entry.id }),
    );
  }

  const startup = loadedScenes.get(project.startupSceneId);
  if (!startup) throw new Error("A cena inicial do projeto não existe.");
  await writeTextIfChangedAtomic(
    generatedSceneFile,
    generateAthenaScene(startup, { id: project.startupSceneId }),
  );
  await writeTextIfChangedAtomic(
    path.join(generatedScenesRoot, "project.generated.js"),
    generateSceneProjectManifest(project),
  );

  const expectedGenerated = new Set([
    "project.generated.js",
    ...project.scenes.map((entry) => `${entry.id}.generated.js`),
  ]);
  for (const entry of await readdir(generatedScenesRoot, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".generated.js") && !expectedGenerated.has(entry.name)) {
      await unlink(path.join(generatedScenesRoot, entry.name));
    }
  }

  // Build consumes this immutable snapshot after the lock is released, so a
  // save/import in the editor cannot produce a half-old, half-new dist folder.
  await stageBuildSnapshot();

  console.log(`${project.scenes.length} cena(s) exportada(s); inicial: ${project.startupSceneId}.`);
});
