// Desktop smoke test: checks the procedural build without requiring AthenaEnv.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const sourcePath = path.join(__dirname, "..", "main.js");
let source = fs.readFileSync(sourcePath, "utf8");
source = source.replace(
    "while (true) {",
    "globalThis.__levelTest = { baseWalkable, isPlayerValid, applyMovement, colliderHits, getPlayer: () => ({ x: playerX, z: playerZ }) }; for (let __smokeFrame = 0; __smokeFrame < 2; __smokeFrame++) {"
);

let vertexCount = 0;
let drawCalls = 0;
const assetLoads = [];
const manifest = require(path.join(__dirname, "..", "assets", "manifest.json"));

class MockFont {
    print() {}
}

class MockRenderData {
    constructor(vertices) {
        this.vertices = vertices;
        if (typeof vertices === "string") assetLoads.push(vertices);
    }
}

class MockRenderObject {
    constructor(data) {
        this.data = data;
        this.position = { x: 0, y: 0, z: 0 };
        this.rotation = { x: 0, y: 0, z: 0 };
    }
    render() {
        drawCalls++;
    }
}

const neutralPad = {
    lx: 0, ly: -127, rx: 0, ry: 0, btns: 0,
    update() {},
    justPressed() { return false; },
    pressed() { return false; }
};

const context = {
    console,
    Math,
    Float32Array,
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
        PL_NO_LIGHTS: 0, PL_DEFAULT: 1, CULL_FACE_NONE: 0, SHADE_GOURAUD: 1,
        init() {}, setView() {}, begin() {},
        vertexList(positions, normals, texcoords, colors) {
            vertexCount += positions.length / 4;
            return { positions, normals, texcoords, colors };
        }
    },
    Camera: { position() {}, target() {}, update() {} },
    os: { chdir() {} },
    std: {
        exists(filename) {
            return fs.existsSync(path.join(__dirname, "..", "assets", filename));
        },
        loadScript(filename) {
            const generated = fs.readFileSync(path.join(__dirname, "..", "assets", filename), "utf8");
            const sceneMatch = generated.match(/globalThis\.EDITOR_SCENE\s*=\s*([\s\S]*?);\s*globalThis\.EDITOR_COLLIDERS/);
            const colliderMatch = generated.match(/globalThis\.EDITOR_COLLIDERS\s*=\s*([\s\S]*?);\s*$/);
            context.EDITOR_SCENE = JSON.parse(sceneMatch[1]);
            context.EDITOR_COLLIDERS = JSON.parse(colliderMatch[1]);
        }
    },
    Lights: {
        DIRECTION: 0, AMBIENT: 1, DIFFUSE: 2,
        new: () => ({}), set() {}
    },
    Pads: {
        SELECT: 1, START: 2, L1: 3, R3: 4, CROSS: 5,
        LEFT: 6, RIGHT: 7, UP: 8, DOWN: 9,
        get: () => neutralPad
    },
    Draw: { point() {}, rect() {} }
};

vm.runInNewContext(source, context, { filename: sourcePath, timeout: 5000 });

if (manifest.sceneVertices < 1000 || manifest.sceneVertices > 30000) {
    throw new Error(`Unexpected geometry budget: ${manifest.sceneVertices} vertices`);
}
if (assetLoads.length !== manifest.sceneChunks + 1) {
    throw new Error(`Expected ${manifest.sceneChunks + 1} OBJ loads, received ${assetLoads.length}`);
}
if (drawCalls !== (manifest.sceneChunks + 1) * 2) {
    throw new Error(`Unexpected draw-call count over two frames: ${drawCalls}`);
}
if (!context.__levelTest.isPlayerValid(0, 18)) {
    throw new Error("Spawn point must be walkable");
}
for (const [x, z] of [[0.125, 18], [-0.125, 18], [0, 18.125], [0, 17.875]]) {
    if (!context.__levelTest.isPlayerValid(x, z)) {
        throw new Error(`Movement next to spawn must be valid at ${x}, ${z}`);
    }
}
if (context.__levelTest.isPlayerValid(20, 0)) {
    throw new Error("The eastern chasm must not be walkable");
}
if (context.__levelTest.isPlayerValid(-2.8, -1.5)) {
    throw new Error("The main ice spire must block the player");
}
const testBox = {
    shape: "box",
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: Math.PI / 4, z: 0 },
    scale: { x: 1, y: 1, z: 2 },
    trigger: false
};
if (!context.__levelTest.colliderHits(0.5, 0.0, 0.2, testBox)) {
    throw new Error("Rotated box collider must detect an interior point");
}
if (context.__levelTest.colliderHits(8.0, 8.0, 0.2, testBox)) {
    throw new Error("Box collider must reject a distant point");
}
testBox.trigger = true;
if (context.__levelTest.colliderHits(0.0, 0.0, 0.2, testBox)) {
    throw new Error("Trigger colliders must not block movement");
}
if (context.__levelTest.getPlayer().z >= 17.9) {
    throw new Error("Forward input must decrease Z inside the entrance corridor");
}
const beforeHorizontal = context.__levelTest.getPlayer().x;
context.__levelTest.applyMovement(0.125, 0.0);
if (context.__levelTest.getPlayer().x <= beforeHorizontal) {
    throw new Error("Horizontal input must increase X independently of Z");
}

console.log(`Smoke test passed: ${manifest.sceneVertices + manifest.playerVertices} OBJ vertices, ${drawCalls / 2} draw calls/frame.`);
