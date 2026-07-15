import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateAthenaScene,
  generateSceneProjectManifest,
  normalizeScene,
  normalizeSceneProject,
} from "../editor/server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const editorRoot = path.join(projectRoot, "editor");
const sceneProjectFile = path.join(editorRoot, "scenes", "index.json");
const generatedScenesRoot = path.join(projectRoot, "assets", "scenes");
const generatedSceneFile = path.join(projectRoot, "assets", "scene.generated.js");

let project;
try {
  project = normalizeSceneProject(JSON.parse(await readFile(sceneProjectFile, "utf8")));
} catch {
  const legacy = normalizeScene(JSON.parse(await readFile(path.join(editorRoot, "scene.json"), "utf8")));
  project = {
    version: 2,
    activeSceneId: "main",
    startupSceneId: "main",
    scenes: [{ id: "main", name: legacy.name, updatedAt: new Date(0).toISOString() }],
  };
}

await mkdir(generatedScenesRoot, { recursive: true });
const loadedScenes = new Map();
for (const entry of project.scenes) {
  const source = path.join(editorRoot, "scenes", `${entry.id}.json`);
  let scene;
  try {
    scene = normalizeScene(JSON.parse(await readFile(source, "utf8")));
  } catch {
    if (project.scenes.length !== 1) throw new Error(`Não foi possível exportar a cena ${entry.id}.`);
    scene = normalizeScene(JSON.parse(await readFile(path.join(editorRoot, "scene.json"), "utf8")));
  }
  loadedScenes.set(entry.id, scene);
  entry.name = scene.name;
  entry.objectCount = scene.objects.length;
  entry.uiCount = scene.ui.length;
  entry.graphCount = scene.logic.graphs.length;
  await writeFile(
    path.join(generatedScenesRoot, `${entry.id}.generated.js`),
    generateAthenaScene(scene, { id: entry.id }),
    "utf8",
  );
}

const startup = loadedScenes.get(project.startupSceneId);
if (!startup) throw new Error("A cena inicial do projeto não existe.");
await writeFile(generatedSceneFile, generateAthenaScene(startup, { id: project.startupSceneId }), "utf8");
await writeFile(
  path.join(generatedScenesRoot, "project.generated.js"),
  generateSceneProjectManifest(project),
  "utf8",
);

console.log(`${project.scenes.length} cena(s) exportada(s); inicial: ${project.startupSceneId}.`);
