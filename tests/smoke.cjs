// Desktop smoke test: checks the procedural build without requiring AthenaEnv.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const sourcePath = path.join(__dirname, "..", "main.js");
let source = fs.readFileSync(sourcePath, "utf8");
const editorSource = fs.readFileSync(path.join(__dirname, "..", "editor", "app.js"), "utf8");
const editorHtml = fs.readFileSync(path.join(__dirname, "..", "editor", "index.html"), "utf8");
for (const marker of ["applyPointerSnap", "togglePivotEditing", "finishBoxSelection", "toggleIsolation", "setupPanelAccordions", "collapsedHierarchy", "applyRecordMaterial", "createLightObject", "applyCampfirePreset", "openCameraPreview", "renderTriggerEvents", "addTriggerAction", "renderUiPreview", "addUiElement", "switchProjectScene", "createProjectScene"]) {
    if (!editorSource.includes(marker)) throw new Error(`Editor tool missing: ${marker}`);
}
for (const id of ["snap-mode", "pivot-button", "box-select-button", "selection-marquee", "isolate-selection-button", "material-section", "light-section", "light-flicker", "light-campfire-preset", "camera-section", "camera-mode", "camera-preview", "trigger-events-editor", "event-action-type", "event-add-button", "scene-picker", "duplicate-scene-button", "ui-mode-button", "ui-editor", "ui-canvas", "ui-inspector"]) {
    if (!editorHtml.includes(`id="${id}"`)) throw new Error(`Editor control missing: ${id}`);
}
source = source.replace(
    "while (true) {",
    "globalThis.__levelTest = { baseWalkable, isPlayerValid, applyMovement, colliderHits, updateVerticalMovement, executeAction: executeRuntimeAction, getRuntimeMessage: () => runtimeMessageText, getVisibility: (id) => runtimeObjectVisibility[id], getColliders: () => collisionShapes, setPlayer: (state) => { playerX = state.x; playerY = state.y; playerZ = state.z; playerVelocityY = state.velocityY; playerGrounded = state.grounded; }, getPlayer: () => ({ x: playerX, y: playerY, z: playerZ, velocityY: playerVelocityY, grounded: playerGrounded }) }; for (let __smokeFrame = 0; __smokeFrame < 2; __smokeFrame++) {"
);

let vertexCount = 0;
let drawCalls = 0;
const fontPrints = [];
const rectCalls = [];
let nextLightId = 0;
const lightSetCalls = [];
const assetLoads = [];
const manifest = require(path.join(__dirname, "..", "assets", "manifest.json"));
let sandbox;

class MockFont {
    print(x, y, text) { fontPrints.push({ x, y, text }); }
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
    justPressed(button) { return button === 10; },
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
            const script = fs.readFileSync(path.join(__dirname, "..", "assets", filename), "utf8");
            vm.runInContext(script, sandbox, { filename });
            if (filename === "scene.generated.js") {
                sandbox.EDITOR_COLLIDERS.push({
                    id: "smoke-trigger",
                    name: "Smoke trigger",
                    shape: "sphere",
                    position: { x: 0, y: 1, z: 18 },
                    rotation: { x: 0, y: 0, z: 0 },
                    scale: { x: 1, y: 1, z: 1 },
                    trigger: true,
                    cameraBlocker: false
                });
                sandbox.EDITOR_EVENTS.push({
                    triggerId: "smoke-trigger",
                    onEnter: [{ id: "smoke-message", type: "message", text: "Evento executado no runtime", duration: 120 }],
                    onExit: [],
                    onInteract: []
                });
                for (let index = 0; index < 4; index++) {
                    sandbox.EDITOR_LIGHTS.push({
                        id: `smoke-global-${index}`,
                        name: `Smoke global ${index}`,
                        type: "directional",
                        color: { r: 0.2, g: 0.2, b: 0.2 },
                        intensity: 0.1,
                        direction: { x: 0, y: 1, z: 0 }
                    });
                }
                sandbox.EDITOR_POINT_LIGHTS.push({
                    id: "smoke-campfire",
                    name: "Smoke campfire",
                    type: "point",
                    color: { r: 1, g: 0.5, b: 0.2 },
                    intensity: 2.5,
                    distance: 30,
                    position: { x: 0, y: 3, z: 0 },
                    flicker: true,
                    flickerAmount: 0.25,
                    flickerSpeed: 7.5
                });
                sandbox.EDITOR_UI.push(
                    { id: "smoke-panel", type: "panel", x: 12, y: 24, width: 180, height: 40, background: { r: 10, g: 20, b: 30, a: 96 } },
                    { id: "smoke-text", type: "text", x: 20, y: 30, width: 160, height: 20, text: "UI runtime", fontScale: 0.5, color: { r: 240, g: 230, b: 210, a: 128 }, align: "left" }
                );
            }
        }
    },
    Lights: {
        DIRECTION: 0, AMBIENT: 1, DIFFUSE: 2,
        new: () => ({ id: ++nextLightId }),
        set(light, property, x, y, z) { lightSetCalls.push({ id: light.id, property, x, y, z }); }
    },
    Pads: {
        SELECT: 1, START: 2, L1: 3, R3: 4, CROSS: 5,
        LEFT: 6, RIGHT: 7, UP: 8, DOWN: 9, SQUARE: 10, TRIANGLE: 11,
        get: () => neutralPad
    },
    Draw: { point() {}, rect(x, y, width, height, color) { rectCalls.push({ x, y, width, height, color }); } }
};

