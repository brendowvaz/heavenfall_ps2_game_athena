// {"name":"Ruinas do Veu Azul","author":"Codex + Brendan","version":"20062026","file":"main.js"}

// AthenaEnv/PS2 runtime. Static geometry is stored as OBJ chunks to avoid the
// Render.vertexList incompatibility present in some AthenaEnv builds.

const canvas = Screen.getMode();
canvas.zbuffering = true;
canvas.double_buffering = true;
canvas.psm = Screen.CT32;
canvas.psmz = Screen.Z16S;
Screen.setMode(canvas);
Screen.setFrameCounter(true);

let CLEAR_COLOR = Color.new(7, 15, 28, 128);
const HUD_WHITE = Color.new(210, 231, 246, 128);
const HUD_BLUE = Color.new(76, 184, 235, 128);

const font = new Font("default");
font.scale = 0.45;
font.color = HUD_WHITE;
font.outline = 1.0;
font.outline_color = Color.new(3, 8, 16, 128);

Screen.clear(CLEAR_COLOR);
Screen.setParam(Screen.DEPTH_TEST_ENABLE, false);
font.print(18, 18, "CARREGANDO RUINAS DO VEU AZUL...");
Screen.flip();

Render.init();
Render.setView(64.0, 0.5, 180.0);
console.log("[VeuAzul] Render inicializado em modo OBJ");

// AthenaEnv resolves OBJ materials and their textures from the current folder.
os.chdir("assets");
std.loadScript("collision.js");
if (std.exists("visual-scripting-runtime.js")) std.loadScript("visual-scripting-runtime.js");

let menuBackground = null;
if (std.exists("menu_background.png")) {
    try {
        menuBackground = new Image("menu_background.png");
        menuBackground.width = canvas.width;
        menuBackground.height = canvas.height;
        menuBackground.lock();
    } catch (menuBackgroundError) {
        console.log("[Heavenfall] Fundo do menu nao carregado: " + menuBackgroundError);
        menuBackground = null;
    }
}

const runtimeMaterialTextures = [];

function scaledMaterialColor(value, scale) {
    const color = value || { r: 1.0, g: 1.0, b: 1.0 };
    return {
        r: clamp(color.r * scale, 0.0, 1.0),
        g: clamp(color.g * scale, 0.0, 1.0),
        b: clamp(color.b * scale, 0.0, 1.0)
    };
}

function configureData(data, material) {
    const useSpecular = material && !material.unlit && material.metalness > 0.001;
    data.pipeline = material && material.unlit
        ? Render.PL_NO_LIGHTS
        : useSpecular && Render.PL_SPECULAR !== undefined ? Render.PL_SPECULAR : Render.PL_DEFAULT;
    data.texture_mapping = !material || material.textureMapping !== false;
    data.face_culling = !material || material.doubleSided !== false ? Render.CULL_FACE_NONE : Render.CULL_FACE_BACK;
    data.shade_model = material && material.smoothShading === false ? 0 : 1;
    data.accurate_clipping = material && material.accurateClipping === true;
    if (material && typeof data.updateMaterial === "function") {
        const base = material.color || { r: 1.0, g: 1.0, b: 1.0 };
        const metalness = clamp(material.metalness || 0.0, 0.0, 1.0);
        const roughness = clamp(material.roughness === undefined ? 0.72 : material.roughness, 0.0, 1.0);
        const emissionStrength = Math.max(0.0, material.emissiveIntensity || 0.0);
        const properties = {
            ambient: scaledMaterialColor(base, material.unlit ? 1.0 : 0.28),
            diffuse: scaledMaterialColor(base, material.unlit ? 1.0 : 1.0 - metalness * 0.45),
            specular: scaledMaterialColor(base, metalness),
            emission: scaledMaterialColor(material.emissive, emissionStrength),
            shininess: (1.0 - roughness) * 128.0,
            // The official AthenaEnv property is intentionally spelled "disolve".
            disolve: clamp(material.opacity === undefined ? 1.0 : material.opacity, 0.0, 1.0)
        };
        const materials = data.materials;
        const count = materials && materials.length ? materials.length : 1;
        for (let index = 0; index < count; index++) data.updateMaterial(index, properties);
    }
    return data;
}

function createRenderData(asset, material) {
    if (material && material.texture && std.exists(material.texture)) {
        try {
            const texture = new Image(material.texture);
            texture.lock();
            runtimeMaterialTextures.push(texture);
            return configureData(new RenderData(asset, texture), material);
        } catch (textureError) {
            console.log("[VeuAzul] Textura substituta nao carregada: " + material.texture + " - " + textureError);
        }
    }
    return configureData(new RenderData(asset), material);
}

// The visual editor writes this file whenever the scene is saved. Keeping the
// transform data in a tiny generated script avoids JSON parsing and path
// differences between PCSX2 HostFS and real hardware.
globalThis.EDITOR_SCENE = [];
globalThis.EDITOR_SCENE_META = { id: "", name: "" };
globalThis.EDITOR_SCENE_PROJECT = { version: 1, startupSceneId: "", scenes: [] };
globalThis.EDITOR_SETTINGS = {};
globalThis.EDITOR_COLLIDERS = [];
globalThis.EDITOR_EVENTS = [];
globalThis.EDITOR_LOGIC = { version: 1, variables: [], graphs: [] };
globalThis.EDITOR_LIGHTS = [];
globalThis.EDITOR_POINT_LIGHTS = [];
globalThis.EDITOR_CAMERA = null;
globalThis.EDITOR_UI = [];
globalThis.EDITOR_AUDIO = [];
globalThis.EDITOR_PARTICLES = [];
globalThis.EDITOR_SHADOWS = [];
if (std.exists("scenes/project.generated.js")) {
    std.loadScript("scenes/project.generated.js");
}
if (std.exists("scene.generated.js")) {
    std.loadScript("scene.generated.js");
}

const runtimeBackground = EDITOR_SETTINGS.background || { r: 7, g: 15, b: 28, a: 128 };
CLEAR_COLOR = Color.new(runtimeBackground.r, runtimeBackground.g, runtimeBackground.b, runtimeBackground.a);
Screen.setVSync(EDITOR_SETTINGS.vsync !== false);

if (EDITOR_CAMERA) {
    Render.setView(EDITOR_CAMERA.fov || 64.0, EDITOR_CAMERA.near || 0.5, EDITOR_CAMERA.far || 180.0);
}

const usingEditorColliders = EDITOR_COLLIDERS.length > 0;

if (EDITOR_COLLIDERS.length === 0) {
    const legacyColliders = [
        [-2.8, -1.5, 1.52], [3.5, -5.0, 1.32], [1.0, 5.0, 1.0],
        [-8.2, 5.2, 0.92], [8.0, -0.3, 0.86],
        [-4.55, 17.4, 1.1], [4.55, 15.0, 1.1]
    ];
    for (let i = 0; i < legacyColliders.length; i++) {
        const legacy = legacyColliders[i];
        EDITOR_COLLIDERS.push({
            name: "Legacy collider " + i,
            shape: "sphere",
            position: { x: legacy[0], y: 1.0, z: legacy[1] },
            rotation: { x: 0.0, y: 0.0, z: 0.0 },
            scale: { x: legacy[2], y: legacy[2], z: legacy[2] },
            trigger: false,
            cameraBlocker: true
        });
    }
}

// Backward-compatible fallback for builds made before the editor existed.
if (EDITOR_SCENE.length === 0) {
    for (let i = 0; i < 7; i++) {
        EDITOR_SCENE.push({
            name: "Cenario bloco " + i,
            asset: "scene_" + i + ".obj",
            position: { x: 0.0, y: 0.0, z: 0.0 },
            rotation: { x: 0.0, y: 0.0, z: 0.0 },
            scale: { x: 1.0, y: 1.0, z: 1.0 }
        });
    }
}

const sceneObjects = [];
const runtimeObjectVisibility = {};
for (let i = 0; i < EDITOR_SCENE.length; i++) {
    const definition = EDITOR_SCENE[i];
    console.log("[VeuAzul] Carregando objeto " + definition.name + " (" + definition.asset + ")");
    const sceneData = createRenderData(definition.asset, definition.material);
    const sceneObject = new RenderObject(sceneData);
    sceneObject.position = definition.position;
    sceneObject.rotation = definition.rotation;
    sceneObject.scale = definition.scale;
    sceneObjects.push(sceneObject);
    runtimeObjectVisibility[definition.id] = true;
}

