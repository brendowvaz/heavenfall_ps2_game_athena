import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateAthenaScene, normalizeScene } from "../editor/server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
let source = path.join(projectRoot, "editor", "scene.json");
const destination = path.join(projectRoot, "assets", "scene.generated.js");
let activeSceneId = null;

try {
  const project = JSON.parse(await readFile(path.join(projectRoot, "editor", "scenes", "index.json"), "utf8"));
  if (typeof project.activeSceneId === "string" && project.activeSceneId) {
    const candidate = path.join(projectRoot, "editor", "scenes", `${project.activeSceneId}.json`);
    await readFile(candidate, "utf8");
    source = candidate;
    activeSceneId = project.activeSceneId;
  }
} catch {
  // Legacy projects continue to export editor/scene.json.
}

const scene = normalizeScene(JSON.parse(await readFile(source, "utf8")));
const generated = generateAthenaScene(scene);
await writeFile(destination, generated, "utf8");
if (activeSceneId) {
  const sceneOutput = path.join(projectRoot, "assets", "scenes");
  await mkdir(sceneOutput, { recursive: true });
  await writeFile(path.join(sceneOutput, `${activeSceneId}.generated.js`), generated, "utf8");
}
console.log(`Cena do editor exportada: ${scene.objects.length} registros.`);