sandbox = vm.createContext(context);
vm.runInContext(source, sandbox, { filename: sourcePath, timeout: 5000 });

if (!Array.isArray(context.EDITOR_LIGHTS) || !Array.isArray(context.EDITOR_POINT_LIGHTS) || !Array.isArray(context.EDITOR_EVENTS) || !Array.isArray(context.EDITOR_UI) || !("EDITOR_CAMERA" in context)) {
    throw new Error("Generated scene must expose lights, events, interface and active camera contracts");
}
if (!fontPrints.some((entry) => entry.text === "UI runtime")) throw new Error("Exported UI text must be drawn by Font in the runtime loop");
if (!rectCalls.some((entry) => entry.x === 12 && entry.y === 24 && entry.width === 180 && entry.height === 40)) {
    throw new Error("Exported UI panels must be drawn by Draw.rect in runtime coordinates");
}

if (manifest.sceneVertices < 1000 || manifest.sceneVertices > 30000) {
    throw new Error(`Unexpected geometry budget: ${manifest.sceneVertices} vertices`);
}
const expectedRuntimeObjects = context.EDITOR_SCENE.length + 1;
if (assetLoads.length !== expectedRuntimeObjects) {
    throw new Error(`Expected ${expectedRuntimeObjects} OBJ loads, received ${assetLoads.length}`);
}
if (drawCalls !== expectedRuntimeObjects * 2) {
    throw new Error(`Unexpected draw-call count over two frames: ${drawCalls}`);
}
if (nextLightId !== 4) {
    throw new Error(`Athena light budget must remain at four slots, received ${nextLightId}`);
}
const diffuseUpdates = new Map();
for (const call of lightSetCalls.filter((entry) => entry.property === context.Lights.DIFFUSE)) {
    diffuseUpdates.set(call.id, (diffuseUpdates.get(call.id) || 0) + 1);
}
if (Math.max(...diffuseUpdates.values()) <= expectedRuntimeObjects) {
    throw new Error("Simulated point lights must be updated for each runtime object");
}
if (context.__levelTest.getRuntimeMessage() !== "Evento executado no runtime") {
    throw new Error("Trigger onEnter message must execute in the runtime loop");
}
const postLoopPlayer = context.__levelTest.getPlayer();
const visibilityTarget = context.EDITOR_SCENE[0].id;
context.__levelTest.executeAction({ type: "visibility", targetIds: [visibilityTarget], mode: "hide" });
if (context.__levelTest.getVisibility(visibilityTarget) !== false) {
    throw new Error("Visibility actions must affect runtime objects");
}
context.__levelTest.executeAction({ type: "teleport", position: { x: 2, y: 0.08, z: 16 } });
if (context.__levelTest.getPlayer().x !== 2 || context.__levelTest.getPlayer().z !== 16) {
    throw new Error("Teleport actions must affect the runtime player");
}
context.__levelTest.setPlayer(postLoopPlayer);
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