const runtimeAnimationCollections = [];
for (let animationIndex = 0; animationIndex < sceneObjects.length; animationIndex++) {
    const definition = EDITOR_SCENE[animationIndex];
    if (!definition.animation || !definition.animation.autoplay || !/\.(gltf|glb)$/i.test(definition.asset)) continue;
    if (typeof AnimCollection === "undefined" || typeof sceneObjects[animationIndex].playAnim !== "function") continue;
    try {
        const animations = new AnimCollection(definition.asset);
        const clip = definition.animation.clip && animations[definition.animation.clip] !== undefined
            ? animations[definition.animation.clip]
            : animations[0];
        if (clip !== undefined) sceneObjects[animationIndex].playAnim(clip, definition.animation.loop !== false);
        runtimeAnimationCollections.push(animations);
    } catch (animationError) {
        console.log("[VeuAzul] Animacao nao carregada: " + definition.asset + " - " + animationError);
    }
}

const playerData = configureData(new RenderData("player.obj"));
const playerObject = new RenderObject(playerData);
console.log("[VeuAzul] " + sceneObjects.length + " objetos, jogador e colisoes prontos");

const MAX_RUNTIME_LIGHTS = 4;
const reservedPointSlots = Math.min(2, EDITOR_POINT_LIGHTS.length);
const globalLightBudget = MAX_RUNTIME_LIGHTS - reservedPointSlots;
const runtimeLights = [];
for (let i = 0; i < EDITOR_LIGHTS.length && runtimeLights.length < globalLightBudget; i++) {
        const definition = EDITOR_LIGHTS[i];
        // Older generated scenes approximated point lights as global directional
        // lights. Ignore them so their finite editor range is not misrepresented.
        if (definition.type === "point") continue;
        const light = Lights.new();
        const intensity = Math.max(0.0, definition.intensity || 0.0);
        const color = definition.color || { r: 1.0, g: 1.0, b: 1.0 };
        const direction = definition.direction || { x: -0.35, y: 0.85, z: 0.45 };
        Lights.set(light, Lights.DIRECTION, direction.x, direction.y, direction.z);
        if (definition.type === "ambient") {
            Lights.set(light, Lights.AMBIENT, Math.min(1.0, color.r * intensity), Math.min(1.0, color.g * intensity), Math.min(1.0, color.b * intensity));
            Lights.set(light, Lights.DIFFUSE, 0.0, 0.0, 0.0);
        } else {
            Lights.set(light, Lights.AMBIENT, 0.0, 0.0, 0.0);
            Lights.set(light, Lights.DIFFUSE, Math.min(1.0, color.r * intensity), Math.min(1.0, color.g * intensity), Math.min(1.0, color.b * intensity));
        }
        runtimeLights.push(light);
}
if (runtimeLights.length === 0 && EDITOR_POINT_LIGHTS.length === 0) {
    const iceLight = Lights.new();
    Lights.set(iceLight, Lights.DIRECTION, -0.35, 0.85, 0.45);
    Lights.set(iceLight, Lights.AMBIENT, 0.15, 0.22, 0.32);
    Lights.set(iceLight, Lights.DIFFUSE, 0.78, 0.90, 1.0);
    runtimeLights.push(iceLight);
}

// AthenaEnv exposes directional lights, but not a native point-light range.
// Reusing directional slots and changing them before each draw gives each
// existing scene block a local response based on its exported spatial center.
const runtimePointLights = [];
for (let i = 0; i < EDITOR_POINT_LIGHTS.length && runtimeLights.length + runtimePointLights.length < MAX_RUNTIME_LIGHTS; i++) {
    const definition = EDITOR_POINT_LIGHTS[i];
    const light = Lights.new();
    Lights.set(light, Lights.DIRECTION, 0.0, 1.0, 0.0);
    Lights.set(light, Lights.AMBIENT, 0.0, 0.0, 0.0);
    Lights.set(light, Lights.DIFFUSE, 0.0, 0.0, 0.0);
    let seed = 0;
    const seedText = definition.id || definition.name || String(i);
    for (let character = 0; character < seedText.length; character++) {
        seed = (seed + seedText.charCodeAt(character) * (character + 1)) % 997;
    }
    runtimePointLights.push({ light: light, definition: definition, seed: seed });
}
let pointLightTime = 0.0;

function pointLightFlicker(entry) {
    const definition = entry.definition;
    if (!definition.flicker) return 1.0;
    const speed = Math.max(0.1, definition.flickerSpeed || 7.5);
    const amount = clamp(definition.flickerAmount === undefined ? 0.24 : definition.flickerAmount, 0.0, 1.0);
    const time = pointLightTime * speed;
    const wave = Math.sin(time * 1.11 + entry.seed) * 0.52
        + Math.sin(time * 2.73 + entry.seed * 0.37) * 0.31
        + Math.sin(time * 5.17 + entry.seed * 0.13) * 0.17;
    return Math.max(0.1, 1.0 + wave * amount);
}

function applyPointLightsAt(x, y, z) {
    for (let i = 0; i < runtimePointLights.length; i++) {
        const entry = runtimePointLights[i];
        const definition = entry.definition;
        const position = definition.position || { x: 0.0, y: 0.0, z: 0.0 };
        const dx = position.x - x;
        const dy = position.y - y;
        const dz = position.z - z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const range = Math.max(0.1, definition.distance || 12.0);
        let attenuation = Math.max(0.0, 1.0 - distance / range);
        attenuation *= attenuation;
        const inverseDistance = distance > 0.0001 ? 1.0 / distance : 0.0;
        const directionX = distance > 0.0001 ? dx * inverseDistance : 0.0;
        const directionY = distance > 0.0001 ? dy * inverseDistance : 1.0;
        const directionZ = distance > 0.0001 ? dz * inverseDistance : 0.0;
        const color = definition.color || { r: 1.0, g: 0.6, b: 0.25 };
        const strength = Math.max(0.0, definition.intensity || 0.0) * attenuation * pointLightFlicker(entry);
        Lights.set(entry.light, Lights.DIRECTION, directionX, directionY, directionZ);
        Lights.set(entry.light, Lights.DIFFUSE,
            Math.min(1.0, color.r * strength),
            Math.min(1.0, color.g * strength),
            Math.min(1.0, color.b * strength)
        );
    }
}

function disablePointLights() {
    for (let i = 0; i < runtimePointLights.length; i++) {
        Lights.set(runtimePointLights[i].light, Lights.DIFFUSE, 0.0, 0.0, 0.0);
    }
}

if (runtimePointLights.length > 0) {
    console.log("[VeuAzul] " + runtimePointLights.length + " luz(es) pontual(is) simulada(s) por bloco");
}

Screen.setParam(Screen.DEPTH_TEST_ENABLE, true);
Screen.setParam(Screen.DEPTH_TEST_METHOD, Screen.DEPTH_GEQUAL);

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function baseWalkable(x, z) {
    if (EDITOR_SETTINGS.legacyArenaBounds === false) return true;
    const arena = (x * x) / (15.1 * 15.1) + ((z + 3.0) * (z + 3.0)) / (14.2 * 14.2) <= 1.0;
    const northHall = z >= -28.2 && z <= -10.0 && Math.abs(x) <= 5.3 + (z + 28.2) * 0.12;
    const southHall = z >= 6.0 && z <= 25.2 && Math.abs(x) <= 5.7 - Math.max(0.0, z - 18.0) * 0.10;
    return arena || northHall || southHall;
}

const collisionShapes = Collision3D.normalizeAll(EDITOR_COLLIDERS);
let hasRuntimeTriggers = false;
for (let i = 0; i < collisionShapes.length; i++) {
    if (collisionShapes[i].trigger) {
        hasRuntimeTriggers = true;
        break;
    }
}
const cameraBlockers = [];
for (let i = 0; i < collisionShapes.length; i++) {
    if (collisionShapes[i].cameraBlocker) cameraBlockers.push(collisionShapes[i]);
}
if (!usingEditorColliders) {
    const legacyCameraBlockers = [
        [-12.5, -10.0, 1.5], [12.2, -9.0, 1.5],
        [-13.8, 2.5, 1.4], [13.7, 3.6, 1.5],
        [-9.0, 11.2, 1.4], [9.5, 10.0, 1.4]
    ];
    for (let i = 0; i < legacyCameraBlockers.length; i++) {
        const blocker = legacyCameraBlockers[i];
        cameraBlockers.push(Collision3D.normalize({
            id: "legacy-camera-" + i,
            shape: "sphere",
            position: { x: blocker[0], y: 1.0, z: blocker[1] },
            rotation: { x: 0.0, y: 0.0, z: 0.0 },
            scale: { x: blocker[2], y: blocker[2], z: blocker[2] },
            trigger: false,
            cameraBlocker: true
        }, i));
    }
}
console.log("[VeuAzul] Colisao 3D: " + collisionShapes.length + " colisores, " + cameraBlockers.length + " bloqueadores de camera");

