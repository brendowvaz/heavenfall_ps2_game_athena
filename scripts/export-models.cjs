// Converts the preserved procedural source into AthenaEnv-safe OBJ chunks.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
let source = fs.readFileSync(path.join(__dirname, "level-source.js"), "utf8");
source = source.replace(
    "const sceneMesh = buildScene();",
    "const sceneMesh = buildScene(); globalThis.__sceneMesh = sceneMesh;"
);
source = source.replace(
    "const playerData = toRenderData(playerMesh);",
    "globalThis.__playerMesh = playerMesh; const playerData = toRenderData(playerMesh);"
);
source = source.replace(
    "while (true) {",
    "for (let __exportFrame = 0; __exportFrame < 0; __exportFrame++) {"
);

class MockFont { print() {} }
class MockRenderData { constructor(vertices) { this.vertices = vertices; } }
class MockRenderObject {
    constructor(data) { this.data = data; }
    render() {}
}

const pad = {
    lx: 0, ly: 0, rx: 0, ry: 0,
    update() {}, justPressed() { return false; }, pressed() { return false; }
};

const context = {
    console, Math, Float32Array,
    Color: { new: (r, g, b, a) => ({ r, g, b, a }) },
    Font: MockFont,
    RenderData: MockRenderData,
    RenderObject: MockRenderObject,
    Screen: {
        CT32: 0, Z16S: 1, DEPTH_TEST_ENABLE: 2, DEPTH_TEST_METHOD: 3, DEPTH_GEQUAL: 4,
        getMode: () => ({ width: 640, height: 448 }),
        setMode() {}, setVSync() {}, setFrameCounter() {}, setParam() {}, clear() {}, flip() {}
    },
    Render: {
        PL_NO_LIGHTS: 0, CULL_FACE_NONE: 0, SHADE_GOURAUD: 1,
        init() {}, setView() {}, begin() {},
        vertexList: (positions, normals, texcoords, colors) => ({ positions, normals, texcoords, colors })
    },
    Camera: { position() {}, target() {}, update() {} },
    Pads: {
        SELECT: 1, START: 2, L1: 3, R3: 4, CROSS: 5,
        get: () => pad
    },
    Draw: { point() {} }
};

vm.runInNewContext(source, context, { filename: "level-source.js", timeout: 10000 });

const outputDir = path.join(root, "assets");
fs.mkdirSync(outputDir, { recursive: true });

function fixed(value) {
    const clean = Math.abs(value) < 0.000001 ? 0 : value;
    return clean.toFixed(6).replace(/\.?0+$/, "");
}

function semanticTile(r, g, b, triangle) {
    const hash = Math.floor(triangle / 3);

    // Warm materials and near-black metal use the chain tile (row 4, col 2).
    if (r > g * 1.35 || (r > 0.075 && g < 0.13 && b < 0.13)) return 13;

    // Deep cracks and the far fog curtain use dark rock/mountain tiles.
    if (r < 0.08 && g < 0.13 && b < 0.19) return hash % 2 === 0 ? 5 : 9;

    // Bright ice, crystals and the player use pale ice, star and icicle tiles.
    if (b > 0.68 && g > 0.52) return [10, 6, 3][hash % 3];

    // Saturated blue surfaces are ice cliffs or distant frozen mountains.
    if (b > g * 1.22 && g > r * 1.25) return [0, 1, 9, 11][hash % 4];

    // Neutral stone is routed to cracked slabs and gothic architectural panels.
    if (b - r < 0.17) return [2, 4, 7, 8, 12, 14, 15][hash % 7];

    // General frozen floor alternates between four related cracked-ice plates.
    return [0, 2, 7, 10][hash % 4];
}

function triangleUV(mesh, vertex) {
    const triangle = Math.floor(vertex / 3) * 3;
    let red = 0;
    let green = 0;
    let blue = 0;
    for (let i = 0; i < 3; i++) {
        red += mesh.colors[(triangle + i) * 4];
        green += mesh.colors[(triangle + i) * 4 + 1];
        blue += mesh.colors[(triangle + i) * 4 + 2];
    }
    const tile = semanticTile(red / 3, green / 3, blue / 3, triangle);
    const column = tile % 4;
    const row = Math.floor(tile / 4);
    const margin = 0.0078125;
    const u0 = column * 0.25 + margin;
    const u1 = (column + 1) * 0.25 - margin;
    const v0 = 1.0 - (row + 1) * 0.25 + margin;
    const v1 = 1.0 - row * 0.25 - margin;
    const corner = vertex % 6;
    const corners = [
        [u0, v1], [u1, v1], [u1, v0],
        [u0, v1], [u1, v0], [u0, v0]
    ];
    return corners[corner];
}

function writeObj(filename, mesh, firstVertex, endVertex) {
    const lines = [
        "# Ruinas do Veu Azul - PS2 procedural export",
        "mtllib frost_atlas.mtl",
        "usemtl frost_atlas",
        `o ${path.basename(filename, ".obj")}`,
        "s off"
    ];
    for (let vertex = firstVertex; vertex < endVertex; vertex++) {
        const offset = vertex * 4;
        lines.push(
            "v " + fixed(mesh.positions[offset]) + " " + fixed(mesh.positions[offset + 1]) + " " + fixed(mesh.positions[offset + 2]) +
            " " + fixed(mesh.colors[offset]) + " " + fixed(mesh.colors[offset + 1]) + " " + fixed(mesh.colors[offset + 2])
        );
    }
    for (let vertex = firstVertex; vertex < endVertex; vertex++) {
        const offset = vertex * 4;
        lines.push("vn " + fixed(mesh.normals[offset]) + " " + fixed(mesh.normals[offset + 1]) + " " + fixed(mesh.normals[offset + 2]));
    }
    for (let vertex = firstVertex; vertex < endVertex; vertex++) {
        const uv = triangleUV(mesh, vertex);
        lines.push("vt " + fixed(uv[0]) + " " + fixed(uv[1]));
    }
    const count = endVertex - firstVertex;
    for (let local = 0; local < count; local += 3) {
        const a = local + 1;
        lines.push(`f ${a}/${a}/${a} ${a + 1}/${a + 1}/${a + 1} ${a + 2}/${a + 2}/${a + 2}`);
    }
    fs.writeFileSync(path.join(outputDir, filename), lines.join("\n") + "\n");
}

const scene = context.__sceneMesh;
const sceneVertices = scene.positions.length / 4;
const chunkSize = 1800;
let chunks = 0;
for (let first = 0; first < sceneVertices; first += chunkSize) {
    const last = Math.min(sceneVertices, first + chunkSize);
    writeObj(`scene_${chunks}.obj`, scene, first, last);
    chunks++;
}
writeObj("player.obj", context.__playerMesh, 0, context.__playerMesh.positions.length / 4);

fs.writeFileSync(
    path.join(outputDir, "frost_atlas.mtl"),
    "# Textured material for the frozen ruins\n" +
    "newmtl frost_atlas\n" +
    "Ka 0.32 0.40 0.52\n" +
    "Kd 1.0 1.0 1.0\n" +
    "Ks 0.18 0.24 0.30\n" +
    "Ns 24.0\n" +
    "d 1.0\n" +
    "illum 2\n" +
    "map_Kd Textures/ice_ruins_atlas.png\n"
);

fs.writeFileSync(
    path.join(outputDir, "manifest.json"),
    JSON.stringify({ sceneChunks: chunks, sceneVertices, playerVertices: context.__playerMesh.positions.length / 4 }, null, 2) + "\n"
);

console.log(`Exported ${sceneVertices} scene vertices in ${chunks} OBJ chunks.`);
