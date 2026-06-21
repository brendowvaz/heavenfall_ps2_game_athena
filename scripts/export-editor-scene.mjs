import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateAthenaScene, normalizeScene } from "../editor/server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const source = path.join(projectRoot, "editor", "scene.json");
const destination = path.join(projectRoot, "assets", "scene.generated.js");

const scene = normalizeScene(JSON.parse(await readFile(source, "utf8")));
await writeFile(destination, generateAthenaScene(scene), "utf8");
console.log(`Cena do editor exportada: ${scene.objects.length} registros.`);