const runtimePlayer = EDITOR_SETTINGS.player || {};
const PLAYER_RADIUS = Math.max(0.1, runtimePlayer.radius || 0.68);
const PLAYER_HEIGHT = Math.max(PLAYER_RADIUS * 2.0, runtimePlayer.height || 2.25);
const PLAYER_GROUND_Y = runtimePlayer.spawn && runtimePlayer.spawn.y !== undefined ? runtimePlayer.spawn.y : 0.08;
const WALK_SPEED = Math.max(0.01, runtimePlayer.walkSpeed || 0.125);
const RUN_SPEED = Math.max(WALK_SPEED, runtimePlayer.runSpeed || 0.19);
const JUMP_SPEED = Math.max(0.0, runtimePlayer.jumpSpeed === undefined ? 0.30 : runtimePlayer.jumpSpeed);
const GRAVITY = Math.max(0.0001, runtimePlayer.gravity || 0.014);
const SUPPORT_PROBE = 0.08;
const LANDING_SEARCH_STEPS = 7;
const SPAWN = runtimePlayer.spawn || { x: 0.0, y: PLAYER_GROUND_Y, z: 18.0 };
let playerX = SPAWN.x;
let playerZ = SPAWN.z;
let playerY = PLAYER_GROUND_Y;
let playerVelocityY = 0.0;
let playerGrounded = true;
let playerYaw = 0.0;
let cameraYaw = EDITOR_CAMERA ? EDITOR_CAMERA.rotation.y : 0.0;
let cameraPitch = 0.31;
let shoulderSide = 1.0;
let showHud = true;
let titleTimer = 330;
let collisionFlash = 0;
let activeTriggerIds = [];
let previousTriggerIds = [];
let runtimeMessageText = "";
let runtimeMessageTimer = 0;
const GAME_STATE_MENU = 0;
const GAME_STATE_CREDITS = 1;
const GAME_STATE_GAME = 2;
const MENU_AUDIO_ASSET = "sounds/menu.wav";
const MENU_AUDIO_VOLUME = 100;
const MENU_OPTIONS = ["Iniciar Jogo", "Créditos"];
let gameState = GAME_STATE_MENU;
let menuSelection = 0;
let menuStickLocked = false;
let menuPulse = 0;
let menuFrame = 0;
let menuAudioRequested = false;
let menuAudioStarted = false;
let runtimeAutoplayStarted = false;

Sound.setVolume(100);
let menuAudio = null;
if (std.exists(MENU_AUDIO_ASSET)) {
    try {
        menuAudio = Sound.Stream(MENU_AUDIO_ASSET);
        menuAudio.loop = true;
        console.log("[Heavenfall] Musica do menu pronta: " + MENU_AUDIO_ASSET + " (" + menuAudio.length + " ms)");
    } catch (menuAudioError) {
        console.log("[Heavenfall] Musica do menu nao carregada: " + menuAudioError);
        menuAudio = null;
    }
}

const runtimeAudio = [];
for (let audioIndex = 0; audioIndex < EDITOR_AUDIO.length; audioIndex++) {
    const definition = EDITOR_AUDIO[audioIndex];
    try {
        const sound = definition.mode === "sfx" ? Sound.Sfx(definition.asset) : Sound.Stream(definition.asset);
        if (definition.mode === "sfx") {
            sound.volume = definition.volume;
            sound.pan = definition.pan || 0;
            sound.loop = definition.loop === true;
            sound.pitch = definition.pitch || 0;
        } else {
            sound.loop = definition.loop === true;
        }
        runtimeAudio.push({
            definition: definition,
            sound: sound,
            requested: false,
            started: false,
            channel: -1
        });
        if (definition.mode === "stream") {
            console.log("[VeuAzul] Stream pronto: " + definition.asset + " (" + sound.length + " ms)");
        }
    } catch (audioError) {
        console.log("[VeuAzul] Audio nao carregado: " + definition.asset + " - " + audioError);
    }
}

function runtimeAudioById(id) {
    for (let i = 0; i < runtimeAudio.length; i++) {
        if (runtimeAudio[i].definition.id === id) return runtimeAudio[i];
    }
    return null;
}

function playRuntimeAudio(entry) {
    if (!entry) return;
    const definition = entry.definition;
    if (definition.mode === "stream") {
        Sound.setVolume(definition.volume);
        entry.sound.loop = definition.loop === true;
        entry.requested = true;
        entry.started = false;
        entry.sound.play();
        entry.started = entry.sound.playing();
        console.log(
            "[VeuAzul] Audio " + (entry.started ? "tocando" : "aguardando") +
            ": " + definition.asset
        );
        return;
    }
    entry.sound.volume = definition.volume;
    entry.sound.pan = definition.pan || 0;
    entry.sound.loop = definition.loop === true;
    entry.sound.pitch = definition.pitch || 0;
    const channel = entry.sound.play();
    entry.channel = channel === undefined ? -1 : channel;
    entry.requested = definition.loop === true;
}

function playMenuAudio() {
    if (!menuAudio) return;
    Sound.setVolume(MENU_AUDIO_VOLUME);
    menuAudio.loop = true;
    menuAudioRequested = true;
    if (menuAudio.playing()) {
        menuAudioStarted = true;
        return;
    }
    menuAudio.play();
    menuAudioStarted = menuAudio.playing();
}

function stopMenuAudio() {
    if (!menuAudio || (!menuAudioRequested && !menuAudioStarted)) return;
    menuAudioRequested = false;
    if (menuAudio.playing()) menuAudio.pause();
    menuAudio.rewind();
    menuAudioStarted = false;
}

function updateMenuAudio() {
    if (!menuAudio) return;
    if (!menuAudioRequested) playMenuAudio();
    if (!menuAudioRequested) return;
    if (menuAudio.playing()) {
        menuAudioStarted = true;
        return;
    }
    Sound.setVolume(MENU_AUDIO_VOLUME);
    menuAudio.loop = true;
    menuAudio.play();
    menuAudioStarted = menuAudio.playing();
}

function startRuntimeAutoplayAudio() {
    if (runtimeAutoplayStarted) return;
    runtimeAutoplayStarted = true;
    for (let audioIndex = 0; audioIndex < runtimeAudio.length; audioIndex++) {
        if (runtimeAudio[audioIndex].definition.autoplay) playRuntimeAudio(runtimeAudio[audioIndex]);
    }
}

function controlRuntimeAudio(id, mode) {
    const entry = runtimeAudioById(id);
    if (!entry) return;
    if (mode === "stop") {
        entry.requested = false;
        if (entry.definition.mode === "stream") {
            entry.sound.pause();
            entry.sound.rewind();
            entry.started = false;
        }
        return;
    }
    playRuntimeAudio(entry);
}

function updateRuntimeAudio() {
    for (let i = 0; i < runtimeAudio.length; i++) {
        const entry = runtimeAudio[i];
        const definition = entry.definition;
        if (definition.mode === "stream") {
            if (!entry.requested) continue;
            if (entry.sound.playing()) {
                entry.started = true;
                continue;
            }
            if (entry.started && !definition.loop) {
                entry.requested = false;
                continue;
            }
            Sound.setVolume(definition.volume);
            entry.sound.loop = definition.loop === true;
            entry.sound.play();
            entry.started = entry.sound.playing();
            continue;
        }
        if (definition.spatial) {
            const dx = definition.position.x - playerX;
            const dy = definition.position.y - playerY;
            const dz = definition.position.z - playerZ;
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const range = Math.max(0.1, definition.distance || 14.0);
            const attenuation = clamp(1.0 - distance / range, 0.0, 1.0);
            const rightAmount = dx * Math.cos(cameraYaw) + dz * Math.sin(cameraYaw);
            entry.sound.volume = Math.round(definition.volume * attenuation);
            entry.sound.pan = Math.round(clamp((definition.pan || 0) + rightAmount / range * 100.0, -100.0, 100.0));
        } else {
            entry.sound.volume = definition.volume;
            entry.sound.pan = definition.pan || 0;
        }
        entry.sound.pitch = definition.pitch || 0;
        if (entry.requested) {
            const playing = entry.channel >= 0 && entry.sound.playing(entry.channel);
            if (!playing) {
                const channel = entry.sound.play();
                entry.channel = channel === undefined ? -1 : channel;
            }
        }
    }
}