const Collision3D = context.Collision3D;
const pitchedBox = Collision3D.normalize({
    id: "pitched-box",
    shape: "box",
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: Math.PI / 2, y: 0, z: 0 },
    scale: { x: 0.5, y: 2.0, z: 0.5 }
}, 0);
if (!Collision3D.sphereHits(pitchedBox, 0, 0, 1.5, 0.1)) {
    throw new Error("Box pitch/roll exported by the editor must affect collision");
}
if (Collision3D.sphereHits(pitchedBox, 0, 1.5, 0, 0.1)) {
    throw new Error("Rotated box must not retain its unrotated vertical extent");
}

const highBox = Collision3D.normalize({
    id: "high-box",
    shape: "box",
    position: { x: 0, y: 6, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 2, y: 1, z: 2 }
}, 0);
if (Collision3D.playerContacts([highBox], 0, 0.08, 0, 0.68, 2.25, false).length !== 0) {
    throw new Error("A collider above the player must not block ground movement");
}

const capsule = Collision3D.normalize({
    id: "capsule",
    shape: "capsule",
    position: { x: 0, y: 1, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 0.5, y: 0.75, z: 2.0 }
}, 0);
if (!Collision3D.sphereHits(capsule, 0, 1, 3.5, 0.1)) {
    throw new Error("Capsule collision must match the editor's scaled end caps");
}
if (Collision3D.sphereHits(capsule, 1.0, 1, 0, 0.1)) {
    throw new Error("Capsule radial scale must be respected");
}

const trigger = Collision3D.normalize({
    id: "trigger",
    shape: "sphere",
    position: { x: 0, y: 1, z: 0 },
    scale: { x: 2, y: 2, z: 2 },
    trigger: true,
    cameraBlocker: true
}, 0);
if (Collision3D.playerContacts([trigger], 0, 0.08, 0, 0.68, 2.25, false).length !== 0 ||
    Collision3D.playerContacts([trigger], 0, 0.08, 0, 0.68, 2.25, true).length !== 1) {
    throw new Error("Triggers must be detectable without blocking the player");
}
if (Collision3D.cameraBlocked([trigger], 0, 1, 0, 0.35)) {
    throw new Error("Trigger colliders must not block the camera");
}

const overlapA = [{ id: "a" }];
if (!Collision3D.transitionAllowed(overlapA, overlapA)) {
    throw new Error("A player spawned inside a collider must be allowed to escape");
}
if (Collision3D.transitionAllowed(overlapA, [{ id: "a" }, { id: "b" }])) {
    throw new Error("Escaping overlap must not permit entering another collider");
}
if (context.__levelTest.getPlayer().z >= 17.9) {
    throw new Error("Forward input must decrease Z inside the entrance corridor");
}
const beforeHorizontal = context.__levelTest.getPlayer().x;
context.__levelTest.applyMovement(0.125, 0.0);
if (context.__levelTest.getPlayer().x <= beforeHorizontal) {
    throw new Error("Horizontal input must increase X independently of Z");
}
if (context.__levelTest.getPlayer().y <= 0.08) {
    throw new Error("Square input must raise the player above the ground");
}

const runtimeColliders = context.__levelTest.getColliders();
runtimeColliders.push(Collision3D.normalize({
    id: "walk-off-platform",
    shape: "box",
    position: { x: 0, y: 1, z: 18 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    trigger: false,
    cameraBlocker: false
}, runtimeColliders.length));

context.__levelTest.setPlayer({ x: 0, y: 2.01, z: 18, velocityY: 0, grounded: true });
context.__levelTest.updateVerticalMovement();
if (!context.__levelTest.getPlayer().grounded) {
    throw new Error("Player standing on a collider must remain grounded");
}

context.__levelTest.applyMovement(2.0, 0.0);
context.__levelTest.updateVerticalMovement();
if (context.__levelTest.getPlayer().grounded) {
    throw new Error("Walking beyond a collider edge must clear grounded state");
}
const edgeHeight = context.__levelTest.getPlayer().y;
context.__levelTest.updateVerticalMovement();
context.__levelTest.updateVerticalMovement();
if (context.__levelTest.getPlayer().y >= edgeHeight) {
    throw new Error("Player must fall after walking off a collider");
}
runtimeColliders.pop();

console.log(`Smoke test passed: ${manifest.sceneVertices + manifest.playerVertices} OBJ vertices, ${drawCalls / 2} draw calls/frame.`);
