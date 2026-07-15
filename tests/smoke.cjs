// Desktop smoke test: checks the procedural build without requiring AthenaEnv.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const sourcePath = path.join(__dirname, "..", "main.js");
let source = fs.readFileSync(sourcePath, "utf8");
const editorSource = fs.readFileSync(path.join(__dirname, "..", "editor", "app.js"), "utf8");
const editorHtml = fs.readFileSync(path.join(__dirname, "..", "editor", "index.html"), "utf8");
const particleAssetDir = path.join(__dirname, "..", "assets", "editor_particles");
for (const preset of ["fire", "smoke", "sparks"]) {
    const objectSource = fs.readFileSync(path.join(particleAssetDir, `${preset}.obj`), "utf8");
    const materialLibrary = objectSource.match(/^mtllib\s+(.+)$/m)?.[1]?.trim();
    if (!materialLibrary) throw new Error(`Particle ${preset} must reference a material library`);
    const materialSource = fs.readFileSync(path.join(particleAssetDir, materialLibrary), "utf8");
    const materialCount = (materialSource.match(/^newmtl\s+/gm) || []).length;
    if (materialCount !== 1) {
        throw new Error(`Particle ${preset} material library must contain exactly one material; AthenaEnv renders unused material ranges as invalid DMA`);
    }
}
for (const marker of ["applyPointerSnap", "togglePivotEditing", "finishBoxSelection", "toggleIsolation", "setupPanelAccordions", "collapsedHierarchy", "applyRecordMaterial", "createLightObject", "applyCampfirePreset", "openCameraPreview", "renderTriggerEvents", "addTriggerAction", "renderUiPreview", "addUiElement", "switchProjectScene", "createProjectScene", "renderSceneManager", "setStartupProjectScene", "moveProjectScene", "exportSceneProjectFile", "createAudioObject", "createParticleObject", "createShadowObject", "applyShadowTexture", "renderRuntimeSettings", "updateLegacyParticlePreview", "stepLegacyParticlePreview", "OctahedronGeometry", "addAudio", "addParticle", "addShadow", "renderLogicEditor", "convertTriggerActionsToLogic", "validateVisualScripting"]) {
    if (!editorSource.includes(marker)) throw new Error(`Editor tool missing: ${marker}`);
}
for (const marker of ["Heavenfall", "Iniciar Jogo", "CRÉDITOS", "Brendow Vaz"]) {
    if (!source.includes(marker)) throw new Error(`Runtime menu text missing: ${marker}`);
}
for (const marker of ["MENU_AUDIO_ASSET", "updateMenuAudio", "startRuntimeAutoplayAudio"]) {
    if (!source.includes(marker)) throw new Error(`Runtime menu audio separation missing: ${marker}`);
}
if (source.includes("Render.SHADE_")) {
    throw new Error("AthenaEnv exposes shade_model as numeric Flat/Gouraud values, not Render.SHADE_* constants");
}
for (const marker of ["accurate_clipping", "texture_mapping", "runtimeShadows", "runtimeUiMedia", "controlRuntimeVideo", "EDITOR_LOGIC", "runtimeVisualScripts", "EDITOR_SCENE_PROJECT", "EDITOR_SCENE_META"]) {
    if (!source.includes(marker)) throw new Error(`Official Athena runtime integration missing: ${marker}`);
}
for (const id of ["snap-mode", "pivot-button", "box-select-button", "selection-marquee", "isolate-selection-button", "material-section", "material-texture-mapping", "material-smooth-shading", "material-accurate-clipping", "animation-section", "animation-clip", "light-section", "light-flicker", "light-campfire-preset", "camera-section", "camera-mode", "camera-preview", "trigger-events-editor", "event-action-type", "event-add-button", "event-convert-logic-button", "scene-picker", "scene-manager-button", "scene-manager-dialog", "scene-manager-list", "scene-manager-export-button", "duplicate-scene-button", "scene-background", "runtime-vsync", "runtime-performance", "player-spawn-x", "player-walk-speed", "ui-mode-button", "ui-editor", "ui-canvas", "ui-inspector", "ui-font-asset", "ui-media-section", "ui-media-asset", "logic-mode-button", "logic-editor", "logic-node-palette", "logic-properties", "audio-tools-section", "add-audio-button", "audio-section", "audio-asset", "particle-tools-section", "particle-section", "particle-preset", "particle-color", "add-shadow-button", "shadow-section", "shadow-texture"]) {
    if (!editorHtml.includes(`id="${id}"`)) throw new Error(`Editor control missing: ${id}`);
}
source = source.replace(
    "while (true) {",
    "globalThis.__levelTest = { baseWalkable, isPlayerValid, applyMovement, colliderHits, updateVerticalMovement, executeAction: executeRuntimeAction, getRuntimeMessage: () => runtimeMessageText, getVisibility: (id) => runtimeObjectVisibility[id], getColliders: () => collisionShapes, getAudio: (id) => runtimeAudioById(id), getParticleEmitter: (id) => particleEmitterById(id), setPlayer: (state) => { playerX = state.x; playerY = state.y; playerZ = state.z; playerVelocityY = state.velocityY; playerGrounded = state.grounded; }, getPlayer: () => ({ x: playerX, y: playerY, z: playerZ, velocityY: playerVelocityY, grounded: playerGrounded }) }; gameState = GAME_STATE_GAME; for (let __smokeFrame = 0; __smokeFrame < 2; __smokeFrame++) {"
);