const runtimeParticleEmitters = [];
for (let emitterIndex = 0; emitterIndex < EDITOR_PARTICLES.length; emitterIndex++) {
    const definition = EDITOR_PARTICLES[emitterIndex];
    try {
        const particleData = configureData(new RenderData(definition.asset), { unlit: true });
        particleData.texture_mapping = false;
        if (definition.color && typeof particleData.updateMaterial === "function") {
            particleData.updateMaterial(0, {
                ambient: definition.color,
                diffuse: definition.color,
                specular: { r: 0.0, g: 0.0, b: 0.0 }
            });
        }
        const pool = [];
        for (let particleIndex = 0; particleIndex < definition.maxParticles; particleIndex++) {
            const object = new RenderObject(particleData);
            object.position = definition.position;
            object.rotation = { x: 0.0, y: 0.0, z: 0.0 };
            object.scale = { x: 0.0, y: 0.0, z: 0.0 };
            pool.push({ object: object, alive: false, age: 0.0, life: definition.lifetime, progress: 0.0, x: 0.0, y: 0.0, z: 0.0 });
        }
        runtimeParticleEmitters.push({
            definition: definition,
            // Some AthenaEnv builds do not retain the JS RenderData wrapper in
            // RenderObject. Keep it reachable for the lifetime of the emitter
            // so its native vertex buffers cannot be collected mid-DMA.
            data: particleData,
            pool: pool,
            enabled: definition.autoplay === true,
            elapsedSeconds: 0.0,
            burstFrames: 0
        });
    } catch (particleError) {
        console.log("[VeuAzul] Particulas nao carregadas: " + definition.asset + " - " + particleError);
    }
}

const runtimeShadows = [];
if (typeof Shadows !== "undefined") {
    for (let shadowIndex = 0; shadowIndex < EDITOR_SHADOWS.length; shadowIndex++) {
        const definition = EDITOR_SHADOWS[shadowIndex];
        try {
            const texture = new Image(definition.asset);
            texture.lock();
            const projector = new Shadows.Projector(texture);
            projector.setSize(definition.width, definition.height);
            projector.setGrid(definition.gridX, definition.gridZ);
            projector.setLightDir(
                definition.lightDirection.x,
                definition.lightDirection.y,
                definition.lightDirection.z
            );
            projector.setBias(definition.bias);
            projector.setLightOffset(definition.lightOffset);
            projector.setColor(
                definition.color.r,
                definition.color.g,
                definition.color.b,
                definition.opacity
            );
            const blendMode = definition.blend === "alpha"
                ? Shadows.SHADOW_BLEND_ALPHA
                : definition.blend === "add" ? Shadows.SHADOW_BLEND_ADD : Shadows.SHADOW_BLEND_DARKEN;
            projector.setBlend(blendMode);
            projector.position = definition.position;
            runtimeShadows.push({ definition: definition, projector: projector, texture: texture });
        } catch (shadowError) {
            console.log("[VeuAzul] Projetor de sombra nao carregado: " + definition.asset + " - " + shadowError);
        }
    }
}

function renderRuntimeShadows() {
    for (let i = 0; i < runtimeShadows.length; i++) {
        const entry = runtimeShadows[i];
        if (entry.definition.followPlayer) {
            entry.projector.position = {
                x: playerX,
                y: entry.definition.position.y,
                z: playerZ
            };
        }
        entry.projector.render();
    }
}

function particleEmitterById(id) {
    for (let i = 0; i < runtimeParticleEmitters.length; i++) {
        if (runtimeParticleEmitters[i].definition.id === id) return runtimeParticleEmitters[i];
    }
    return null;
}

function updateLegacyParticle(particle, definition, particleIndex, particleCount, elapsedSeconds) {
    const seed = (particleIndex * 73 + 19) % 101;
    const progress = (elapsedSeconds * definition.rate / Math.max(1, particleCount) + particleIndex / Math.max(1, particleCount)) % 1.0;
    const angle = seed * 2.399;
    const radial = ((seed * 37) % 100) / 100.0 * definition.spread;
    const ageFrames = progress * definition.lifetime;
    let x = Math.cos(angle) * radial;
    let z = Math.sin(angle) * radial;
    let y = definition.speed * ageFrames - definition.gravity * ageFrames * ageFrames * 0.5;
    if (definition.preset === "smoke") {
        x += Math.sin(progress * 5.0 + seed) * definition.spread * 0.35;
        z += Math.cos(progress * 4.0 + seed) * definition.spread * 0.35;
    } else if (definition.preset === "sparks") {
        x += Math.cos(angle) * definition.speed * ageFrames;
        z += Math.sin(angle) * definition.speed * ageFrames;
        y = definition.speed * ageFrames * 0.75 - Math.abs(definition.gravity || 0.002) * ageFrames * ageFrames * 0.5;
    }
    y *= Math.max(0.2, definition.lifetime / 60.0);
    particle.alive = true;
    particle.age = ageFrames;
    particle.life = definition.lifetime;
    particle.progress = progress;
    particle.x = definition.position.x + x;
    particle.y = definition.position.y + y;
    particle.z = definition.position.z + z;
}

function controlParticleEmitter(id, mode) {
    const emitter = particleEmitterById(id);
    if (!emitter) return;
    if (mode === "stop") {
        emitter.enabled = false;
        emitter.burstFrames = 0;
        for (let i = 0; i < emitter.pool.length; i++) emitter.pool[i].alive = false;
        return;
    }
    if (mode === "start") {
        emitter.enabled = true;
        return;
    }
    emitter.elapsedSeconds = 0.0;
    emitter.burstFrames = Math.max(1, emitter.definition.lifetime);
    for (let i = 0; i < emitter.pool.length; i++) emitter.pool[i].alive = true;
}

function updateAndRenderParticles() {
    for (let emitterIndex = 0; emitterIndex < runtimeParticleEmitters.length; emitterIndex++) {
        const emitter = runtimeParticleEmitters[emitterIndex];
        const definition = emitter.definition;
        const active = emitter.enabled || emitter.burstFrames > 0;
        if (!active) continue;
        emitter.elapsedSeconds += 1.0 / 60.0;
        for (let particleIndex = 0; particleIndex < emitter.pool.length; particleIndex++) {
            const particle = emitter.pool[particleIndex];
            updateLegacyParticle(particle, definition, particleIndex, emitter.pool.length, emitter.elapsedSeconds);
            const progress = particle.progress;
            const scale = definition.size;
            particle.object.position = { x: particle.x, y: particle.y, z: particle.z };
            particle.object.rotation = { x: progress * 2.0, y: progress * 3.0 + particleIndex, z: progress };
            particle.object.scale = { x: scale, y: scale, z: scale };
            particle.object.render();
        }
        if (emitter.burstFrames > 0) {
            emitter.burstFrames--;
            if (emitter.burstFrames === 0 && !emitter.enabled) {
                for (let i = 0; i < emitter.pool.length; i++) emitter.pool[i].alive = false;
            }
        }
    }
}

function arrayContains(items, value) {
    for (let i = 0; i < items.length; i++) if (items[i] === value) return true;
    return false;
}

function executeRuntimeAction(action) {
    if (!action) return;
    if (action.type === "message") {
        runtimeMessageText = action.text || "";
        runtimeMessageTimer = Math.max(1, action.duration || 180);
        return;
    }
    if (action.type === "visibility") {
        const targets = action.targetIds || (action.targetId ? [action.targetId] : []);
        for (let i = 0; i < targets.length; i++) {
            const id = targets[i];
            if (runtimeObjectVisibility[id] === undefined) continue;
            if (action.mode === "show") runtimeObjectVisibility[id] = true;
            else if (action.mode === "hide") runtimeObjectVisibility[id] = false;
            else runtimeObjectVisibility[id] = !runtimeObjectVisibility[id];
        }
        return;
    }
    if (action.type === "audio") {
        controlRuntimeAudio(action.targetId, action.mode || "play");
        return;
    }
    if (action.type === "particle") {
        controlParticleEmitter(action.targetId, action.mode || "burst");
        return;
    }
    if (action.type === "video") {
        controlRuntimeVideo(action.targetId, action.mode || "play");
        return;
    }
    if (action.type === "teleport") {
        const position = action.position || { x: 0.0, y: PLAYER_GROUND_Y, z: 18.0 };
        playerX = position.x;
        playerY = position.y;
        playerZ = position.z;
        playerVelocityY = 0.0;
        playerGrounded = playerY <= PLAYER_GROUND_Y + 0.001;
    }
}

