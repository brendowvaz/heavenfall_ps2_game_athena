// Desktop smoke test: checks the procedural build without requiring AthenaEnv.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const sourcePath = path.join(__dirname, "..", "main.js");
let source = fs.readFileSync(sourcePath, "utf8");
const editorSource = fs.readFileSync(path.join(__dirname, "..", "editor", "app.js"), "utf8");
const editorHtml = fs.readFileSync(path.join(__dirname, "..", "editor", "index.html"), "utf8");
const visualRuntimeSource = fs.readFileSync(path.join(__dirname, "..", "assets", "visual-scripting-runtime.js"), "utf8");
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
for (const marker of ["applyPointerSnap", "togglePivotEditing", "finishBoxSelection", "toggleIsolation", "setupPanelAccordions", "collapsedHierarchy", "applyRecordMaterial", "createLightObject", "applyCampfirePreset", "openCameraPreview", "renderTriggerEvents", "addTriggerAction", "renderUiPreview", "addUiElement", "switchProjectScene", "createProjectScene", "renderSceneManager", "setStartupProjectScene", "moveProjectScene", "exportSceneProjectFile", "withSceneProjectUiLock", "performSceneSave", "documentRevision", "saveQueue", "createAudioObject", "createParticleObject", "createShadowObject", "createSpawnPointObject", "addSpawnPoint", "addScenePortal", "addCheckpoint", "addGameplayTrigger", "renderPortalEditor", "renderCheckpointEditor", "renderGameplayEditor", "updateGameplayFromInspector", "applyShadowTexture", "renderRuntimeSettings", "renderPlayerCharacterOptions", "refreshPlayerAnimationClips", "detectCharacterClips", "renderCharacterStateOptions", "instantiatePrefab", "updateLegacyParticlePreview", "stepLegacyParticlePreview", "OctahedronGeometry", "addAudio", "addParticle", "addShadow", "renderLogicEditor", "convertTriggerActionsToLogic", "validateVisualScripting"]) {
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
for (const marker of ["accurate_clipping", "texture_mapping", "runtimeShadows", "runtimeUiMedia", "controlRuntimeVideo", "EDITOR_LOGIC", "runtimeVisualScripts", "actionDisplayVariable", "actionSaveGame", "actionLoadGame", "actionDamage", "actionHeal", "actionRespawn", "actionCharacterState", "EDITOR_SCENE_PROJECT", "EDITOR_SCENE_META", "EDITOR_SPAWN_POINTS", "EDITOR_PORTALS", "EDITOR_CHECKPOINTS", "EDITOR_GAMEPLAY_COMPONENTS", "runRuntimeGameplayPhase", "applyRuntimeDamage", "applyRuntimeHealing", "respawnRuntimePlayer", "createRuntimeCharacterController", "setRuntimeCharacterState", "updateRuntimeCharacterStates", "requestSceneTransition", "freeRuntimeSceneResources", "retireRenderObject", "retainBorrowedNativeView", "retiredNativeViews", "releaseRenderData", "reapRetiredActiveSfx", "persistentRuntimeStream", "persistentState", "portalConditionSatisfied", "saveRuntimeGame", "loadRuntimeGame", "writeRuntimeSaveFile", "System.getMCInfo", "System.rename", "System.copyFile", "suspendRuntimeStream", "runAthenaGame", "runtimeNextSceneTransition"]) {
    if (!source.includes(marker)) throw new Error(`Official Athena runtime integration missing: ${marker}`);
}
for (const marker of ["eventPlayerJump", "playerJump: playerJump", "eventGameplay", "gameplay: gameplay"]) {
    if (!visualRuntimeSource.includes(marker)) throw new Error(`Visual scripting runtime event missing: ${marker}`);
}
const runtimeLoopStart = source.indexOf("while (runtimeLoopRunning) {");
const lifecycleLoop = source.lastIndexOf("while (runtimeNextSceneTransition) {");
if (runtimeLoopStart < 0 || lifecycleLoop < runtimeLoopStart || source.includes("std.reload") || /\bstd\.gc\s*\(/.test(source)) {
    throw new Error("Scene transitions must use the in-process lifecycle without destroying the QuickJS runtime");
}
if (!source.includes("runAthenaGame(completedSceneTransition)")) {
    throw new Error("The target scene must be passed directly to the next lifecycle instead of relying only on mutable globals");
}
if (/globalThis\.ATHENA_BOOT_[A-Z_]+\s*=/.test(source.slice(lifecycleLoop))) {
    throw new Error("The post-cleanup lifecycle must not add or mutate boot properties on QuickJS globalThis");
}
if (!source.includes("os.getcwd()") || !source.includes('os.chdir(runtimePreviousDirectory)') || !source.includes('os.chdir("..")')) {
    throw new Error("Every transition must restore the directory above assets, including a checked fallback");
}
for (const id of ["snap-mode", "pivot-button", "box-select-button", "selection-marquee", "isolate-selection-button", "material-section", "material-texture-mapping", "material-smooth-shading", "material-accurate-clipping", "animation-section", "animation-clip", "character-enabled", "character-state-idle", "character-state-death", "character-detect", "player-model-asset", "player-character-enabled", "player-character-idle", "player-character-death", "player-character-detect", "prefab-search", "prefab-category", "light-section", "light-flicker", "light-campfire-preset", "camera-section", "camera-mode", "camera-preview", "add-spawn-button", "add-portal-button", "add-checkpoint-button", "spawn-section", "spawn-default", "portal-editor", "portal-enabled", "portal-scene", "portal-spawn", "portal-condition-enabled", "portal-condition-variable", "portal-condition-operator", "portal-condition-value", "checkpoint-editor", "checkpoint-enabled", "checkpoint-activation", "checkpoint-autosave", "gameplay-section", "gameplay-health-enabled", "gameplay-damage-enabled", "gameplay-collectible-enabled", "gameplay-interactable-enabled", "gameplay-death-zone-enabled", "player-health-enabled", "player-health-maximum", "object-persistent", "trigger-events-editor", "event-action-type", "event-scene", "event-spawn", "event-add-button", "event-convert-logic-button", "scene-picker", "scene-manager-button", "scene-manager-dialog", "scene-manager-list", "scene-manager-export-button", "duplicate-scene-button", "scene-background", "runtime-vsync", "runtime-performance", "player-spawn-x", "player-walk-speed", "ui-mode-button", "ui-editor", "ui-canvas", "ui-inspector", "ui-font-asset", "ui-media-section", "ui-media-asset", "logic-mode-button", "logic-editor", "logic-node-palette", "logic-properties", "audio-tools-section", "add-audio-button", "audio-section", "audio-asset", "particle-tools-section", "particle-section", "particle-preset", "particle-color", "add-shadow-button", "shadow-section", "shadow-texture"]) {
    if (!editorHtml.includes(`id="${id}"`)) throw new Error(`Editor control missing: ${id}`);
}
source = source.replace(
    "while (runtimeLoopRunning) {",
    "globalThis.__levelTest = { baseWalkable, isPlayerValid, applyMovement, colliderHits, updateVerticalMovement, executeAction: executeRuntimeAction, requestSceneTransition, runCheckpoint: runCheckpointPhase, runGameplay: runRuntimeGameplayPhase, saveGame: saveRuntimeGame, loadGame: loadRuntimeGame, getSaveData: () => runtimeEngineState.saveData, getPlayerHealth: () => runtimePlayerGameplay.currentHealth, getGameplayState: (id) => runtimeGameplayById[id], interactionAllowed: runtimeInteractionAllowed, clearSessionCheckpoint: () => { runtimeEngineState.sessionCheckpoint = null; }, clearSceneTransition: () => { runtimeSceneTransition = null; }, freeResources: freeRuntimeSceneResources, releaseRenderData, getRetiredNativeViewCount: () => runtimeEngineState.retiredNativeViews.length, getSceneTransition: () => runtimeSceneTransition, getRuntimeMessage: () => runtimeMessageText, getVisibility: (id) => runtimeObjectVisibility[id], getPersistentVariable: (id) => readPersistentVariable(id, undefined, runtimeVariableTypes[id]), setPersistentVariable: (id, value) => writePersistentVariable(id, value, runtimeVariableTypes[id]), triggerJump: () => { runtimeVisualScripts.start(); runtimeVisualScripts.playerJump(); }, portalConditionSatisfied, getColliders: () => collisionShapes, getAudio: (id) => runtimeAudioById(id), getParticleEmitter: (id) => particleEmitterById(id), setPlayer: (state) => { playerX = state.x; playerY = state.y; playerZ = state.z; if (state.yaw !== undefined) playerYaw = state.yaw; playerVelocityY = state.velocityY; playerGrounded = state.grounded; }, getPlayer: () => ({ x: playerX, y: playerY, z: playerZ, yaw: playerYaw, velocityY: playerVelocityY, grounded: playerGrounded }) }; gameState = GAME_STATE_GAME; for (let __smokeFrame = 0; __smokeFrame < 2; __smokeFrame++) {"
);

let vertexCount = 0;
let drawCalls = 0;
let renderDataFrees = 0;
let renderObjectFrees = 0;
let fontCreations = 0;
let imageFrees = 0;
let imageDoubleFrees = 0;
let streamCreations = 0;
let streamFrees = 0;
const particleMaterialUpdates = [];
const fontPrints = [];
const rectCalls = [];
const soundEvents = [];
const videoEvents = [];
const shadowEvents = [];
const animationEvents = [];
const imageDraws = [];
let nextLightId = 0;
const lightSetCalls = [];
const assetLoads = [];
const manifest = require(path.join(__dirname, "..", "assets", "manifest.json"));
const memoryCardFiles = new Map();
let systemRenameCalls = 0;
let systemCopyCalls = 0;
let forceSystemRenameFailure = false;
let sandbox;

class MockFont {
    constructor() { fontCreations++; }
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
    free() {
        if (this.freed) imageDoubleFrees++;
        else {
            this.freed = true;
            imageFrees++;
        }
    }
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
    free() {}
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
    free() {}
}

class MockRenderData {
    constructor(vertices) {
        this.vertices = vertices;
        if (typeof vertices === "string") assetLoads.push(vertices);
    }
    updateMaterial(index, material) { particleMaterialUpdates.push({ index, material }); }
    free() { renderDataFrees++; }
}

class MockRenderObject {
    constructor(data) {
        this.data = data;
        this.transform = { borrowed: true };
        this.position = { x: 0, y: 0, z: 0 };
        this.rotation = { x: 0, y: 0, z: 0 };
    }
    render() {
        drawCalls++;
    }
    playAnim(animation, loop) { animationEvents.push({ animation: animation?.name || animation, loop }); }
    isPlayingAnim() { return false; }
    free() { renderObjectFrees++; }
}

class MockAnimCollection {
    constructor(asset) {
        this.asset = asset;
        for (const name of ["Idle", "Walk", "Run", "Jump", "Fall", "Attack", "Hurt", "Death"]) this[name] = { name };
        this[0] = this.Idle;
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
    // Keep this fixture independent from whichever scene the user selects as
    // the project's startup scene. The collision assertions below exercise
    // the Ruinas scene explicitly, then load Salao in the same VM.
    ATHENA_BOOT_SCENE_ID: "main",
    ATHENA_BOOT_SPAWN_ID: "ruinas-entrada-principal",
    ATHENA_BOOT_FADE_FRAMES: 1,
    ATHENA_SKIP_MENU: false,
    Color: { new: (r, g, b, a) => ({ r, g, b, a }) },
    Font: MockFont,
    Image: MockImage,
    Video: MockVideo,
    RenderData: MockRenderData,
    RenderObject: MockRenderObject,
    AnimCollection: MockAnimCollection,
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
    os: {
        chdir() {},
        mkdir() { return 0; },
        remove(filename) { return memoryCardFiles.delete(filename) ? 0 : -2; },
        rename() { return -38; }
    },
    std: {
        exists(filename) {
            if (filename.startsWith("mc0:/")) return memoryCardFiles.has(filename);
            return fs.existsSync(path.join(__dirname, "..", "assets", filename));
        },
        loadFile(filename) {
            return memoryCardFiles.has(filename) ? memoryCardFiles.get(filename) : null;
        },
        open(filename, flags) {
            if (!filename.startsWith("mc0:/") || flags !== "w") return null;
            let content = "";
            let closed = false;
            return {
                puts(value) { content += String(value); return String(value).length; },
                flush() {},
                close() {
                    if (closed) return;
                    closed = true;
                    memoryCardFiles.set(filename, content);
                }
            };
        },
        loadScript(filename) {
            const script = fs.readFileSync(path.join(__dirname, "..", "assets", filename), "utf8");
            vm.runInContext(script, sandbox, { filename });
            if (filename === "scenes/project.generated.js") {
                sandbox.EDITOR_SCENE_PROJECT.variables.push(
                    { id: "smoke-global-key", name: "Smoke global key", type: "boolean", initialValue: true },
                    { id: "smoke-jump-count", name: "Smoke jump count", type: "number", initialValue: 0 },
                    { id: "smoke-items", name: "Smoke items", type: "number", initialValue: 0 }
                );
            }
            if (filename === "scene.generated.js" || filename === "scenes/main.generated.js") {
                if (sandbox.EDITOR_SCENE[0]) sandbox.EDITOR_SCENE[0].persistent = true;
                sandbox.EDITOR_SETTINGS.player.health = {
                    enabled: true, maximum: 100, initial: 100,
                    invulnerabilityFrames: 0, respawnOnDeath: true, showHud: true
                };
                sandbox.EDITOR_SETTINGS.player.modelAsset = "synthetic-player.gltf";
                sandbox.EDITOR_SETTINGS.player.character = {
                    enabled: true, initialState: "idle", hurtFrames: 4, attackFrames: 6,
                    states: { idle: "Idle", walk: "Walk", run: "Run", jump: "Jump", fall: "Fall", attack: "Attack", hurt: "Hurt", death: "Death" }
                };
                const gameplayVisualId = sandbox.EDITOR_SCENE[0].id;
                sandbox.EDITOR_GAMEPLAY_COMPONENTS.push(
                    { id: `${gameplayVisualId}-health`, type: "health", objectId: gameplayVisualId, enabled: true, maximum: 40, initial: 40, invulnerabilityFrames: 0, hideOnDeath: true, persistent: true },
                    { id: "smoke-damage", type: "damage", triggerId: "smoke-gameplay", targetId: "__player__", amount: 25, activation: "onEnter", cooldownFrames: 30 },
                    { id: "smoke-collectible", type: "collectible", triggerId: "smoke-gameplay", variableId: "smoke-items", amount: 2, activation: "onEnter", visualTargetIds: [gameplayVisualId], message: "Coletado", autosave: false },
                    { id: "smoke-interactable", type: "interactable", triggerId: "smoke-interaction", prompt: "Interagir", once: true },
                    { id: "smoke-death-zone", type: "deathZone", triggerId: "smoke-death", fadeFrames: 18 }
                );
                sandbox.EDITOR_LOGIC.graphs.push({
                    id: "smoke-jump-graph",
                    name: "Smoke jump graph",
                    enabled: true,
                    nodes: [
                        { id: "smoke-jump-event", type: "eventPlayerJump", config: {} },
                        { id: "smoke-jump-add", type: "actionSetVariable", config: { variableId: "smoke-jump-count", operation: "add", value: 1 } },
                        { id: "smoke-jump-message", type: "actionDisplayVariable", config: { variableId: "smoke-jump-count", prefix: "Pulos: ", duration: 120 } }
                    ],
                    links: [
                        { id: "smoke-jump-link-1", from: "smoke-jump-event", fromPort: "next", to: "smoke-jump-add" },
                        { id: "smoke-jump-link-2", from: "smoke-jump-add", fromPort: "next", to: "smoke-jump-message" }
                    ]
                });
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
                sandbox.EDITOR_PORTALS.push({
                    triggerId: "smoke-trigger",
                    targetSceneId: "main",
                    targetSpawnId: "",
                    activation: "onEnter",
                    fadeFrames: 30,
                    condition: { enabled: true, variableId: "smoke-global-key", operator: "eq", value: true }
                });
                sandbox.EDITOR_CHECKPOINTS.push({
                    triggerId: "smoke-checkpoint",
                    activation: "onEnter",
                    autosave: true
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
        },
        gc() { throw new Error("Runtime must not force QuickJS collection between scenes"); }
    },
    System: {
        getMCInfo(slot) { return slot === 0 ? { type: 2, freemem: 8 * 1024 * 1024, format: 1 } : { type: 0, freemem: 0, format: 0 }; },
        rename(source, destination) {
            systemRenameCalls++;
            if (forceSystemRenameFailure) return -38;
            if (!memoryCardFiles.has(source)) return -2;
            memoryCardFiles.set(destination, memoryCardFiles.get(source));
            memoryCardFiles.delete(source);
            return 0;
        },
        copyFile(source, destination) {
            systemCopyCalls++;
            if (!memoryCardFiles.has(source)) return -2;
            memoryCardFiles.set(destination, memoryCardFiles.get(source));
            return 0;
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
            streamCreations++;
            return {
                asset, loop: false, position: 0, length: 1000, active: false, playAttempts: 0,
                play() { this.playAttempts++; this.active = this.playAttempts > 1; soundEvents.push({ type: "stream-play", asset }); },
                pause() { this.active = false; soundEvents.push({ type: "stream-pause", asset }); },
                rewind() { this.position = 0; soundEvents.push({ type: "stream-rewind", asset }); },
                playing() { return this.active; },
                free() { streamFrees++; soundEvents.push({ type: "stream-free", asset }); }
            };
        },
        Sfx(asset) {
            return {
                asset, volume: 100, pan: 0, pitch: 0, active: false,
                play() { this.active = true; soundEvents.push({ type: "sfx-play", asset, volume: this.volume, pan: this.pan }); return 1; },
                playing() { const result = this.active; this.active = false; return result; },
                free() { soundEvents.push({ type: "sfx-free", asset }); }
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

if (!Array.isArray(context.EDITOR_LIGHTS) || !Array.isArray(context.EDITOR_POINT_LIGHTS) || !Array.isArray(context.EDITOR_EVENTS) || !Array.isArray(context.EDITOR_SPAWN_POINTS) || !Array.isArray(context.EDITOR_PORTALS) || !Array.isArray(context.EDITOR_CHECKPOINTS) || !Array.isArray(context.EDITOR_UI) || !Array.isArray(context.EDITOR_AUDIO) || !Array.isArray(context.EDITOR_PARTICLES) || !Array.isArray(context.EDITOR_SHADOWS) || !("EDITOR_CAMERA" in context)) {
    throw new Error("Generated scene must expose lights, events, portals, spawn points, interface, audio, particles, shadows and active camera contracts");
}
if (!animationEvents.some((entry) => entry.animation === "Idle" && entry.loop === true)) {
    throw new Error("The animated player component must start its configured idle clip through RenderObject.playAnim");
}
context.__levelTest.executeAction({ type: "character", targetId: "__player__", state: "attack", durationFrames: 6 });
if (!animationEvents.some((entry) => entry.animation === "Attack" && entry.loop === false)) {
    throw new Error("Gameplay actions must switch a character to a configured non-looping state");
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
const smokeTransition = context.__levelTest.getSceneTransition();
if (!smokeTransition || smokeTransition.sceneId !== "main" || smokeTransition.fadeFrames !== 30) {
    throw new Error("Scene portals must request a catalog-backed dynamic transition");
}
if (context.__levelTest.getPersistentVariable("smoke-global-key") !== true) {
    throw new Error("Project variables must be initialized in the persistent runtime store");
}
context.__levelTest.setPersistentVariable("smoke-global-key", false);
if (context.__levelTest.portalConditionSatisfied({ enabled: true, variableId: "smoke-global-key", operator: "eq", value: true })) {
    throw new Error("A false portal condition must block the transition");
}
context.__levelTest.setPersistentVariable("smoke-global-key", true);
context.__levelTest.triggerJump();
if (context.__levelTest.getPersistentVariable("smoke-jump-count") !== 1
    || context.__levelTest.getPersistentVariable("jump-count") !== 1
    || context.__levelTest.getRuntimeMessage() !== "Pulos: 1") {
    throw new Error("The player jump event must increment and display its persistent counter");
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
const visibilityTarget = context.EDITOR_SCENE[0].id;
context.__levelTest.executeAction({ type: "damage", targetId: "__player__", amount: 25 });
context.__levelTest.executeAction({ type: "heal", targetId: "__player__", amount: 10 });
if (context.__levelTest.getPlayerHealth() !== 85) {
    throw new Error("Player health must apply damage and healing with the configured limits");
}
context.__levelTest.executeAction({ type: "damage", targetId: visibilityTarget, amount: 50 });
if (context.__levelTest.getGameplayState(`${visibilityTarget}-health`).health !== 0
    || context.__levelTest.getVisibility(visibilityTarget) !== false) {
    throw new Error("Object health must emit death state and hide its visual at zero");
}
context.__levelTest.executeAction({ type: "heal", targetId: visibilityTarget, amount: 5 });
if (context.__levelTest.getGameplayState(`${visibilityTarget}-health`).health !== 5
    || context.__levelTest.getVisibility(visibilityTarget) !== true) {
    throw new Error("Healing a dead object must restore its visual and persistent health");
}
context.__levelTest.runGameplay("smoke-gameplay", "onEnter");
context.__levelTest.runGameplay("smoke-gameplay", "onEnter");
if (context.__levelTest.getPersistentVariable("smoke-items") !== 2
    || !context.__levelTest.getGameplayState("smoke-collectible").consumed
    || context.__levelTest.getVisibility(visibilityTarget) !== false) {
    throw new Error("Collectibles must increment once, persist consumption and hide their configured visual");
}
if (!context.__levelTest.interactionAllowed("smoke-interaction")) throw new Error("Unused interactables must accept interaction");
context.__levelTest.runGameplay("smoke-interaction", "onInteract");
if (context.__levelTest.interactionAllowed("smoke-interaction")) {
    throw new Error("One-shot interactables must persist their consumed state");
}
context.__levelTest.clearSceneTransition();
context.__levelTest.runGameplay("smoke-death", "onEnter");
if (context.__levelTest.getSceneTransition()?.sceneId !== "main") {
    throw new Error("Death zones must respawn through the normal scene lifecycle");
}
context.__levelTest.clearSceneTransition();
context.__levelTest.executeAction({ type: "damage", targetId: "__player__", amount: 40 });
const postLoopPlayer = context.__levelTest.getPlayer();
context.__levelTest.executeAction({ type: "visibility", targetIds: [visibilityTarget], mode: "hide" });
if (context.__levelTest.getVisibility(visibilityTarget) !== false) {
    throw new Error("Visibility actions must affect runtime objects");
}
context.__levelTest.executeAction({ type: "teleport", position: { x: 2, y: 0.08, z: 16 } });
if (context.__levelTest.getPlayer().x !== 2 || context.__levelTest.getPlayer().z !== 16) {
    throw new Error("Teleport actions must affect the runtime player");
}
context.__levelTest.setPlayer({ x: 3.5, y: 0.08, z: 14.25, yaw: 1.25, velocityY: 0, grounded: true });
context.__levelTest.setPersistentVariable("smoke-jump-count", 7);
context.__levelTest.runCheckpoint("smoke-checkpoint", "onEnter");
const savePath = "mc0:/HEAVENFALL/save.json";
if (!memoryCardFiles.has(savePath) || memoryCardFiles.has("mc0:/HEAVENFALL/save.tmp")) {
    throw new Error("Checkpoint saves must be verified and atomically promoted on the Memory Card");
}
if (systemRenameCalls === 0) throw new Error("Memory Card promotion must use AthenaEnv System.rename instead of the generic POSIX wrapper");
const storedSave = JSON.parse(memoryCardFiles.get(savePath));
if (storedSave.version !== 1 || storedSave.sceneId !== "main"
    || storedSave.player.x !== 3.5 || storedSave.player.z !== 14.25 || storedSave.player.yaw !== 1.25
    || storedSave.player.health !== 60
    || storedSave.variables["smoke-jump-count"] !== 7
    || storedSave.variables["smoke-items"] !== 2
    || storedSave.scenes.main.components["smoke-collectible"].consumed !== true
    || storedSave.scenes.main.components["smoke-interactable"].consumed !== true
    || storedSave.scenes.main.components[`${visibilityTarget}-health`].health !== 5
    || storedSave.scenes.main.objects[visibilityTarget].visible !== false) {
    throw new Error("Memory Card saves must contain player health, gameplay components, variables and persistent visibility");
}
context.__levelTest.setPersistentVariable("smoke-jump-count", 8);
const staleBackup = JSON.parse(memoryCardFiles.get(savePath));
staleBackup.variables["smoke-jump-count"] = 3;
memoryCardFiles.set("mc0:/HEAVENFALL/save.bak", JSON.stringify(staleBackup));
forceSystemRenameFailure = true;
if (!context.__levelTest.saveGame(false) || !memoryCardFiles.has("mc0:/HEAVENFALL/save.bak")) {
    throw new Error("Replacing a save must preserve the previous verified file as a backup");
}
forceSystemRenameFailure = false;
if (systemCopyCalls === 0) {
    throw new Error("Memory Card promotion must fall back to a verified System.copyFile when rename is unsupported");
}
memoryCardFiles.set(savePath, "{corrupted");
context.__levelTest.setPersistentVariable("smoke-jump-count", 99);
context.__levelTest.executeAction({ type: "visibility", targetIds: [visibilityTarget], mode: "show" });
context.__levelTest.setPlayer({ x: 9, y: 1, z: 9, yaw: 0, velocityY: 0, grounded: false });
context.__levelTest.clearSceneTransition();
context.__levelTest.clearSessionCheckpoint();
if (!context.__levelTest.loadGame(false)) throw new Error("A valid Memory Card save must load through the normal scene lifecycle");
const loadedTransition = context.__levelTest.getSceneTransition();
if (!loadedTransition || loadedTransition.sceneId !== "main" || loadedTransition.player.x !== 3.5
    || loadedTransition.player.z !== 14.25 || loadedTransition.player.yaw !== 1.25
    || context.__levelTest.getPersistentVariable("smoke-jump-count") !== 7
    || context.__levelTest.getSaveData().scenes.main.objects[visibilityTarget].visible !== false) {
    throw new Error("Continue must fall back to the backup, restore state and pass the saved player position into the next scene boot");
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

const expectedRenderObjectFrees = expectedRuntimeObjects + runtimeParticlePool.length;
const expectedRenderDataFrees = expectedRuntimeObjects + context.EDITOR_PARTICLES.length;
context.__levelTest.freeResources();
if (renderObjectFrees < expectedRenderObjectFrees || renderDataFrees < expectedRenderDataFrees) {
    throw new Error(`Scene cleanup must free native render resources before loading the next scene (${renderObjectFrees}/${expectedRenderObjectFrees} objects, ${renderDataFrees}/${expectedRenderDataFrees} data)`);
}
if (context.__levelTest.getRetiredNativeViewCount() !== renderObjectFrees + 1) {
    throw new Error("RenderObject matrices and the borrowed MPEG frame must remain protected");
}
const skinnedData = new MockRenderData("synthetic-skinned.gltf");
skinnedData.bones = [{}];
skinnedData.textures = [new MockImage("synthetic-skin.png")];
const freesBeforeSkinnedRelease = renderDataFrees;
const imageFreesBeforeSkinnedRelease = imageFrees;
context.__levelTest.releaseRenderData(skinnedData);
if (renderDataFrees !== freesBeforeSkinnedRelease + 1
    || imageFrees !== imageFreesBeforeSkinnedRelease + 1
    || context.__levelTest.getRetiredNativeViewCount() !== renderObjectFrees + 2) {
    throw new Error("Skinned RenderData must release textures and native mesh data while retaining borrowed bone views");
}
const plainData = new MockRenderData("synthetic-plain.obj");
context.__levelTest.releaseRenderData(plainData);
if (context.__levelTest.getRetiredNativeViewCount() !== renderObjectFrees + 2) {
    throw new Error("Plain RenderData must not add a borrowed-view guard");
}

const secondSceneLoadStart = assetLoads.length;
// Keep deliberately stale globals: an internal transition must prefer its
// direct payload even if QuickJS still exposes values from the previous scene.
context.ATHENA_BOOT_SCENE_ID = "main";
context.ATHENA_BOOT_SPAWN_ID = "ruinas-entrada-principal";
context.ATHENA_BOOT_FADE_FRAMES = 30;
context.ATHENA_SKIP_MENU = true;
context.ATHENA_RUNTIME_READY = true;
const secondSceneResult = context.runAthenaGame({
    sceneId: "salao-saida-01",
    spawnId: "salao-saida-entrada-principal",
    fadeFrames: 1
});
if (secondSceneResult !== null || context.EDITOR_SCENE_META.id !== "salao-saida-01") {
    throw new Error("The next generated scene must load in the existing QuickJS runtime");
}
if (!assetLoads.slice(secondSceneLoadStart).includes("editor_primitives/cube.obj")) {
    throw new Error("The in-process scene lifecycle must load the target scene assets");
}
if (!soundEvents.some((entry) => entry.type === "sfx-free")) {
    throw new Error("A retired SFX buffer must be released once its active channel finishes");
}
if (fontCreations !== 1 || nextLightId !== 4) {
    throw new Error(`Engine-native singletons must survive scene changes (fonts=${fontCreations}, lights=${nextLightId})`);
}
if (context.__levelTest.getPersistentVariable("smoke-global-key") !== true) {
    throw new Error("Global variable values must survive loading a different scene");
}
if (context.__levelTest.getPersistentVariable("smoke-jump-count") !== 7) {
    throw new Error("The jump counter must survive loading a different scene");
}
if (context.__levelTest.getPersistentVariable("jump-count") !== 2) {
    throw new Error("The configured project jump counter must continue incrementing after loading a different scene");
}
context.__levelTest.freeResources();
if (context.__levelTest.getRetiredNativeViewCount() !== renderObjectFrees + 2) {
    throw new Error("Target-scene RenderObject views must also remain protected after cleanup");
}

const returnSceneLoadStart = assetLoads.length;
context.ATHENA_BOOT_SCENE_ID = "salao-saida-01";
context.ATHENA_BOOT_SPAWN_ID = "salao-saida-entrada-principal";
context.ATHENA_BOOT_FADE_FRAMES = 30;
context.ATHENA_SKIP_MENU = true;
const returnSceneResult = context.runAthenaGame({
    sceneId: "main",
    spawnId: "ruinas-entrada-principal",
    fadeFrames: 1
});
if (returnSceneResult !== null || context.EDITOR_SCENE_META.id !== "main") {
    throw new Error("A scene lifecycle must support returning to a previously unloaded scene");
}
if (!assetLoads.slice(returnSceneLoadStart).includes("scene_0.obj")) {
    throw new Error("Returning to a scene must recreate its released render assets");
}
if (context.__levelTest.getVisibility(visibilityTarget) !== false) {
    throw new Error("Persistent object visibility must be restored when returning to a scene");
}
if (fontCreations !== 1 || nextLightId !== 4) {
    throw new Error(`Engine-native singletons must also survive the return trip (fonts=${fontCreations}, lights=${nextLightId})`);
}
if (streamCreations !== 3 || streamFrees !== 0) {
    throw new Error(`Native streams must be cached and never freed between scenes (created=${streamCreations}, freed=${streamFrees})`);
}
context.__levelTest.freeResources();
if (context.__levelTest.getRetiredNativeViewCount() !== renderObjectFrees + 3) {
    throw new Error("Repeated scene transitions must retain every borrowed native view safely, including each MPEG frame");
}
if (imageDoubleFrees !== 0) {
    throw new Error(`Scene cleanup must not free an Image wrapper twice (${imageDoubleFrees} duplicate calls)`);
}

console.log(`Smoke test passed: ${manifest.sceneVertices + manifest.playerVertices} OBJ vertices, ${drawCalls / 2} draw calls/frame.`);