let vertexCount = 0;
let drawCalls = 0;
const particleMaterialUpdates = [];
const fontPrints = [];
const rectCalls = [];
const soundEvents = [];
const videoEvents = [];
const shadowEvents = [];
const imageDraws = [];
let nextLightId = 0;
const lightSetCalls = [];
const assetLoads = [];
const manifest = require(path.join(__dirname, "..", "assets", "manifest.json"));
let sandbox;

class MockFont {
    print(x, y, text) { fontPrints.push({ x, y, text }); }
    getTextSize(text) { return { width: String(text).length * 7 * (this.scale || 1), height: 14 * (this.scale || 1) }; }
}

class MockImage {
    constructor(path) {
        this.path = path;
        this.width = 640;
        this.height = 448;
    }
    lock() {}
    draw(x, y) { imageDraws.push({ path: this.path, x, y, width: this.width, height: this.height, color: this.color }); }
    ready() { return true; }
}

class MockVideo {
    constructor(path) {
        this.path = path;
        this.ready = true;
        this.ended = false;
        this.playing = false;
        this.loop = false;
        this.frame = new MockImage(`${path}#frame`);
    }
    play() { this.playing = true; videoEvents.push({ type: "play", path: this.path }); }
    pause() { this.playing = false; videoEvents.push({ type: "pause", path: this.path }); }
    stop() { this.playing = false; videoEvents.push({ type: "stop", path: this.path }); }
    update() { videoEvents.push({ type: "update", path: this.path }); return true; }
    draw(x, y, width, height) { videoEvents.push({ type: "draw", path: this.path, x, y, width, height }); }
}

class MockShadowProjector {
    constructor(texture) { this.texture = texture; shadowEvents.push({ type: "create", texture: texture.path }); }
    setSize(width, height) { shadowEvents.push({ type: "size", width, height }); }
    setGrid(x, z) { shadowEvents.push({ type: "grid", x, z }); }
    setLightDir(x, y, z) { shadowEvents.push({ type: "light", x, y, z }); }
    setBias(value) { shadowEvents.push({ type: "bias", value }); }
    setLightOffset(value) { shadowEvents.push({ type: "offset", value }); }
    setColor(r, g, b, a) { shadowEvents.push({ type: "color", r, g, b, a }); }
    setBlend(value) { shadowEvents.push({ type: "blend", value }); }
    render() { shadowEvents.push({ type: "render", position: this.position }); }
}