function runTriggerPhase(triggerId, phase) {
    for (let i = 0; i < EDITOR_EVENTS.length; i++) {
        const definition = EDITOR_EVENTS[i];
        if (definition.triggerId !== triggerId) continue;
        const actions = definition[phase] || [];
        for (let actionIndex = 0; actionIndex < actions.length; actionIndex++) {
            executeRuntimeAction(actions[actionIndex]);
        }
    }
    if (runtimeVisualScripts) runtimeVisualScripts.trigger(triggerId, phase);
}

function processRuntimeEvents() {
    for (let i = 0; i < activeTriggerIds.length; i++) {
        const id = activeTriggerIds[i];
        if (!arrayContains(previousTriggerIds, id)) runTriggerPhase(id, "onEnter");
    }
    for (let i = 0; i < previousTriggerIds.length; i++) {
        const id = previousTriggerIds[i];
        if (!arrayContains(activeTriggerIds, id)) runTriggerPhase(id, "onExit");
    }
    if (pad.justPressed(Pads.TRIANGLE)) {
        for (let i = 0; i < activeTriggerIds.length; i++) runTriggerPhase(activeTriggerIds[i], "onInteract");
    }
    previousTriggerIds = activeTriggerIds.slice();
}

function colliderHits(x, z, radius, collider) {
    const normalized = collider.qw === undefined ? Collision3D.normalize(collider, 0) : collider;
    if (normalized.trigger) return false;
    return Collision3D.sphereHits(normalized, x, normalized.position.y, z, radius);
}

function playerContactsAt(x, y, z) {
    return Collision3D.playerContacts(collisionShapes, x, y, z, PLAYER_RADIUS, PLAYER_HEIGHT, false);
}

let movementContactCache = [];

function resetMovementContactCache() {
    movementContactCache = [];
}

function movementContactsAt(x, y, z) {
    for (let i = 0; i < movementContactCache.length; i++) {
        const cached = movementContactCache[i];
        if (Math.abs(cached.x - x) < 0.0001 && Math.abs(cached.y - y) < 0.0001 && Math.abs(cached.z - z) < 0.0001) {
            return cached.contacts;
        }
    }
    const contacts = playerContactsAt(x, y, z);
    movementContactCache.push({ x: x, y: y, z: z, contacts: contacts });
    return contacts;
}

function updateActiveTriggers() {
    if (!hasRuntimeTriggers) {
        activeTriggerIds = [];
        return;
    }
    const triggers = Collision3D.playerContacts(
        collisionShapes, playerX, playerY, playerZ, PLAYER_RADIUS, PLAYER_HEIGHT, true
    );
    activeTriggerIds = [];
    for (let i = 0; i < triggers.length; i++) activeTriggerIds.push(triggers[i].id);
}

function isPlayerValid(x, z) {
    if (!baseWalkable(x, z)) return false;
    return playerContactsAt(x, playerY, z).length === 0;
}

function walkableHalfWidth(z) {
    if (EDITOR_SETTINGS.legacyArenaBounds === false) return 100000.0;
    if (z >= 6.0) return 5.25;
    if (z <= -10.0) return 4.85;
    const normalized = (z + 3.0) / 14.2;
    const ellipse = Math.sqrt(Math.max(0.0, 1.0 - normalized * normalized)) * 15.1;
    return Math.max(5.0, ellipse - PLAYER_RADIUS);
}

function movementAllowed(currentContacts, x, z) {
    if (!baseWalkable(x, z)) return false;
    const nextContacts = movementContactsAt(x, playerY, z);
    return Collision3D.transitionAllowed(currentContacts, nextContacts);
}

function applyMovement(dx, dz) {
    resetMovementContactCache();
    const oldX = playerX;
    const oldZ = playerZ;
    const boundedArena = EDITOR_SETTINGS.legacyArenaBounds !== false;
    const nextZ = boundedArena ? clamp(playerZ + dz, -27.4, 24.4) : playerZ + dz;
    const halfWidth = walkableHalfWidth(nextZ);
    const nextX = boundedArena ? clamp(playerX + dx, -halfWidth, halfWidth) : playerX + dx;
    let currentContacts = movementContactsAt(playerX, playerY, playerZ);

    if (movementAllowed(currentContacts, nextX, nextZ)) {
        playerX = nextX;
        playerZ = nextZ;
    } else {
        if (movementAllowed(currentContacts, nextX, playerZ)) {
            playerX = nextX;
            currentContacts = movementContactsAt(playerX, playerY, playerZ);
        }
        if (movementAllowed(currentContacts, playerX, nextZ)) playerZ = nextZ;
    }

    const moved = Math.abs(playerX - oldX) + Math.abs(playerZ - oldZ) > 0.0001;
    collisionFlash = moved ? 0 : 5;
    return moved;
}

function updateVerticalMovement() {
    if (playerGrounded) {
        if (playerY <= PLAYER_GROUND_Y + 0.001) return;
        const supportContacts = playerContactsAt(playerX, playerY - SUPPORT_PROBE, playerZ);
        if (supportContacts.length > 0) return;
        playerGrounded = false;
        playerVelocityY = Math.min(0.0, playerVelocityY);
    }

    const nextY = playerY + playerVelocityY;
    const currentContacts = playerContactsAt(playerX, playerY, playerZ);
    const nextContacts = playerContactsAt(playerX, nextY, playerZ);

    if (Collision3D.transitionAllowed(currentContacts, nextContacts)) {
        playerY = nextY;
    } else {
        if (playerVelocityY < 0.0) {
            // Refine the landing height between the last safe and first blocked
            // positions so the support probe remains stable on the next frame.
            let blockedY = nextY;
            let safeY = playerY;
            for (let step = 0; step < LANDING_SEARCH_STEPS; step++) {
                const middleY = (blockedY + safeY) * 0.5;
                if (playerContactsAt(playerX, middleY, playerZ).length > 0) blockedY = middleY;
                else safeY = middleY;
            }
            playerY = safeY;
            playerGrounded = true;
        }
        playerVelocityY = 0.0;
    }

    if (!playerGrounded) playerVelocityY -= GRAVITY;
    if (playerY <= PLAYER_GROUND_Y) {
        playerY = PLAYER_GROUND_Y;
        playerVelocityY = 0.0;
        playerGrounded = true;
    }
}

function cameraBlocked(x, y, z) {
    return Collision3D.cameraBlocked(cameraBlockers, x, y, z, 0.35);
}

let cameraCollisionCooldown = 0;
let cachedCameraFactor = 1.0;

const pad = Pads.get(0);
pad.update();

function executeVisualScriptAction(type, config) {
    if (type === "actionMessage") executeRuntimeAction({ type: "message", text: config.text, duration: config.duration });
    else if (type === "actionVisibility") executeRuntimeAction({
        type: "visibility", targetId: config.targetId, targetIds: config.targetIds, mode: config.mode
    });
    else if (type === "actionTeleport") executeRuntimeAction({ type: "teleport", position: config.position });
    else if (type === "actionAudio") executeRuntimeAction({ type: "audio", targetId: config.targetId, mode: config.mode });
    else if (type === "actionParticle") executeRuntimeAction({ type: "particle", targetId: config.targetId, mode: config.mode });
    else if (type === "actionVideo") executeRuntimeAction({ type: "video", targetId: config.targetId, mode: config.mode });
}

const runtimeVisualScripts = typeof VisualScriptingRuntime !== "undefined"
    ? VisualScriptingRuntime.create(EDITOR_LOGIC, {
        execute: executeVisualScriptAction,
        buttonPressed: function (buttonName) {
            const button = Pads[buttonName];
            return button !== undefined && pad.justPressed(button);
        },
        log: function (message) { console.log("[VisualScript] " + message); }
    })
    : null;

// AthenaEnv builds differ: some expose signed axes centered at 0, while others
// expose unsigned axes centered at 128. Detect the active convention at boot.
const unsignedAxes = pad.lx > 64 && pad.lx < 192 && pad.ly > 64 && pad.ly < 192;
console.log("[VeuAzul] Pad raw: " + pad.lx + "," + pad.ly + " unsigned=" + unsignedAxes);

