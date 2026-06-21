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

function configureData(data) {
    data.pipeline = Render.PL_DEFAULT;
    data.texture_mapping = true;
    data.face_culling = Render.CULL_FACE_NONE;
    data.shade_model = Render.SHADE_GOURAUD;
    return data;
}

// The visual editor writes this file whenever the scene is saved. Keeping the
// transform data in a tiny generated script avoids JSON parsing and path
// differences between PCSX2 HostFS and real hardware.
globalThis.EDITOR_SCENE = [];
if (std.exists("scene.generated.js")) {
    std.loadScript("scene.generated.js");
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
for (let i = 0; i < EDITOR_SCENE.length; i++) {
    const definition = EDITOR_SCENE[i];
    console.log("[VeuAzul] Carregando objeto " + definition.name + " (" + definition.asset + ")");
    const sceneData = configureData(new RenderData(definition.asset));
    const sceneObject = new RenderObject(sceneData);
    sceneObject.position = definition.position;
    sceneObject.rotation = definition.rotation;
    sceneObject.scale = definition.scale;
    sceneObjects.push(sceneObject);
}

const playerData = configureData(new RenderData("player.obj"));
const playerObject = new RenderObject(playerData);
console.log("[VeuAzul] " + sceneObjects.length + " objetos, jogador e colisoes prontos");

const iceLight = Lights.new();
Lights.set(iceLight, Lights.DIRECTION, -0.35, 0.85, 0.45);
Lights.set(iceLight, Lights.AMBIENT, 0.15, 0.22, 0.32);
Lights.set(iceLight, Lights.DIFFUSE, 0.78, 0.90, 1.0);

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

const collisionCircles = [
    { x: -2.8, z: -1.5, radius: 1.52 },
    { x: 3.5, z: -5.0, radius: 1.32 },
    { x: 1.0, z: 5.0, radius: 1.0 },
    { x: -8.2, z: 5.2, radius: 0.92 },
    { x: 8.0, z: -0.3, radius: 0.86 },
    { x: -4.55, z: 17.4, radius: 1.1 },
    { x: 4.55, z: 15.0, radius: 1.1 }
];

const cameraBlockers = collisionCircles.concat([
    { x: -12.5, z: -10.0, radius: 1.5 }, { x: 12.2, z: -9.0, radius: 1.5 },
    { x: -13.8, z: 2.5, radius: 1.4 }, { x: 13.7, z: 3.6, radius: 1.5 },
    { x: -9.0, z: 11.2, radius: 1.4 }, { x: 9.5, z: 10.0, radius: 1.4 }
]);

const PLAYER_RADIUS = 0.68;
const SPAWN = { x: 0.0, z: 18.0 };
let playerX = SPAWN.x;
let playerZ = SPAWN.z;
let playerYaw = 0.0;
let cameraYaw = 0.0;
let cameraPitch = 0.31;
let shoulderSide = 1.0;
let showHud = true;
let titleTimer = 330;
let collisionFlash = 0;

function isPlayerValid(x, z) {
    if (!baseWalkable(x, z)) return false;
    for (let i = 0; i < collisionCircles.length; i++) {
        const obstacle = collisionCircles[i];
        const dx = x - obstacle.x;
        const dz = z - obstacle.z;
        const minimum = PLAYER_RADIUS + obstacle.radius;
        if (dx * dx + dz * dz < minimum * minimum) return false;
    }
    return true;
}

function walkableHalfWidth(z) {
    if (z >= 6.0) return 5.25;
    if (z <= -10.0) return 4.85;
    const normalized = (z + 3.0) / 14.2;
    const ellipse = Math.sqrt(Math.max(0.0, 1.0 - normalized * normalized)) * 15.1;
    return Math.max(5.0, ellipse - PLAYER_RADIUS);
}

function clearOfObstacles(x, z) {
    for (let i = 0; i < collisionCircles.length; i++) {
        const obstacle = collisionCircles[i];
        const ox = x - obstacle.x;
        const oz = z - obstacle.z;
        const minimum = PLAYER_RADIUS + obstacle.radius;
        if (ox * ox + oz * oz < minimum * minimum) return false;
    }
    return true;
}

function applyMovement(dx, dz) {
    const oldX = playerX;
    const oldZ = playerZ;
    const nextZ = clamp(playerZ + dz, -27.4, 24.4);
    const halfWidth = walkableHalfWidth(nextZ);
    const nextX = clamp(playerX + dx, -halfWidth, halfWidth);

    // Apply both axes directly. Static obstacle collision is intentionally kept
    // out of this pass so only the actual platform boundary can stop movement.
    playerX = nextX;
    playerZ = nextZ;

    const moved = Math.abs(playerX - oldX) + Math.abs(playerZ - oldZ) > 0.0001;
    collisionFlash = moved ? 0 : 5;
    return moved;
}

function cameraBlocked(x, z) {
    for (let i = 0; i < cameraBlockers.length; i++) {
        const blocker = cameraBlockers[i];
        const dx = x - blocker.x;
        const dz = z - blocker.z;
        const limit = blocker.radius + 0.35;
        if (dx * dx + dz * dz < limit * limit) return true;
    }
    return false;
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
        playerYaw = 0.0;
        cameraYaw = 0.0;
    }
    if (pad.justPressed(Pads.START)) showHud = !showHud;
    if (pad.justPressed(Pads.L1)) shoulderSide *= -1.0;
    if (pad.justPressed(Pads.R3)) cameraYaw = playerYaw;

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

    playerObject.position = { x: playerX, y: 0.08, z: playerZ };
    playerObject.rotation = { x: 0.0, y: playerYaw, z: 0.0 };

    const shoulder = 1.65 * shoulderSide;
    const distance = 6.5;
    const targetX = playerX + forwardX * 1.65 + rightX * shoulder * 0.18;
    const targetY = 1.35 + cameraPitch * 1.4;
    const targetZ = playerZ + forwardZ * 1.65 + rightZ * shoulder * 0.18;
    const desiredX = playerX - forwardX * distance + rightX * shoulder;
    const desiredY = 2.8 + cameraPitch * 5.0;
    const desiredZ = playerZ - forwardZ * distance + rightZ * shoulder;

    let cameraFactor = 1.0;
    for (let step = 2; step <= 10; step++) {
        const factor = step / 10.0;
        const sampleX = targetX + (desiredX - targetX) * factor;
        const sampleZ = targetZ + (desiredZ - targetZ) * factor;
        if (cameraBlocked(sampleX, sampleZ)) {
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
        font.print(14, canvas.height - 67, "BUILD 11 - TEXTURAS ICE RUINS");
        font.print(14, canvas.height - 51, "POS: " + playerX.toFixed(2) + " / " + playerZ.toFixed(2) + "  PAD: " + pad.lx + "," + pad.ly);
        font.print(14, canvas.height - 35, "D-PAD/ANALOGICO E: MOVER  |  X: CORRER  |  ANALOGICO D: CAMERA");
        font.color = HUD_BLUE;
        font.print(14, canvas.height - 19, "L1: TROCAR OMBRO  |  R3: CENTRALIZAR  |  SELECT: REINICIAR");
    }

    if (collisionFlash > 0) {
        font.scale = 0.42;
        font.color = Color.new(118, 204, 240, 128);
        font.print(canvas.width - 156, 16, "LIMITE DA AREA");
        collisionFlash--;
    }

    Screen.setParam(Screen.DEPTH_TEST_ENABLE, true);
    Screen.setParam(Screen.DEPTH_TEST_METHOD, Screen.DEPTH_GEQUAL);
}

while (true) {
    updatePlayerAndCamera();
    Screen.clear(CLEAR_COLOR);
    Render.begin();
    for (let i = 0; i < sceneObjects.length; i++) sceneObjects[i].render();
    playerObject.render();
    drawHud();
    Screen.flip();
}