class MockRenderData {
    constructor(vertices) {
        this.vertices = vertices;
        if (typeof vertices === "string") assetLoads.push(vertices);
    }
    updateMaterial(index, material) { particleMaterialUpdates.push({ index, material }); }
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
    Image: MockImage,
    Video: MockVideo,
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
                sandbox.EDITOR_AUDIO.push(
                    { id: "smoke-stream", name: "Smoke stream", mode: "stream", asset: "sounds/music.ogg", autoplay: true, loop: true, volume: 60, position: { x: 0, y: 0, z: 0 } },
                    { id: "smoke-sfx", name: "Smoke SFX", mode: "sfx", asset: "sounds/fire.adp", autoplay: true, loop: true, volume: 80, spatial: true, distance: 20, pan: 0, pitch: 3, position: { x: 2, y: 1, z: 18 } }
                );
                sandbox.EDITOR_PARTICLES.push({
                    id: "smoke-particles", name: "Smoke particles", preset: "fire", asset: "editor_particles/fire.obj",
                    color: { r: 0.2, g: 0.8, b: 0.4 },
                    position: { x: 0, y: 1, z: 18 }, autoplay: true, maxParticles: 2, rate: 60,
                    lifetime: 40, speed: 0.03, spread: 0.2, size: 0.1, gravity: -0.0004
                });
                sandbox.EDITOR_UI.push(
                    { id: "smoke-panel", type: "panel", x: 12, y: 24, width: 180, height: 40, background: { r: 10, g: 20, b: 30, a: 96 } },
                    { id: "smoke-text", type: "text", x: 20, y: 30, width: 160, height: 20, text: "UI runtime", fontScale: 0.5, color: { r: 240, g: 230, b: 210, a: 128 }, align: "left", outline: 1, dropshadow: 0, opacity: 1 },
                    { id: "smoke-image", type: "image", asset: "Textures/icon.png", x: 30, y: 60, width: 32, height: 24, color: { r: 255, g: 255, b: 255, a: 128 }, opacity: 0.75 },
                    { id: "smoke-video", type: "video", asset: "videos/intro.mpg", x: 40, y: 90, width: 160, height: 90, color: { r: 255, g: 255, b: 255, a: 128 }, opacity: 0.5, autoplay: false, loop: false }
                );
                sandbox.EDITOR_SHADOWS.push({
                    id: "smoke-shadow", asset: "Textures/shadow.png", position: { x: 0, y: 0.03, z: 18 },
                    width: 2.5, height: 2, gridX: 6, gridZ: 5, lightDirection: { x: 0, y: 1, z: 1 },
                    bias: -0.02, lightOffset: 1, color: { r: 0, g: 0, b: 0 }, opacity: 0.65,
                    blend: "darken", followPlayer: true
                });
            }
        }
    },
    Shadows: {
        SHADOW_BLEND_DARKEN: 0, SHADOW_BLEND_ALPHA: 1, SHADOW_BLEND_ADD: 2,
        Projector: MockShadowProjector
    },
    Lights: {
        DIRECTION: 0, AMBIENT: 1, DIFFUSE: 2,
        new: () => ({ id: ++nextLightId }),
        set(light, property, x, y, z) { lightSetCalls.push({ id: light.id, property, x, y, z }); }
    },
    Sound: {
        setVolume(volume) { soundEvents.push({ type: "master-volume", volume }); },
        Stream(asset) {
            return {
                asset, loop: false, position: 0, length: 1000, active: false, playAttempts: 0,
                play() { this.playAttempts++; this.active = this.playAttempts > 1; soundEvents.push({ type: "stream-play", asset }); },
                pause() { this.active = false; soundEvents.push({ type: "stream-pause", asset }); },
                rewind() { this.position = 0; soundEvents.push({ type: "stream-rewind", asset }); },
                playing() { return this.active; }, free() {}
            };
        },
        Sfx(asset) {
            return {
                asset, volume: 100, pan: 0, pitch: 0, active: false,
                play() { this.active = true; soundEvents.push({ type: "sfx-play", asset, volume: this.volume, pan: this.pan }); return 1; },
                playing() { const result = this.active; this.active = false; return result; }, free() {}
            };
        }
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

if (!Array.isArray(context.EDITOR_LIGHTS) || !Array.isArray(context.EDITOR_POINT_LIGHTS) || !Array.isArray(context.EDITOR_EVENTS) || !Array.isArray(context.EDITOR_UI) || !Array.isArray(context.EDITOR_AUDIO) || !Array.isArray(context.EDITOR_PARTICLES) || !Array.isArray(context.EDITOR_SHADOWS) || !("EDITOR_CAMERA" in context)) {
    throw new Error("Generated scene must expose lights, events, interface, audio, particles, shadows and active camera contracts");
}
if (!fontPrints.some((entry) => entry.text === "UI runtime")) throw new Error("Exported UI text must be drawn by Font in the runtime loop");
if (!rectCalls.some((entry) => entry.x === 12 && entry.y === 24 && entry.width === 180 && entry.height === 40)) {
    throw new Error("Exported UI panels must be drawn by Draw.rect in runtime coordinates");
}
if (!imageDraws.some((entry) => entry.path === "Textures/icon.png" && entry.width === 32 && entry.height === 24)) {
    throw new Error("Exported UI images must be drawn by Image in runtime coordinates");
}
if (!imageDraws.some((entry) => entry.path === "videos/intro.mpg#frame" && entry.color.a === 64)) {
    throw new Error("MPEG frames must honor UI opacity through the official Video.frame image");
}
if (shadowEvents.filter((entry) => entry.type === "render").length < 2
    || !shadowEvents.some((entry) => entry.type === "grid" && entry.x === 6 && entry.z === 5)) {
    throw new Error("Official shadow projectors must be configured and rendered every frame");
}

if (manifest.sceneVertices < 1000 || manifest.sceneVertices > 30000) {
    throw new Error(`Unexpected geometry budget: ${manifest.sceneVertices} vertices`);
}
const expectedRuntimeObjects = context.EDITOR_SCENE.length + 1;
const expectedAssetLoads = expectedRuntimeObjects + context.EDITOR_PARTICLES.length;
if (assetLoads.length !== expectedAssetLoads) {
    throw new Error(`Expected ${expectedAssetLoads} OBJ loads, received ${assetLoads.length}`);
}
if (drawCalls <= expectedRuntimeObjects * 2) {
    throw new Error(`Runtime particles must add visible draw calls, received ${drawCalls}`);
}
if (!particleMaterialUpdates.some((entry) => entry.material.diffuse.g === 0.8)) {
    throw new Error("Runtime particle color must update the Athena material");
}
const previewSourceStart = editorSource.indexOf("function updateLegacyParticlePreview");
const previewSourceEnd = editorSource.indexOf("function updateParticlePreviewObject", previewSourceStart);
if (previewSourceStart < 0 || previewSourceEnd < 0) throw new Error("Editor particle simulation helpers are missing");
const previewSandbox = vm.createContext({ Math });
vm.runInContext(
    `${editorSource.slice(previewSourceStart, previewSourceEnd)}; globalThis.__particlePreviewTest = { stepLegacyParticlePreview };`,
    previewSandbox,
);
const previewSimulation = {
    particles: Array.from({ length: 2 }, () => ({ alive: false, age: 0, life: 40, progress: 0, x: 0, y: 0, z: 0 })),
    elapsedSeconds: 0,
};
const previewSettings = { preset: "fire", autoplay: true, maxParticles: 2, rate: 60, lifetime: 40, speed: 0.03, spread: 0.2, size: 0.1, gravity: -0.0004 };
previewSandbox.__particlePreviewTest.stepLegacyParticlePreview(previewSimulation, previewSettings);
previewSandbox.__particlePreviewTest.stepLegacyParticlePreview(previewSimulation, previewSettings);
const runtimeParticleEmitter = context.__levelTest.getParticleEmitter("smoke-particles");
const runtimeParticlePool = runtimeParticleEmitter.pool;
for (let index = 0; index < runtimeParticlePool.length; index++) {
    const runtimeParticle = runtimeParticlePool[index];
    const previewParticle = previewSimulation.particles[index];
    for (const property of ["alive", "age", "life", "progress"]) {
        if (Math.abs(Number(previewParticle[property]) - Number(runtimeParticle[property])) > 1e-9) throw new Error(`Editor particle ${property} differs from runtime at pool index ${index}`);
    }
    for (const property of ["x", "y", "z"]) {
        const origin = ["x", "y", "z"].includes(property) ? runtimeParticleEmitter.definition.position[property] : 0;
        if (Math.abs(previewParticle[property] + origin - runtimeParticle[property]) > 1e-9) {
            throw new Error(`Editor particle ${property} differs from runtime at pool index ${index}`);
        }
    }
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
if (!soundEvents.some((entry) => entry.type === "stream-play") || !soundEvents.some((entry) => entry.type === "sfx-play")) {
    throw new Error("Autoplay streams and SFX must reach Athena's Sound runtime");
}
if (soundEvents.filter((entry) => entry.type === "stream-play").length < 2) {
    throw new Error("Streams must retry when Athena does not start playback on the first attempt");
}
const spatialSfx = context.__levelTest.getAudio("smoke-sfx");
if (!spatialSfx || spatialSfx.sound.volume >= 80 || spatialSfx.sound.pan === 0) {
    throw new Error("Spatial SFX must update volume and pan from player distance");
}
context.__levelTest.executeAction({ type: "audio", targetId: "smoke-stream", mode: "stop" });
if (!soundEvents.some((entry) => entry.type === "stream-pause")) throw new Error("Audio stop events must pause streams");
context.__levelTest.executeAction({ type: "particle", targetId: "smoke-particles", mode: "stop" });
if (context.__levelTest.getParticleEmitter("smoke-particles").enabled !== false) throw new Error("Particle stop events must disable emission");
context.__levelTest.executeAction({ type: "particle", targetId: "smoke-particles", mode: "burst" });
if (!context.__levelTest.getParticleEmitter("smoke-particles").pool.some((particle) => particle.alive)) {
    throw new Error("Particle burst events must spawn the runtime pool");
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
context.__levelTest.executeAction({ type: "video", targetId: "smoke-video", mode: "play" });
context.__levelTest.executeAction({ type: "video", targetId: "smoke-video", mode: "pause" });
context.__levelTest.executeAction({ type: "video", targetId: "smoke-video", mode: "stop" });
if (!videoEvents.some((entry) => entry.type === "pause") || !videoEvents.some((entry) => entry.type === "stop")) {
    throw new Error("Video trigger actions must reach the official Video controls");
}
if (!Collision3D.cameraBlocked([capsule], 0, 1, 3.5, 0.1)) {
    throw new Error("Capsule broad-phase bounds must include its scaled end caps");
}

const thinMidBodyBox = Collision3D.normalize({
    id: "thin-mid-body",
    shape: "box",
    position: { x: 0, y: 2.55, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 0.05, z: 1 }
}, 0);
if (Collision3D.playerContacts([thinMidBodyBox], 0, 0, 0, 0.25, 5.0, false).length !== 1) {
    throw new Error("Tall player capsules must be sampled without vertical collision gaps");
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