function readAxis(value) {
    if (value === undefined || value === null) return 0.0;
    const centered = unsignedAxes ? value - 128.0 : value;
    return Math.abs(centered) > 24 ? clamp(centered / 127.0, -1.0, 1.0) : 0.0;
}

function buttonHeld(button) {
    return pad.pressed(button) || ((pad.btns & button) !== 0);
}

function moveMenuSelection(direction) {
    menuSelection += direction;
    if (menuSelection < 0) menuSelection = MENU_OPTIONS.length - 1;
    if (menuSelection >= MENU_OPTIONS.length) menuSelection = 0;
    menuPulse = 12;
}

function startExistingScenario() {
    stopMenuAudio();
    startRuntimeAutoplayAudio();
    gameState = GAME_STATE_GAME;
    titleTimer = 330;
    collisionFlash = 0;
    runtimeMessageTimer = 0;
    if (runtimeVisualScripts) runtimeVisualScripts.start();
}

function updateMenuInput() {
    pad.update();

    let direction = 0;
    if (pad.justPressed(Pads.UP) || pad.justPressed(Pads.LEFT)) direction = -1;
    else if (pad.justPressed(Pads.DOWN) || pad.justPressed(Pads.RIGHT)) direction = 1;

    const stickX = readAxis(pad.lx);
    const stickY = readAxis(pad.ly);
    let analogDirection = 0;
    if (Math.abs(stickY) >= Math.abs(stickX)) {
        if (stickY < -0.55) analogDirection = -1;
        else if (stickY > 0.55) analogDirection = 1;
    } else {
        if (stickX < -0.55) analogDirection = -1;
        else if (stickX > 0.55) analogDirection = 1;
    }

    if (analogDirection === 0 && Math.abs(stickX) < 0.35 && Math.abs(stickY) < 0.35) {
        menuStickLocked = false;
    } else if (analogDirection !== 0 && !menuStickLocked) {
        direction = analogDirection;
        menuStickLocked = true;
    }

    if (direction !== 0) moveMenuSelection(direction);

    if (pad.justPressed(Pads.CROSS)) {
        if (menuSelection === 0) startExistingScenario();
        else gameState = GAME_STATE_CREDITS;
    }

    if (gameState === GAME_STATE_GAME) return;
    if (menuPulse > 0) menuPulse--;
    updateMenuAudio();
}

function updateCreditsInput() {
    pad.update();
    if (pad.justPressed(Pads.CROSS) || pad.justPressed(Pads.CIRCLE) || pad.justPressed(Pads.START)) {
        gameState = GAME_STATE_MENU;
    }
    updateMenuAudio();
}

function updatePlayerAndCamera() {
    pad.update();

    if (pad.justPressed(Pads.SELECT)) {
        playerX = SPAWN.x;
        playerZ = SPAWN.z;
        playerY = SPAWN.y === undefined ? PLAYER_GROUND_Y : SPAWN.y;
        playerVelocityY = 0.0;
        playerGrounded = true;
        playerYaw = 0.0;
        cameraYaw = EDITOR_CAMERA ? EDITOR_CAMERA.rotation.y : 0.0;
    }
    if (pad.justPressed(Pads.START)) showHud = !showHud;
    if (pad.justPressed(Pads.L1)) shoulderSide *= -1.0;
    if (pad.justPressed(Pads.R3)) cameraYaw = playerYaw;
    if (pad.justPressed(Pads.SQUARE) && playerGrounded) {
        playerVelocityY = JUMP_SPEED;
        playerGrounded = false;
    }

    const lookX = readAxis(pad.rx);
    const lookY = readAxis(pad.ry);
    cameraYaw += lookX * 0.032;
    cameraPitch = clamp(cameraPitch + lookY * 0.015, 0.05, 0.62);

    let strafe = readAxis(pad.lx);
    let forwardInput = -readAxis(pad.ly);

    // Digital fallback is important for PCSX2 profiles that map keyboard keys
    // only to the D-pad instead of the emulated analog stick.
    const digitalHorizontal = (buttonHeld(Pads.RIGHT) ? 1.0 : 0.0) - (buttonHeld(Pads.LEFT) ? 1.0 : 0.0);
    const digitalVertical = (buttonHeld(Pads.UP) ? 1.0 : 0.0) - (buttonHeld(Pads.DOWN) ? 1.0 : 0.0);
    if (digitalHorizontal !== 0.0 || digitalVertical !== 0.0) {
        strafe = digitalHorizontal;
        forwardInput = digitalVertical;
    }

    const inputLength = Math.sqrt(strafe * strafe + forwardInput * forwardInput);
    if (inputLength > 1.0) {
        strafe /= inputLength;
        forwardInput /= inputLength;
    }

    const forwardX = Math.sin(cameraYaw);
    const forwardZ = -Math.cos(cameraYaw);
    const rightX = Math.cos(cameraYaw);
    const rightZ = Math.sin(cameraYaw);
    const speed = buttonHeld(Pads.CROSS) ? RUN_SPEED : WALK_SPEED;
    // Movement is camera-relative: left stick/D-pad always follows the view.
    const dx = (rightX * strafe + forwardX * forwardInput) * speed;
    const dz = (rightZ * strafe + forwardZ * forwardInput) * speed;
    let movedThisFrame = false;

    if (Math.abs(dx) + Math.abs(dz) > 0.001) {
        movedThisFrame = applyMovement(dx, dz);
        if (movedThisFrame) playerYaw = Math.atan2(dx, -dz);
    }

    updateVerticalMovement();
    updateActiveTriggers();
    processRuntimeEvents();
    if (runtimeVisualScripts) runtimeVisualScripts.step();
    updateRuntimeAudio();

    playerObject.position = { x: playerX, y: playerY, z: playerZ };
    playerObject.rotation = { x: 0.0, y: playerYaw, z: 0.0 };

    const editorCameraMode = EDITOR_CAMERA ? (EDITOR_CAMERA.mode || "follow") : "follow";
    if (EDITOR_CAMERA && (editorCameraMode === "fixed" || editorCameraMode === "lookAtPlayer")) {
        Camera.position(EDITOR_CAMERA.position.x, EDITOR_CAMERA.position.y, EDITOR_CAMERA.position.z);
        if (editorCameraMode === "lookAtPlayer") {
            Camera.target(playerX, playerY + PLAYER_HEIGHT * 0.55, playerZ);
        } else {
            const fixedTarget = EDITOR_CAMERA.target || { x: playerX, y: playerY + 1.0, z: playerZ };
            Camera.target(fixedTarget.x, fixedTarget.y, fixedTarget.z);
        }
        Camera.update();
        return;
    }

    const shoulder = 1.65 * shoulderSide;
    const distance = 6.5;
    const targetX = playerX + forwardX * 1.65 + rightX * shoulder * 0.18;
    const targetY = playerY + 1.27 + cameraPitch * 1.4;
    const targetZ = playerZ + forwardZ * 1.65 + rightZ * shoulder * 0.18;
    const desiredX = playerX - forwardX * distance + rightX * shoulder;
    const desiredY = playerY + 2.72 + cameraPitch * 5.0;
    const desiredZ = playerZ - forwardZ * distance + rightZ * shoulder;

    let cameraFactor = cachedCameraFactor;
    const cameraWasRotated = Math.abs(lookX) + Math.abs(lookY) > 0.001;
    const shouldProbeCamera = cameraWasRotated || cameraCollisionCooldown <= 0;
    if (shouldProbeCamera) {
        cameraFactor = 1.0;
        for (let step = 2; step <= 10; step++) {
            const factor = step / 10.0;
            const sampleX = targetX + (desiredX - targetX) * factor;
            const sampleY = targetY + (desiredY - targetY) * factor;
            const sampleZ = targetZ + (desiredZ - targetZ) * factor;
            if (cameraBlocked(sampleX, sampleY, sampleZ)) {
                cameraFactor = Math.max(0.2, factor - 0.12);
                break;
            }
        }
        cachedCameraFactor = cameraFactor;
        cameraCollisionCooldown = movedThisFrame ? 1 : 3;
    } else {
        cameraCollisionCooldown--;
    }

    Camera.position(
        targetX + (desiredX - targetX) * cameraFactor,
        targetY + (desiredY - targetY) * cameraFactor,
        targetZ + (desiredZ - targetZ) * cameraFactor
    );
    Camera.target(targetX, targetY, targetZ);
    Camera.update();
}

