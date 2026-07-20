import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetsRoot = path.join(root, "assets");
const scene = JSON.parse(await readFile(path.join(root, "editor", "scenes", "fortaleza-das-correntes.json"), "utf8"));
const catalog = JSON.parse(await readFile(path.join(root, "editor", "scenes", "index.json"), "utf8"));

assert.equal(scene.name, "Fortaleza das Correntes Congeladas");
assert.equal(scene.settings.runtime.legacyArenaBounds, false, "The modular level must not use the legacy arena clamp");
assert.equal(catalog.startupSceneId, "fortaleza-das-correntes", "The new level should boot directly on PS2");
assert(catalog.variables.some((variable) => variable.id === "titan-shards"), "Titan shard persistence variable is missing");

const objectsById = new Map(scene.objects.map((object) => [object.id, object]));
const models = scene.objects.filter((object) => object.source.kind === "model");
const colliders = scene.objects.filter((object) => object.source.kind === "collider");
const checkpoints = colliders.filter((object) => object.checkpoint?.enabled);
const deathZones = colliders.filter((object) => object.gameplay?.deathZone?.enabled);
const pointLights = scene.objects.filter((object) => object.source.kind === "light" && object.light.type === "point");
const particles = scene.objects.filter((object) => object.source.kind === "particle");

assert.equal(models.length, 12, "The scene should stay split into twelve predictable render blocks");
assert.equal(pointLights.length, 2, "AthenaEnv only reserves two local-light slots");
assert.equal(particles.length, 4, "All four braziers should retain visible fire");
assert.equal(checkpoints.length, 3, "Start, arena and sanctuary checkpoints are required");
assert.equal(deathZones.length, 0, "The frozen citadel must not contain death-zone triggers");

let totalTriangles = 0;
for (const model of models) {
  const assetPath = path.join(assetsRoot, ...model.source.asset.split("/"));
  await access(assetPath);
  const source = await readFile(assetPath, "utf8");
  const vertices = (source.match(/^v /gm) || []).length;
  const faces = (source.match(/^f /gm) || []).length;
  assert(vertices > 0 && vertices % 3 === 0, `${model.source.asset} must contain independent triangles`);
  assert(vertices <= 1800, `${model.source.asset} exceeds the AthenaEnv chunk ceiling`);
  assert.equal(faces * 3, vertices, `${model.source.asset} must keep one face per independent triangle`);
  assert.match(source, /^mtllib citadel_frost\.mtl$/m);
  totalTriangles += faces;
}
assert(totalTriangles >= 3500 && totalTriangles <= 6000, `Unexpected PS2 geometry budget: ${totalTriangles} triangles`);

const materialSource = await readFile(path.join(assetsRoot, "citadel_frost.mtl"), "utf8");
const textureReference = materialSource.match(/^map_Kd\s+(.+)$/m)?.[1]?.trim();
assert(textureReference, "Citadel material must reference the shared texture atlas");
await access(path.join(assetsRoot, ...textureReference.split("/")));

const portal = objectsById.get("citadel-exit-portal");
assert(portal?.portal?.enabled, "The altar exit portal is missing");
assert.equal(portal.portal.activation, "onInteract");
const targetScene = catalog.scenes.find((entry) => entry.id === portal.portal.targetSceneId);
assert(targetScene, "The altar portal target scene does not exist");
const targetSceneJson = JSON.parse(await readFile(path.join(root, "editor", "scenes", `${targetScene.id}.json`), "utf8"));
assert(targetSceneJson.objects.some((object) => object.id === portal.portal.targetSpawnId && object.source.kind === "spawn"), "The altar portal target spawn does not exist");

const collectible = objectsById.get("citadel-relic-trigger");
assert.equal(collectible.gameplay.collectible.variableId, "titan-shards");
assert(objectsById.has(collectible.gameplay.collectible.visualTargetId), "Collectible visual target is missing");

function topOfBox(id) {
  const object = objectsById.get(id);
  assert(object, `Missing platform collider: ${id}`);
  return object.position.y + object.scale.y;
}

const ascentTops = [
  topOfBox("citadel-floor-step-1"),
  topOfBox("citadel-floor-step-2"),
  topOfBox("citadel-floor-step-3"),
  topOfBox("citadel-floor-step-4"),
  topOfBox("citadel-floor-upper-bridge"),
  topOfBox("citadel-floor-upper-landing"),
  topOfBox("citadel-floor-sanctum"),
];
for (let index = 1; index < ascentTops.length; index++) {
  assert(ascentTops[index] >= ascentTops[index - 1], "The main ascent must always gain height");
  assert(ascentTops[index] - ascentTops[index - 1] <= 0.8, "A vertical step exceeds the intended jump rhythm");
}

const generatedStartup = await readFile(path.join(assetsRoot, "scene.generated.js"), "utf8");
assert.match(generatedStartup, /"id": "fortaleza-das-correntes"/);
assert.match(generatedStartup, /globalThis\.EDITOR_COLLIDERS = \[/);
assert.match(generatedStartup, /globalThis\.EDITOR_POINT_LIGHTS = \[/);

console.log(`Frozen citadel test passed: ${totalTriangles} triangles, ${models.length} draw blocks, ${colliders.length} colliders.`);
