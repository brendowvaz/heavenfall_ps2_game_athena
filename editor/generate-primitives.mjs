import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { OBJExporter } from "three/addons/exporters/OBJExporter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(__dirname, "..", "assets", "editor_primitives");
await mkdir(output, { recursive: true });

const geometries = {
  cube: new THREE.BoxGeometry(2, 2, 2),
  sphere: new THREE.SphereGeometry(1, 16, 12),
  cylinder: new THREE.CylinderGeometry(1, 1, 2, 16),
  cone: new THREE.ConeGeometry(1, 2, 16),
  plane: new THREE.PlaneGeometry(6, 6, 1, 1).rotateX(-Math.PI / 2),
};

const exporter = new OBJExporter();
for (const [name, geometry] of Object.entries(geometries)) {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  mesh.name = name;
  mesh.updateMatrixWorld(true);
  const obj = exporter.parse(mesh);
  const lines = obj.split(/\r?\n/);
  lines.splice(1, 0, "mtllib primitive.mtl", "usemtl ice_editor");
  await writeFile(path.join(output, `${name}.obj`), `${lines.join("\n")}\n`, "utf8");
  geometry.dispose();
}

await writeFile(
  path.join(output, "primitive.mtl"),
  [
    "# Athena Visual Editor primitive material",
    "newmtl ice_editor",
    "Ka 0.16 0.28 0.35",
    "Kd 0.35 0.74 0.90",
    "Ks 0.18 0.28 0.34",
    "Ns 18.0",
    "d 1.0",
    "illum 2",
    "",
  ].join("\n"),
  "utf8",
);

console.log(`Primitivas exportadas para ${output}`);