const snow = [];
for (let i = 0; i < 30; i++) {
    snow.push({
        x: (i * 97 + 31) % canvas.width,
        y: (i * 53 + 17) % canvas.height,
        speed: 0.18 + (i % 5) * 0.07
    });
}

function drawAtmosphere() {
    // Screen-space haze softens distant silhouettes and hides the hard horizon.
    Draw.rect(0, 0, canvas.width, canvas.height, Color.new(18, 38, 58, 9));
    Draw.rect(0, 52, canvas.width, 82, Color.new(24, 49, 70, 13));
    Draw.rect(0, 134, canvas.width, 62, Color.new(29, 57, 78, 10));
    Draw.rect(0, 196, canvas.width, 44, Color.new(32, 61, 82, 6));

    for (let i = 0; i < snow.length; i++) {
        const flake = snow[i];
        flake.y += flake.speed;
        flake.x += 0.08 + (i % 3) * 0.03;
        if (flake.y > canvas.height) flake.y = 0.0;
        if (flake.x > canvas.width) flake.x = 0.0;
        Draw.point(flake.x, flake.y, Color.new(110, 177, 220, 42 + (i % 3) * 18));
    }
}

function estimateTextWidth(text, scale) {
    return text.length * 14.0 * scale;
}

function printCentered(y, text, scale, color) {
    font.scale = scale;
    font.color = color;
    font.print((canvas.width - estimateTextWidth(text, scale)) * 0.5, y, text);
}

function drawMenuBackground() {
    Screen.setParam(Screen.DEPTH_TEST_ENABLE, false);

    if (menuBackground) {
        menuBackground.draw(0, 0);
    } else {
        Draw.rect(0, 0, canvas.width, canvas.height, CLEAR_COLOR);
    }

    Draw.rect(0, 0, canvas.width, canvas.height, Color.new(2, 7, 13, 48));
    Draw.rect(0, 0, canvas.width, 86, Color.new(1, 5, 11, 66));
    Draw.rect(0, canvas.height - 126, canvas.width, 126, Color.new(1, 5, 10, 72));
    drawAtmosphere();

    for (let y = 0; y < canvas.height; y += 4) {
        Draw.rect(0, y, canvas.width, 1, Color.new(0, 0, 0, 13));
    }
}

function drawMainMenu() {
    menuFrame++;
    drawMenuBackground();

    printCentered(46, "Heavenfall", 1.16, Color.new(221, 239, 248, 128));
    Draw.rect(canvas.width * 0.5 - 96, 88, 192, 1, Color.new(103, 188, 224, 86));
    Draw.rect(canvas.width * 0.5 - 58, 94, 116, 1, Color.new(184, 222, 240, 55));

    const baseY = Math.floor(canvas.height * 0.55);
    const itemSpacing = 42;
    const boxWidth = 286;
    const boxX = (canvas.width - boxWidth) * 0.5;
    for (let i = 0; i < MENU_OPTIONS.length; i++) {
        const selected = i === menuSelection;
        const y = baseY + i * itemSpacing;
        const scale = selected ? 0.66 : 0.58;
        const text = MENU_OPTIONS[i];
        const textX = (canvas.width - estimateTextWidth(text, scale)) * 0.5;

        if (selected) {
            const pulse = 74 + Math.floor((Math.sin(menuFrame * 0.15) + 1.0) * 18.0);
            Draw.rect(boxX, y - 8, boxWidth, 34, Color.new(6, 24, 38, pulse));
            Draw.rect(boxX, y - 9, boxWidth, 1, Color.new(108, 200, 240, 88));
            Draw.rect(boxX, y + 27, boxWidth, 1, Color.new(23, 85, 116, 76));
            Draw.rect(boxX + 18, y + 2, 4, 16, Color.new(159, 225, 250, 116));
            Draw.rect(boxX + 22, y + 5, 4, 10, Color.new(159, 225, 250, 106));
            Draw.rect(boxX + 26, y + 8, 4, 4, Color.new(159, 225, 250, 96));
            font.color = Color.new(232, 244, 250, 128);
        } else {
            font.color = Color.new(151, 184, 202, 104);
        }

        font.scale = scale;
        font.print(textX, y, text);
    }

    if (menuPulse > 0) {
        Draw.rect(boxX - 4, baseY + menuSelection * itemSpacing - 12, boxWidth + 8, 42, Color.new(154, 219, 246, menuPulse * 4));
    }

    Screen.setParam(Screen.DEPTH_TEST_ENABLE, true);
    Screen.setParam(Screen.DEPTH_TEST_METHOD, Screen.DEPTH_GEQUAL);
}

function drawCreditsScreen() {
    menuFrame++;
    drawMenuBackground();

    Draw.rect(84, 108, canvas.width - 168, 206, Color.new(2, 8, 15, 82));
    Draw.rect(104, 131, canvas.width - 208, 1, Color.new(103, 188, 224, 62));
    Draw.rect(132, 292, canvas.width - 264, 1, Color.new(103, 188, 224, 44));

    printCentered(118, "CRÉDITOS", 0.82, Color.new(232, 244, 250, 128));
    printCentered(178, "Desenvolvido por", 0.50, Color.new(187, 214, 228, 118));
    printCentered(209, "Brendow Vaz", 0.64, Color.new(229, 240, 247, 128));
    printCentered(266, "Obrigado por jogar", 0.52, Color.new(167, 204, 224, 118));

    Screen.setParam(Screen.DEPTH_TEST_ENABLE, true);
    Screen.setParam(Screen.DEPTH_TEST_METHOD, Screen.DEPTH_GEQUAL);
}

function editorUiColor(definition, fallbackAlpha) {
    const value = definition || { r: 255, g: 255, b: 255, a: fallbackAlpha };
    return Color.new(
        value.r === undefined ? 255 : value.r,
        value.g === undefined ? 255 : value.g,
        value.b === undefined ? 255 : value.b,
        value.a === undefined ? fallbackAlpha : value.a
    );
}

function editorUiColorWithOpacity(definition, fallbackAlpha, opacity) {
    const value = definition || { r: 255, g: 255, b: 255, a: fallbackAlpha };
    const alpha = value.a === undefined ? fallbackAlpha : value.a;
    return Color.new(
        value.r === undefined ? 255 : value.r,
        value.g === undefined ? 255 : value.g,
        value.b === undefined ? 255 : value.b,
        Math.round(clamp(alpha * (opacity === undefined ? 1.0 : opacity), 0, 128))
    );
}

const runtimeUiFonts = {};
const runtimeUiMedia = {};
for (let uiResourceIndex = 0; uiResourceIndex < EDITOR_UI.length; uiResourceIndex++) {
    const resourceDefinition = EDITOR_UI[uiResourceIndex];
    if (resourceDefinition.type === "text" && resourceDefinition.fontAsset
        && runtimeUiFonts[resourceDefinition.fontAsset] === undefined) {
        try {
            runtimeUiFonts[resourceDefinition.fontAsset] = new Font(resourceDefinition.fontAsset);
        } catch (uiFontError) {
            console.log("[VeuAzul] Fonte de UI nao carregada: " + resourceDefinition.fontAsset + " - " + uiFontError);
            runtimeUiFonts[resourceDefinition.fontAsset] = null;
        }
    }
    if (resourceDefinition.type === "image" && resourceDefinition.asset) {
        try {
            const uiImage = new Image(resourceDefinition.asset);
            uiImage.lock();
            runtimeUiMedia[resourceDefinition.id] = { type: "image", media: uiImage };
        } catch (uiImageError) {
            console.log("[VeuAzul] Imagem de UI nao carregada: " + resourceDefinition.asset + " - " + uiImageError);
        }
    }
    if (resourceDefinition.type === "video" && resourceDefinition.asset && typeof Video !== "undefined") {
        try {
            const uiVideo = new Video(resourceDefinition.asset);
            uiVideo.loop = resourceDefinition.loop === true;
            runtimeUiMedia[resourceDefinition.id] = {
                type: "video",
                media: uiVideo,
                requested: resourceDefinition.autoplay === true,
                started: false,
                frame: null
            };
        } catch (uiVideoError) {
            console.log("[VeuAzul] Video de UI nao carregado: " + resourceDefinition.asset + " - " + uiVideoError);
        }
    }
}

function controlRuntimeVideo(id, mode) {
    const entry = runtimeUiMedia[id];
    if (!entry || entry.type !== "video") return;
    if (mode === "stop") {
        entry.requested = false;
        entry.started = false;
        entry.media.stop();
        return;
    }
    if (mode === "pause") {
        entry.requested = false;
        entry.media.pause();
        return;
    }
    if (entry.media.ended) entry.media.stop();
    entry.requested = true;
    entry.started = false;
}

