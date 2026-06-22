// {"name":"Ruinas do Veu Azul","author":"Codex + Brendan","version":"20062026","file":"main.js"}

// AthenaEnv/PS2 runtime. Static geometry is stored as OBJ chunks to avoid the
// Render.vertexList incompatibility present in some AthenaEnv builds.

const canvas = Screen.getMode();
canvas.zbuffering = true;
canvas.double_buffering = true;
canvas.psm = Screen.CT32;
canvas.psmz = Screen.Z16S;
Screen.setMode(canvas);
Screen.setVSync(true);
Screen.setFrameCounter(true);

const CLEAR_COLOR = Color.new(7, 15, 28, 128);
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

function configureData(data, material) {
    data.pipeline = material && material.unlit ? Render.PL_NO_LIGHTS : Render.PL_DEFAULT;
    data.texture_mapping = true;
    data.face_culling = Render.CULL_FACE_NONE;
    data.shade_model = Render.SHADE_GOURAUD;
    return data;
}

// The visual editor writes this file whenever the scene is saved. Keeping the
// transform data in a tiny generated script avoids JSON parsing and path
// differences between PCSX2 HostFS and real hardware.
globalThis.EDITOR_SCENE = [];
globalThis.EDITOR_COLLIDERS = [];
globalThis.EDITOR_EVENTS = [];
globalThis.EDITOR_LIGHTS = [];
globalThis.EDITOR_POINT_LIGHTS = [];
globalThis.EDITOR_CAMERA = null;
globalThis.EDITOR_UI = [];
if (std.exists("scene.generated.js")) {
    std.loadScript("scene.generated.js");
}

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
    const sceneData = configureData(new RenderData(definition.asset), definition.material);
    const sceneObject = new RenderObject(sceneData);
    sceneObject.position = definition.position;
    sceneObject.rotation = definition.rotation;
    sceneObject.scale = definition.scale;
    sceneObjects.push(sceneObject);
    runtimeObjectVisibility[definition.id] = true;
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
    const arena = (x * x) / (15.1 * 15.1) + ((z + 3.0) * (z + 3.0)) / (14.2 * 14.2) <= 1.0;
    const northHall = z >= -28.2 && z <= -10.0 && Math.abs(x) <= 5.3 + (z + 28.2) * 0.12;
    const southHall = z >= 6.0 && z <= 25.2 && Math.abs(x) <= 5.7 - Math.max(0.0, z - 18.0) * 0.10;
    return arena || northHall || southHall;
}

const collisionShapes = Collision3D.normalizeAll(EDITOR_COLLIDERS);
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

const PLAYER_RADIUS = 0.68;
const PLAYER_HEIGHT = 2.25;
const PLAYER_GROUND_Y = 0.08;
const JUMP_SPEED = 0.30;
const GRAVITY = 0.014;
const SUPPORT_PROBE = 0.08;
const LANDING_SEARCH_STEPS = 7;
const SPAWN = { x: 0.0, z: 18.0 };
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

function updateActiveTriggers() {
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
    if (z >= 6.0) return 5.25;
    if (z <= -10.0) return 4.85;
    const normalized = (z + 3.0) / 14.2;
    const ellipse = Math.sqrt(Math.max(0.0, 1.0 - normalized * normalized)) * 15.1;
    return Math.max(5.0, ellipse - PLAYER_RADIUS);
}

function movementAllowed(currentContacts, x, z) {
    if (!baseWalkable(x, z)) return false;
    const nextContacts = playerContactsAt(x, playerY, z);
    return Collision3D.transitionAllowed(currentContacts, nextContacts);
}

function applyMovement(dx, dz) {
    const oldX = playerX;
    const oldZ = playerZ;
    const nextZ = clamp(playerZ + dz, -27.4, 24.4);
    const halfWidth = walkableHalfWidth(nextZ);
    const nextX = clamp(playerX + dx, -halfWidth, halfWidth);
    let currentContacts = playerContactsAt(playerX, playerY, playerZ);

    if (movementAllowed(currentContacts, nextX, nextZ)) {
        playerX = nextX;
        playerZ = nextZ;
    } else {
        if (movementAllowed(currentContacts, nextX, playerZ)) {
            playerX = nextX;
            currentContacts = playerContactsAt(playerX, playerY, playerZ);
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

const pad = Pads.get(0);
pad.update();

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

function updatePlayerAndCamera() {
    pad.update();

    if (pad.justPressed(Pads.SELECT)) {
        playerX = SPAWN.x;
        playerZ = SPAWN.z;
        playerY = PLAYER_GROUND_Y;
        playerVelocityY = 0.0;
        playerGrounded = true;
        playerYaw = 0.0;
        cameraYaw = 0.0;
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
    const speed = pad.pressed(Pads.CROSS) ? 0.19 : 0.125;
    // Movement axes stay independent. The right stick rotates only the camera.
    const dx = strafe * speed;
    const dz = -forwardInput * speed;

    if (Math.abs(dx) + Math.abs(dz) > 0.001) {
        if (applyMovement(dx, dz)) playerYaw = Math.atan2(dx, -dz);
    }

    updateVerticalMovement();
    updateActiveTriggers();
    processRuntimeEvents();

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

    let cameraFactor = 1.0;
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

function editorUiColor(definition, fallbackAlpha) {
    const value = definition || { r: 255, g: 255, b: 255, a: fallbackAlpha };
    return Color.new(
        value.r === undefined ? 255 : value.r,
        value.g === undefined ? 255 : value.g,
        value.b === undefined ? 255 : value.b,
        value.a === undefined ? fallbackAlpha : value.a
    );
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
        if (item.type !== "text") continue;
        const text = item.text || "";
        const lines = text.split("\n");
        const textScale = Math.max(0.15, item.fontScale || 0.55) * fontScaleFactor;
        font.scale = textScale;
        font.color = editorUiColor(item.color, 128);
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            const estimatedWidth = line.length * 14.0 * textScale;
            let lineX = x;
            if (item.align === "center") lineX = x + Math.max(0.0, (width - estimatedWidth) * 0.5);
            else if (item.align === "right") lineX = x + Math.max(0.0, width - estimatedWidth);
            font.print(lineX, y + lineIndex * 20.0 * textScale, line);
        }
    }
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

    Screen.setParam(Screen.DEPTH_TEST_ENABLE, true);
    Screen.setParam(Screen.DEPTH_TEST_METHOD, Screen.DEPTH_GEQUAL);
}

while (true) {
    updatePlayerAndCamera();
    Screen.clear(CLEAR_COLOR);
    Render.begin();
    pointLightTime += 1.0 / 60.0;
    for (let i = 0; i < sceneObjects.length; i++) {
        const definition = EDITOR_SCENE[i];
        const center = definition.boundsCenter || definition.position;
        applyPointLightsAt(center.x, center.y, center.z);
        if (runtimeObjectVisibility[definition.id] !== false) sceneObjects[i].render();
    }
    applyPointLightsAt(playerX, playerY + PLAYER_HEIGHT * 0.5, playerZ);
    playerObject.render();
    disablePointLights();
    drawHud();
    Screen.flip();
}