function drawEditorInterface() {
    if (!EDITOR_UI || EDITOR_UI.length === 0) return;
    const scaleX = canvas.width / 640.0;
    const scaleY = canvas.height / 448.0;
    const fontScaleFactor = Math.min(scaleX, scaleY);
    for (let i = 0; i < EDITOR_UI.length; i++) {
        const item = EDITOR_UI[i];
        const x = item.x * scaleX;
        const y = item.y * scaleY;
        const width = item.width * scaleX;
        const height = item.height * scaleY;
        if (item.type === "panel") {
            Draw.rect(x, y, width, height, editorUiColor(item.background, 104));
            continue;
        }
        if (item.type === "image") {
            const imageEntry = runtimeUiMedia[item.id];
            if (!imageEntry) continue;
            imageEntry.media.width = width;
            imageEntry.media.height = height;
            imageEntry.media.color = editorUiColorWithOpacity(item.color, 128, item.opacity);
            imageEntry.media.draw(x, y);
            continue;
        }
        if (item.type === "video") {
            const videoEntry = runtimeUiMedia[item.id];
            if (!videoEntry) continue;
            const video = videoEntry.media;
            video.loop = item.loop === true;
            video.update();
            if (videoEntry.requested && video.ready && !videoEntry.started) {
                video.play();
                videoEntry.started = true;
            }
            if (video.ended && item.loop !== true) videoEntry.requested = false;
            if (!videoEntry.frame && video.ready && item.opacity < 0.999) videoEntry.frame = video.frame;
            const frame = videoEntry.frame;
            if (frame) {
                frame.width = width;
                frame.height = height;
                frame.color = editorUiColorWithOpacity(item.color, 128, item.opacity);
                frame.draw(x, y);
            } else {
                video.draw(x, y, width, height);
            }
            continue;
        }
        if (item.type !== "text") continue;
        const text = item.text || "";
        const lines = text.split("\n");
        const textScale = Math.max(0.15, item.fontScale || 0.55) * fontScaleFactor;
        const itemFont = runtimeUiFonts[item.fontAsset] || font;
        itemFont.scale = textScale;
        itemFont.color = editorUiColorWithOpacity(item.color, 128, item.opacity);
        itemFont.outline = item.dropshadow > 0 ? 0.0 : Math.max(0.0, item.outline || 0.0);
        itemFont.outline_color = editorUiColorWithOpacity(item.outlineColor, 128, item.opacity);
        itemFont.dropshadow = itemFont.outline > 0 ? 0.0 : Math.max(0.0, item.dropshadow || 0.0);
        itemFont.dropshadow_color = editorUiColorWithOpacity(item.dropshadowColor, 128, item.opacity);
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            const measured = typeof itemFont.getTextSize === "function" ? itemFont.getTextSize(line) : null;
            const measuredWidth = measured && measured.width !== undefined ? measured.width : line.length * 14.0 * textScale;
            let lineX = x;
            if (item.align === "center") lineX = x + Math.max(0.0, (width - measuredWidth) * 0.5);
            else if (item.align === "right") lineX = x + Math.max(0.0, width - measuredWidth);
            itemFont.print(lineX, y + lineIndex * 20.0 * textScale, line);
        }
    }
    font.outline = 1.0;
    font.outline_color = Color.new(3, 8, 16, 128);
    font.dropshadow = 0.0;
}

function drawHud() {
    Screen.setParam(Screen.DEPTH_TEST_ENABLE, false);
    drawAtmosphere();

    if (titleTimer > 0) {
        const titleAlpha = clamp(titleTimer, 0, 128);
        font.color = Color.new(118, 210, 246, titleAlpha);
        font.scale = 0.70;
        font.print(18, 18, "RUINAS DO VEU AZUL");
        font.scale = 0.42;
        font.color = Color.new(191, 218, 232, titleAlpha);
        font.print(20, 39, "CAMARA DOS VIGIAS CONGELADOS");
        titleTimer--;
    }

    if (showHud) {
        font.scale = 0.40;
        font.color = HUD_WHITE;
        font.print(14, canvas.height - 67, "BUILD 14 - SUPORTE E QUEDA");
        font.print(14, canvas.height - 51, "POS: " + playerX.toFixed(2) + " / " + playerY.toFixed(2) + " / " + playerZ.toFixed(2) + "  TRG: " + activeTriggerIds.length);
        font.print(14, canvas.height - 35, "MOVER: D-PAD/ANALOGICO  |  QUADRADO: PULAR  |  X: CORRER");
        font.color = HUD_BLUE;
        font.print(14, canvas.height - 19, "TRIANGULO: INTERAGIR  |  R3: CENTRALIZAR  |  SELECT: REINICIAR");
    }

    if (runtimeMessageTimer > 0 && runtimeMessageText) {
        const firstLine = runtimeMessageText.substring(0, 58);
        const secondLine = runtimeMessageText.length > 58 ? runtimeMessageText.substring(58, 116) : "";
        const boxHeight = secondLine ? 48 : 34;
        Draw.rect(28, canvas.height - 132, canvas.width - 56, boxHeight, Color.new(4, 11, 18, 104));
        font.scale = 0.46;
        font.color = Color.new(225, 238, 245, 128);
        font.print(42, canvas.height - 120, firstLine);
        if (secondLine) font.print(42, canvas.height - 103, secondLine);
        runtimeMessageTimer--;
    }

    if (collisionFlash > 0) {
        font.scale = 0.42;
        font.color = Color.new(118, 204, 240, 128);
        font.print(canvas.width - 156, 16, "LIMITE DA AREA");
        collisionFlash--;
    }

    drawEditorInterface();

    if (EDITOR_SETTINGS.showPerformance) {
        const stats = typeof Render.stats === "function" ? Render.stats() : { drawCalls: 0, triangles: 0 };
        const fps = typeof Screen.getFPS === "function" ? Screen.getFPS() : 0;
        const vram = typeof Screen.getMemoryStats === "function"
            ? Screen.getMemoryStats(Screen.VRAM_USED_TOTAL)
            : 0;
        font.scale = 0.36;
        font.color = Color.new(190, 225, 241, 128);
        font.print(canvas.width - 186, 16, "FPS: " + fps.toFixed(1));
        font.print(canvas.width - 186, 30, "DRAWS: " + stats.drawCalls + "  TRI: " + stats.triangles);
        font.print(canvas.width - 186, 44, "VRAM: " + (vram / 1048576.0).toFixed(2) + " MB");
    }

    Screen.setParam(Screen.DEPTH_TEST_ENABLE, true);
    Screen.setParam(Screen.DEPTH_TEST_METHOD, Screen.DEPTH_GEQUAL);
}

function renderGameFrame() {
    Screen.clear(CLEAR_COLOR);
    if (typeof Render.resetStats === "function") Render.resetStats();
    Render.begin();
    pointLightTime += 1.0 / 60.0;
    for (let i = 0; i < sceneObjects.length; i++) {
        const definition = EDITOR_SCENE[i];
        const center = definition.boundsCenter || definition.position;
        applyPointLightsAt(center.x, center.y, center.z);
        if (runtimeObjectVisibility[definition.id] !== false) sceneObjects[i].render();
    }
    renderRuntimeShadows();
    updateAndRenderParticles();
    applyPointLightsAt(playerX, playerY + PLAYER_HEIGHT * 0.5, playerZ);
    playerObject.render();
    disablePointLights();
    drawHud();
    Screen.flip();
}

while (true) {
    if (gameState === GAME_STATE_MENU) {
        updateMenuInput();
        if (gameState === GAME_STATE_MENU) {
            Screen.clear(CLEAR_COLOR);
            drawMainMenu();
            Screen.flip();
            continue;
        }
        if (gameState === GAME_STATE_CREDITS) {
            Screen.clear(CLEAR_COLOR);
            drawCreditsScreen();
            Screen.flip();
            continue;
        }
    }

    if (gameState === GAME_STATE_CREDITS) {
        updateCreditsInput();
        Screen.clear(CLEAR_COLOR);
        if (gameState === GAME_STATE_MENU) drawMainMenu();
        else drawCreditsScreen();
        Screen.flip();
        continue;
    }

    stopMenuAudio();
    startRuntimeAutoplayAudio();
    updatePlayerAndCamera();
    renderGameFrame();
}
