// {"name":"Ruinas do Veu Azul","author":"Codex + Brendan","version":"20062026","file":"main.js"}

// AthenaEnv/PS2 runtime. Static geometry is stored as OBJ chunks to avoid the
// Render.vertexList incompatibility present in some AthenaEnv builds.

const MAX_RUNTIME_LIGHTS = 4;
const RUNTIME_SAVE_VERSION = 1;
const RUNTIME_SAVE_DIRECTORY = "mc0:/HEAVENFALL";
const RUNTIME_SAVE_PATH = RUNTIME_SAVE_DIRECTORY + "/save.json";
const RUNTIME_SAVE_TEMP_PATH = RUNTIME_SAVE_DIRECTORY + "/save.tmp";
const RUNTIME_SAVE_BACKUP_PATH = RUNTIME_SAVE_DIRECTORY + "/save.bak";
const RUNTIME_SAVE_MAX_BYTES = 128 * 1024;
const runtimeEngineState = {
    canvas: null,
    font: null,
    fonts: {},
    audioStreams: {},
    pad: null,
    lightSlots: [],
    // Some Matrix4/Vector4 wrappers exposed by AthenaEnv point into their
    // owner's native allocation. Retain only these borrowed views so QuickJS
    // never finalizes them between scenes; model/texture wrappers stay free to
    // be collected after their native data is released.
    retiredNativeViews: [],
    retiredActiveSfx: [],
    persistentState: {
        variables: {},
        scenes: {}
    },
    saveData: null,
    saveAvailable: false,
    saveChecked: false,
    lastSaveError: "",
    sessionCheckpoint: null,
    playerGameplay: {
        initialized: false,
        enabled: false,
        currentHealth: 0,
        maximumHealth: 0,
        invulnerabilityFrames: 0
    }
};

function initializeRuntimeEngine() {
    const canvas = Screen.getMode();
    canvas.zbuffering = true;
    canvas.double_buffering = true;
    canvas.psm = Screen.CT32;
    canvas.psmz = Screen.Z16S;
    Screen.setMode(canvas);
    Screen.setFrameCounter(true);
    Render.init();

    runtimeEngineState.canvas = Screen.getMode();
    runtimeEngineState.font = new Font("default");
    runtimeEngineState.fonts.default = runtimeEngineState.font;
    runtimeEngineState.pad = Pads.get(0);
    for (let lightIndex = 0; lightIndex < MAX_RUNTIME_LIGHTS; lightIndex++) {
        runtimeEngineState.lightSlots.push(Lights.new());
    }
}

function persistentRuntimeFont(asset) {
    const key = asset || "default";
    if (runtimeEngineState.fonts[key] !== undefined) return runtimeEngineState.fonts[key];
    try {
        runtimeEngineState.fonts[key] = new Font(key);
    } catch (fontError) {
        console.log("[VeuAzul] Fonte persistente nao carregada: " + key + " - " + fontError);
        runtimeEngineState.fonts[key] = null;
    }
    return runtimeEngineState.fonts[key];
}

function persistentRuntimeStream(asset) {
    const key = asset || "";
    if (runtimeEngineState.audioStreams[key] !== undefined) return runtimeEngineState.audioStreams[key];
    const stream = Sound.Stream(key);
    runtimeEngineState.audioStreams[key] = stream;
    return stream;
}

function coercePersistentVariable(value, type, fallback) {
    if (type === "number") {
        const number = Number(value);
        return Number.isFinite(number) ? number : Number(fallback) || 0;
    }
    if (type === "string") return String(value === undefined || value === null ? fallback || "" : value);
    return Boolean(value);
}

function initializePersistentVariables(definitions) {
    const values = runtimeEngineState.persistentState.variables;
    for (let index = 0; index < definitions.length; index++) {
        const definition = definitions[index];
        if (!definition || !definition.id) continue;
        const stored = Object.prototype.hasOwnProperty.call(values, definition.id)
            ? values[definition.id]
            : definition.initialValue;
        values[definition.id] = coercePersistentVariable(stored, definition.type, definition.initialValue);
    }
}

function readPersistentVariable(id, fallback, type) {
    const values = runtimeEngineState.persistentState.variables;
    if (!Object.prototype.hasOwnProperty.call(values, id)) {
        values[id] = coercePersistentVariable(fallback, type, fallback);
    }
    return values[id];
}

function writePersistentVariable(id, value, type) {
    const values = runtimeEngineState.persistentState.variables;
    values[id] = coercePersistentVariable(value, type, value);
    return values[id];
}

function persistentRuntimeScene(sceneId) {
    const id = sceneId || "legacy";
    const scenes = runtimeEngineState.persistentState.scenes;
    if (!scenes[id]) scenes[id] = { objects: {}, components: {} };
    if (!scenes[id].objects) scenes[id].objects = {};
    if (!scenes[id].components) scenes[id].components = {};
    return scenes[id];
}

function safeRuntimeSaveId(value) {
    const text = typeof value === "string" ? value : "";
    if (!text || text.length > 96 || !/^[a-zA-Z0-9_-]+$/.test(text)) return "";
    if (text === "__proto__" || text === "prototype" || text === "constructor") return "";
    return text;
}

function runtimeSavePrimitive(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") return value.slice(0, 256);
    return undefined;
}

function normalizeRuntimeSaveData(input) {
    if (!input || Number(input.version) !== RUNTIME_SAVE_VERSION) return null;
    const sceneId = safeRuntimeSaveId(input.sceneId);
    const sourcePlayer = input.player || {};
    const player = {
        x: Number(sourcePlayer.x),
        y: Number(sourcePlayer.y),
        z: Number(sourcePlayer.z),
        yaw: Number(sourcePlayer.yaw),
        health: sourcePlayer.health === undefined ? undefined : Number(sourcePlayer.health)
    };
    if (!sceneId || !Number.isFinite(player.x) || !Number.isFinite(player.y)
        || !Number.isFinite(player.z) || !Number.isFinite(player.yaw)) return null;
    if (Math.abs(player.x) > 100000 || Math.abs(player.y) > 100000 || Math.abs(player.z) > 100000) return null;
    if (player.health !== undefined && (!Number.isFinite(player.health) || player.health < 0 || player.health > 999999)) return null;

    const variables = {};
    const sourceVariables = input.variables && typeof input.variables === "object" ? input.variables : {};
    const variableIds = Object.keys(sourceVariables).slice(0, 128);
    for (let index = 0; index < variableIds.length; index++) {
        const id = safeRuntimeSaveId(variableIds[index]);
        const value = runtimeSavePrimitive(sourceVariables[variableIds[index]]);
        if (id && value !== undefined) variables[id] = value;
    }

    const scenes = {};
    const sourceScenes = input.scenes && typeof input.scenes === "object" ? input.scenes : {};
    const sceneIds = Object.keys(sourceScenes).slice(0, 64);
    for (let sceneIndex = 0; sceneIndex < sceneIds.length; sceneIndex++) {
        const savedSceneId = safeRuntimeSaveId(sceneIds[sceneIndex]);
        if (!savedSceneId) continue;
        const sourceObjects = sourceScenes[sceneIds[sceneIndex]] && sourceScenes[sceneIds[sceneIndex]].objects;
        const sourceComponents = sourceScenes[sceneIds[sceneIndex]] && sourceScenes[sceneIds[sceneIndex]].components;
        const objects = {};
        const objectIds = sourceObjects && typeof sourceObjects === "object"
            ? Object.keys(sourceObjects).slice(0, 2048)
            : [];
        for (let objectIndex = 0; objectIndex < objectIds.length; objectIndex++) {
            const objectId = safeRuntimeSaveId(objectIds[objectIndex]);
            const visible = sourceObjects[objectIds[objectIndex]] && sourceObjects[objectIds[objectIndex]].visible;
            if (objectId && typeof visible === "boolean") objects[objectId] = { visible: visible };
        }
        const components = {};
        const componentIds = sourceComponents && typeof sourceComponents === "object"
            ? Object.keys(sourceComponents).slice(0, 2048)
            : [];
        for (let componentIndex = 0; componentIndex < componentIds.length; componentIndex++) {
            const componentId = safeRuntimeSaveId(componentIds[componentIndex]);
            const sourceState = sourceComponents[componentIds[componentIndex]];
            if (!componentId || !sourceState || typeof sourceState !== "object") continue;
            const state = {};
            if (typeof sourceState.consumed === "boolean") state.consumed = sourceState.consumed;
            if (Number.isFinite(Number(sourceState.health))) {
                state.health = Math.max(0, Math.min(999999, Number(sourceState.health)));
            }
            if (Object.keys(state).length) components[componentId] = state;
        }
        scenes[savedSceneId] = { objects: objects, components: components };
    }

    return {
        version: RUNTIME_SAVE_VERSION,
        sceneId: sceneId,
        player: player,
        variables: variables,
        scenes: scenes
    };
}

function runtimeSavePathExists(path) {
    try {
        return Boolean(std.exists(path));
    } catch (existsError) {
        console.log("[Heavenfall] Falha ao consultar " + path + ": " + existsError);
        return false;
    }
}

function readRuntimeSaveAtPath(path) {
    try {
        if (!runtimeSavePathExists(path)) return null;
        const source = std.loadFile(path);
        if (typeof source !== "string" || source.length === 0 || source.length > RUNTIME_SAVE_MAX_BYTES) return null;
        return normalizeRuntimeSaveData(JSON.parse(source));
    } catch (saveReadError) {
        console.log("[Heavenfall] Save invalido em " + path + ": " + saveReadError);
        return null;
    }
}

function readRuntimeSaveFile() {
    const primary = readRuntimeSaveAtPath(RUNTIME_SAVE_PATH);
    const save = primary || readRuntimeSaveAtPath(RUNTIME_SAVE_BACKUP_PATH);
    runtimeEngineState.saveChecked = true;
    runtimeEngineState.saveData = save;
    runtimeEngineState.saveAvailable = Boolean(save);
    runtimeEngineState.lastSaveError = save ? "" : "Nenhum save valido encontrado";
    return save;
}

function runtimeMemoryCardReady() {
    try {
        if (typeof System === "undefined" || typeof System.getMCInfo !== "function") {
            return { ok: false, error: "API do Memory Card indisponivel" };
        }
        const info = System.getMCInfo(0);
        if (!info || info.type === false || (typeof info.type === "number" && info.type === 0)) {
            return { ok: false, error: "Memory Card ausente no slot 1" };
        }
        if (info.format === false || (typeof info.format === "number" && info.format === 0)) {
            return { ok: false, error: "Memory Card do slot 1 nao esta formatado" };
        }
        return { ok: true, info: info };
    } catch (memoryCardError) {
        return { ok: false, error: "Falha ao consultar o Memory Card: " + memoryCardError };
    }
}

function runtimeIoSucceeded(result) {
    return result === undefined || result === true || result === 0;
}

function removeRuntimeSavePath(path) {
    if (!runtimeSavePathExists(path)) return true;
    try {
        return runtimeIoSucceeded(os.remove(path));
    } catch (removeError) {
        console.log("[Heavenfall] Nao foi possivel remover " + path + ": " + removeError);
        return false;
    }
}

function renameRuntimeSavePath(source, destination) {
    if (!runtimeSavePathExists(source)) return false;
    if (runtimeSavePathExists(destination) && !removeRuntimeSavePath(destination)) return false;

    function destinationReady() {
        if (!readRuntimeSaveAtPath(destination)) return false;
        if (runtimeSavePathExists(source)) removeRuntimeSavePath(source);
        return true;
    }

    const operations = [];
    if (typeof System !== "undefined" && typeof System.rename === "function") {
        operations.push(function () { return System.rename(source, destination); });
    }
    if (typeof System !== "undefined" && typeof System.moveFile === "function") {
        operations.push(function () { return System.moveFile(source, destination); });
    }
    if (typeof os.rename === "function") {
        operations.push(function () { return os.rename(source, destination); });
    }

    for (let index = 0; index < operations.length; index++) {
        try {
            operations[index]();
            if (destinationReady()) return true;
            removeRuntimeSavePath(destination);
        } catch (renameError) {
            console.log("[Heavenfall] Metodo de movimentacao " + index + " falhou: " + renameError);
            removeRuntimeSavePath(destination);
        }
    }

    if (typeof System !== "undefined" && typeof System.copyFile === "function") {
        try {
            System.copyFile(source, destination);
            if (destinationReady()) {
                console.log("[Heavenfall] Save promovido por copia verificada");
                return true;
            }
        } catch (copyError) {
            console.log("[Heavenfall] Copia de seguranca falhou: " + copyError);
        }
    }
    removeRuntimeSavePath(destination);
    return false;
}

function writeRuntimeSaveFile(input) {
    const data = normalizeRuntimeSaveData(input);
    if (!data) return { ok: false, error: "Os dados do save sao invalidos" };
    const card = runtimeMemoryCardReady();
    if (!card.ok) return card;

    let payload = "";
    try {
        payload = JSON.stringify(data);
    } catch (serializeError) {
        return { ok: false, error: "Nao foi possivel preparar o save: " + serializeError };
    }
    if (!payload || payload.length > RUNTIME_SAVE_MAX_BYTES) {
        return { ok: false, error: "O save excede o limite de " + RUNTIME_SAVE_MAX_BYTES + " bytes" };
    }

    try {
        if (typeof os.mkdir === "function") os.mkdir(RUNTIME_SAVE_DIRECTORY);
    } catch (directoryError) {
        console.log("[Heavenfall] Diretorio do save ja existe ou nao pode ser criado: " + directoryError);
    }

    removeRuntimeSavePath(RUNTIME_SAVE_TEMP_PATH);
    let file = null;
    try {
        file = std.open(RUNTIME_SAVE_TEMP_PATH, "w");
        if (!file) return { ok: false, error: "Nao foi possivel abrir o arquivo temporario no Memory Card" };
        const writeResult = file.puts(payload);
        if (typeof writeResult === "number" && writeResult < 0) throw new Error("codigo " + writeResult);
        if (typeof file.flush === "function") {
            const flushResult = file.flush();
            if (typeof flushResult === "number" && flushResult < 0) throw new Error("flush " + flushResult);
        }
        const closeResult = file.close();
        file = null;
        if (typeof closeResult === "number" && closeResult < 0) throw new Error("close " + closeResult);
    } catch (writeError) {
        if (file && typeof file.close === "function") {
            try { file.close(); } catch (closeError) { console.log("[Heavenfall] Falha ao fechar save: " + closeError); }
        }
        removeRuntimeSavePath(RUNTIME_SAVE_TEMP_PATH);
        return { ok: false, error: "Falha ao gravar no Memory Card: " + writeError };
    }

    if (!readRuntimeSaveAtPath(RUNTIME_SAVE_TEMP_PATH)) {
        removeRuntimeSavePath(RUNTIME_SAVE_TEMP_PATH);
        return { ok: false, error: "A verificacao do arquivo gravado falhou" };
    }

    const hadPrimary = runtimeSavePathExists(RUNTIME_SAVE_PATH);
    const primaryWasValid = hadPrimary && Boolean(readRuntimeSaveAtPath(RUNTIME_SAVE_PATH));
    let preservedPrimary = false;
    if (primaryWasValid) {
        removeRuntimeSavePath(RUNTIME_SAVE_BACKUP_PATH);
        if (!renameRuntimeSavePath(RUNTIME_SAVE_PATH, RUNTIME_SAVE_BACKUP_PATH)) {
            removeRuntimeSavePath(RUNTIME_SAVE_TEMP_PATH);
            return { ok: false, error: "Nao foi possivel preservar o save anterior" };
        }
        preservedPrimary = true;
        if (runtimeSavePathExists(RUNTIME_SAVE_PATH) && !removeRuntimeSavePath(RUNTIME_SAVE_PATH)) {
            removeRuntimeSavePath(RUNTIME_SAVE_TEMP_PATH);
            return { ok: false, error: "Nao foi possivel liberar o destino do novo save" };
        }
    } else if (hadPrimary && !removeRuntimeSavePath(RUNTIME_SAVE_PATH)) {
        removeRuntimeSavePath(RUNTIME_SAVE_TEMP_PATH);
        return { ok: false, error: "Nao foi possivel remover o save principal corrompido" };
    }
    if (!renameRuntimeSavePath(RUNTIME_SAVE_TEMP_PATH, RUNTIME_SAVE_PATH)) {
        if (preservedPrimary && runtimeSavePathExists(RUNTIME_SAVE_BACKUP_PATH)) {
            renameRuntimeSavePath(RUNTIME_SAVE_BACKUP_PATH, RUNTIME_SAVE_PATH);
        }
        removeRuntimeSavePath(RUNTIME_SAVE_TEMP_PATH);
        return { ok: false, error: "Nao foi possivel concluir a gravacao do save" };
    }

    runtimeEngineState.saveChecked = true;
    runtimeEngineState.saveData = data;
    runtimeEngineState.saveAvailable = true;
    runtimeEngineState.lastSaveError = "";
    return { ok: true, data: data };
}

function drawRuntimeLoading(message) {
    const font = runtimeEngineState.font;
    const canvas = runtimeEngineState.canvas;
    Screen.clear(Color.new(0, 0, 0, 128));
    Screen.setParam(Screen.DEPTH_TEST_ENABLE, false);
    font.scale = 0.45;
    font.color = Color.new(210, 231, 246, 128);
    font.outline = 1.0;
    font.outline_color = Color.new(3, 8, 16, 128);
    font.dropshadow = 0.0;
    font.print(18, Math.max(18, canvas.height * 0.5 - 10), message);
    Screen.setParam(Screen.DEPTH_TEST_ENABLE, true);
    Screen.setParam(Screen.DEPTH_TEST_METHOD, Screen.DEPTH_GEQUAL);
    Screen.flip();
}

initializeRuntimeEngine();

function runAthenaGame(sceneBoot) {
const hasSceneBoot = sceneBoot && typeof sceneBoot.sceneId === "string" && sceneBoot.sceneId.length > 0;
const BOOT_SCENE_ID = hasSceneBoot
    ? sceneBoot.sceneId
    : (typeof globalThis.ATHENA_BOOT_SCENE_ID === "string" ? globalThis.ATHENA_BOOT_SCENE_ID : "");
const BOOT_SPAWN_ID = hasSceneBoot
    ? (typeof sceneBoot.spawnId === "string" ? sceneBoot.spawnId : "")
    : (typeof globalThis.ATHENA_BOOT_SPAWN_ID === "string" ? globalThis.ATHENA_BOOT_SPAWN_ID : "");
const BOOT_PLAYER_STATE = hasSceneBoot && sceneBoot.player && typeof sceneBoot.player === "object"
    ? sceneBoot.player
    : null;
const BOOT_SKIP_MENU = hasSceneBoot || globalThis.ATHENA_SKIP_MENU === true;
const requestedFadeFrames = hasSceneBoot ? sceneBoot.fadeFrames : globalThis.ATHENA_BOOT_FADE_FRAMES;
const BOOT_FADE_FRAMES = Math.max(1, Math.min(300, Number(requestedFadeFrames) || 30));

const canvas = runtimeEngineState.canvas;

let CLEAR_COLOR = Color.new(7, 15, 28, 128);
const HUD_WHITE = Color.new(210, 231, 246, 128);
const HUD_BLUE = Color.new(76, 184, 235, 128);

const font = runtimeEngineState.font;
font.scale = 0.45;
font.color = HUD_WHITE;
font.outline = 1.0;
font.outline_color = Color.new(3, 8, 16, 128);

drawRuntimeLoading("CARREGANDO CENA...");
reapRetiredActiveSfx();

Render.setView(64.0, 0.5, 180.0);
console.log("[VeuAzul] Render inicializado em modo OBJ");

// AthenaEnv resolves OBJ materials and their textures from the current folder.
let runtimePreviousDirectory = "..";
if (typeof os.getcwd === "function") {
    const currentDirectoryResult = os.getcwd();
    if (currentDirectoryResult && currentDirectoryResult[1] === 0) runtimePreviousDirectory = currentDirectoryResult[0];
}
const enterAssetsResult = os.chdir("assets");
if (typeof enterAssetsResult === "number" && enterAssetsResult !== 0) {
    throw new Error("Nao foi possivel acessar a pasta assets: " + enterAssetsResult);
}
if (typeof globalThis.Collision3D === "undefined") std.loadScript("collision.js");
if (typeof globalThis.VisualScriptingRuntime === "undefined" && std.exists("visual-scripting-runtime.js")) {
    std.loadScript("visual-scripting-runtime.js");
}

let menuBackground = null;
if (!BOOT_SKIP_MENU && std.exists("menu_background.png")) {
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
        let texture = null;
        let texturedData = null;
        try {
            texture = new Image(material.texture);
            texture.lock();
            texturedData = new RenderData(asset, texture);
            const configuredData = configureData(texturedData, material);
            runtimeMaterialTextures.push(texture);
            return configuredData;
        } catch (textureError) {
            releaseRenderData(texturedData);
            safelyCall(texture, "free");
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
globalThis.EDITOR_SCENE_PROJECT = { version: 2, startupSceneId: "", variables: [], scenes: [] };
globalThis.EDITOR_COLLISION_VERSION = 0;
globalThis.EDITOR_SETTINGS = {};
globalThis.EDITOR_COLLIDERS = [];
globalThis.EDITOR_SPAWN_POINTS = [];
globalThis.EDITOR_PORTALS = [];
globalThis.EDITOR_CHECKPOINTS = [];
globalThis.EDITOR_GAMEPLAY_COMPONENTS = [];
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
    console.log("[VeuAzul] Lendo catalogo de cenas");
    std.loadScript("scenes/project.generated.js");
}
let runtimeSceneFile = "scene.generated.js";
let runtimeSceneEntry = null;
if (BOOT_SCENE_ID) {
    for (let sceneIndex = 0; sceneIndex < EDITOR_SCENE_PROJECT.scenes.length; sceneIndex++) {
        const entry = EDITOR_SCENE_PROJECT.scenes[sceneIndex];
        if (entry.id === BOOT_SCENE_ID) {
            runtimeSceneEntry = entry;
            runtimeSceneFile = entry.file;
            break;
        }
    }
}
if (BOOT_SCENE_ID && !runtimeSceneEntry) {
    throw new Error("Cena solicitada ausente no catalogo: " + BOOT_SCENE_ID);
}
if (std.exists(runtimeSceneFile)) {
    console.log("[VeuAzul] Lendo dados da cena " + runtimeSceneFile + (BOOT_SCENE_ID ? " (solicitada: " + BOOT_SCENE_ID + ")" : ""));
    std.loadScript(runtimeSceneFile);
    if (BOOT_SCENE_ID && (!EDITOR_SCENE_META || EDITOR_SCENE_META.id !== BOOT_SCENE_ID)) {
        throw new Error("Arquivo de cena divergente; esperado " + BOOT_SCENE_ID + ", recebido " + (EDITOR_SCENE_META && EDITOR_SCENE_META.id ? EDITOR_SCENE_META.id : "sem id"));
    }
    console.log("[VeuAzul] Dados da cena prontos: " + (EDITOR_SCENE_META.id || runtimeSceneFile));
} else if (runtimeSceneFile !== "scene.generated.js" && std.exists("scene.generated.js")) {
    console.log("[VeuAzul] Cena solicitada nao encontrada: " + runtimeSceneFile + "; usando a inicial");
    runtimeSceneFile = "scene.generated.js";
    std.loadScript(runtimeSceneFile);
    console.log("[VeuAzul] Dados da cena inicial prontos: " + (EDITOR_SCENE_META.id || runtimeSceneFile));
}

const runtimeVariableDefinitions = EDITOR_SCENE_PROJECT.variables && EDITOR_SCENE_PROJECT.variables.length
    ? EDITOR_SCENE_PROJECT.variables
    : (EDITOR_LOGIC.variables || []);
const runtimeVariableTypes = {};
for (let variableIndex = 0; variableIndex < runtimeVariableDefinitions.length; variableIndex++) {
    const variable = runtimeVariableDefinitions[variableIndex];
    runtimeVariableTypes[variable.id] = variable.type || typeof variable.initialValue;
}
initializePersistentVariables(runtimeVariableDefinitions);
if (!runtimeEngineState.saveChecked && !BOOT_SKIP_MENU) readRuntimeSaveFile();
const runtimeLogicDefinition = {
    version: EDITOR_LOGIC.version || 1,
    variables: runtimeVariableDefinitions,
    graphs: EDITOR_LOGIC.graphs || []
};

const runtimeBackground = EDITOR_SETTINGS.background || { r: 7, g: 15, b: 28, a: 128 };
CLEAR_COLOR = Color.new(runtimeBackground.r, runtimeBackground.g, runtimeBackground.b, runtimeBackground.a);
Screen.setVSync(EDITOR_SETTINGS.vsync !== false);

if (EDITOR_CAMERA) {
    Render.setView(EDITOR_CAMERA.fov || 64.0, EDITOR_CAMERA.near || 0.5, EDITOR_CAMERA.far || 180.0);
}

const usingGeneratedScene = Boolean(EDITOR_SCENE_META && EDITOR_SCENE_META.id);
const usingEditorColliders = usingGeneratedScene || EDITOR_COLLIDERS.length > 0;

if (EDITOR_COLLIDERS.length === 0 && !usingGeneratedScene) {
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
if (EDITOR_SCENE.length === 0 && !usingGeneratedScene) {
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
const sceneRenderData = [];
const runtimeObjectVisibility = {};
const runtimeObjectDefinitions = {};
const runtimePersistentScene = persistentRuntimeScene(EDITOR_SCENE_META.id || BOOT_SCENE_ID);

function createRenderPair(asset, material) {
    let data = null;
    try {
        data = createRenderData(asset, material);
        return { data: data, object: new RenderObject(data) };
    } catch (renderPairError) {
        releaseRenderData(data);
        throw renderPairError;
    }
}

function createSceneRenderPair(definition) {
    try {
        return createRenderPair(definition.asset, definition.material);
    } catch (assetError) {
        console.log("[VeuAzul] Modelo nao carregado: " + definition.asset + " - " + assetError);
    }
    const fallbackAsset = "editor_primitives/cube.obj";
    if (definition.asset === fallbackAsset || !std.exists(fallbackAsset)) return null;
    try {
        console.log("[VeuAzul] Usando cubo de seguranca para " + definition.name);
        return createRenderPair(fallbackAsset, definition.material);
    } catch (fallbackError) {
        console.log("[VeuAzul] Cubo de seguranca nao carregado: " + fallbackError);
        return null;
    }
}

for (let i = 0; i < EDITOR_SCENE.length; i++) {
    const definition = EDITOR_SCENE[i];
    runtimeObjectDefinitions[definition.id] = definition;
    console.log("[VeuAzul] Carregando objeto " + definition.name + " (" + definition.asset + ")");
    const pair = createSceneRenderPair(definition);
    if (pair) {
        pair.object.position = definition.position;
        pair.object.rotation = definition.rotation;
        pair.object.scale = definition.scale;
    }
    sceneObjects.push(pair ? pair.object : null);
    sceneRenderData.push(pair ? pair.data : null);
    const storedObject = runtimePersistentScene.objects[definition.id];
    runtimeObjectVisibility[definition.id] = definition.persistent === true
        && storedObject && typeof storedObject.visible === "boolean"
        ? storedObject.visible
        : true;
}

function persistRuntimeObjectVisibility(id) {
    const definition = runtimeObjectDefinitions[id];
    if (!definition || definition.persistent !== true) return;
    const storedObject = runtimePersistentScene.objects[id] || {};
    storedObject.visible = runtimeObjectVisibility[id] !== false;
    runtimePersistentScene.objects[id] = storedObject;
}

const runtimeAnimationCollections = [];
const runtimeCharacterControllers = {};

function createRuntimeCharacterController(id, definition, object, asset) {
    const character = definition && definition.character;
    if (!character || character.enabled !== true || !/\.gltf$/i.test(asset || "")) return null;
    if (!object || typeof AnimCollection === "undefined" || typeof object.playAnim !== "function") return null;
    try {
        const animations = new AnimCollection(asset);
        const controller = {
            id: id,
            object: object,
            animations: animations,
            definition: character,
            state: "",
            clip: null,
            lockFrames: 0
        };
        runtimeAnimationCollections.push(animations);
        runtimeCharacterControllers[id] = controller;
        setRuntimeCharacterState(id, character.initialState || "idle", 0, true);
        return controller;
    } catch (animationError) {
        console.log("[VeuAzul] Personagem animado nao carregado: " + asset + " - " + animationError);
        return null;
    }
}

function runtimeCharacterLoop(state) {
    return state !== "attack" && state !== "hurt" && state !== "death";
}

function setRuntimeCharacterState(targetId, state, durationFrames, force) {
    const controller = runtimeCharacterControllers[targetId || "__player__"];
    if (!controller) return false;
    const stateName = controller.definition.states && controller.definition.states[state]
        ? state
        : controller.definition.initialState || "idle";
    const clipName = controller.definition.states ? controller.definition.states[stateName] : "";
    if (!clipName) return false;
    const clip = controller.animations[clipName];
    if (clip === undefined) return false;
    const frames = Math.max(0, Math.round(Number(durationFrames) || 0));
    if (!force && controller.state === stateName && controller.clip === clip) {
        if (frames > controller.lockFrames) controller.lockFrames = frames;
        return true;
    }
    controller.object.playAnim(clip, runtimeCharacterLoop(stateName));
    controller.state = stateName;
    controller.clip = clip;
    controller.lockFrames = frames;
    return true;
}

for (let animationIndex = 0; animationIndex < sceneObjects.length; animationIndex++) {
    const definition = EDITOR_SCENE[animationIndex];
    if (definition.character && definition.character.enabled) {
        createRuntimeCharacterController(definition.id, definition, sceneObjects[animationIndex], definition.asset);
        continue;
    }
    if (!definition.animation || !definition.animation.autoplay || !/\.gltf$/i.test(definition.asset)) continue;
    if (!sceneObjects[animationIndex] || typeof AnimCollection === "undefined" || typeof sceneObjects[animationIndex].playAnim !== "function") continue;
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

const runtimePlayer = EDITOR_SETTINGS.player || {};
const configuredPlayerAsset = runtimePlayer.modelAsset || "player.obj";
let loadedPlayerAsset = configuredPlayerAsset;
let playerPair = null;
try {
    playerPair = createRenderPair(configuredPlayerAsset);
} catch (playerError) {
    console.log("[VeuAzul] Jogador nao carregado: " + configuredPlayerAsset + " - " + playerError);
    try {
        playerPair = configuredPlayerAsset === "player.obj" ? null : createRenderPair("player.obj");
        if (playerPair) {
            loadedPlayerAsset = "player.obj";
            console.log("[VeuAzul] Usando player.obj de seguranca para o jogador");
        }
        if (!playerPair) {
            playerPair = createRenderPair("editor_primitives/cube.obj");
            loadedPlayerAsset = "editor_primitives/cube.obj";
            console.log("[VeuAzul] Usando cubo de seguranca para o jogador");
        }
    } catch (playerFallbackError) {
        console.log("[VeuAzul] Jogador de seguranca nao carregado: " + playerFallbackError);
    }
}
const playerData = playerPair ? playerPair.data : null;
const playerObject = playerPair ? playerPair.object : null;
if (playerObject) createRuntimeCharacterController("__player__", { character: runtimePlayer.character }, playerObject, loadedPlayerAsset);
console.log("[VeuAzul] " + sceneObjects.length + " objetos, jogador e colisoes prontos");

const reservedPointSlots = Math.min(2, EDITOR_POINT_LIGHTS.length);
const globalLightBudget = MAX_RUNTIME_LIGHTS - reservedPointSlots;
const runtimeLights = [];
let nextRuntimeLightSlot = 0;
for (let lightIndex = 0; lightIndex < runtimeEngineState.lightSlots.length; lightIndex++) {
    const light = runtimeEngineState.lightSlots[lightIndex];
    Lights.set(light, Lights.DIRECTION, 0.0, 1.0, 0.0);
    Lights.set(light, Lights.AMBIENT, 0.0, 0.0, 0.0);
    Lights.set(light, Lights.DIFFUSE, 0.0, 0.0, 0.0);
}
for (let i = 0; i < EDITOR_LIGHTS.length && runtimeLights.length < globalLightBudget; i++) {
        const definition = EDITOR_LIGHTS[i];
        // Older generated scenes approximated point lights as global directional
        // lights. Ignore them so their finite editor range is not misrepresented.
        if (definition.type === "point") continue;
        const light = runtimeEngineState.lightSlots[nextRuntimeLightSlot++];
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
    const iceLight = runtimeEngineState.lightSlots[nextRuntimeLightSlot++];
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
    const light = runtimeEngineState.lightSlots[nextRuntimeLightSlot++];
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

let activeSpawnPoint = null;
for (let spawnIndex = 0; spawnIndex < EDITOR_SPAWN_POINTS.length; spawnIndex++) {
    const candidate = EDITOR_SPAWN_POINTS[spawnIndex];
    if (BOOT_SPAWN_ID && candidate.id === BOOT_SPAWN_ID) {
        activeSpawnPoint = candidate;
        break;
    }
    if (!activeSpawnPoint && candidate.default) activeSpawnPoint = candidate;
}
if (!activeSpawnPoint && EDITOR_SPAWN_POINTS.length > 0) activeSpawnPoint = EDITOR_SPAWN_POINTS[0];
const configuredSpawn = runtimePlayer.spawn || { x: 0.0, y: 0.08, z: 18.0 };
const SCENE_SPAWN = activeSpawnPoint ? activeSpawnPoint.position : configuredSpawn;
const SPAWN = BOOT_PLAYER_STATE && Number.isFinite(Number(BOOT_PLAYER_STATE.x))
    && Number.isFinite(Number(BOOT_PLAYER_STATE.y)) && Number.isFinite(Number(BOOT_PLAYER_STATE.z))
    ? { x: Number(BOOT_PLAYER_STATE.x), y: Number(BOOT_PLAYER_STATE.y), z: Number(BOOT_PLAYER_STATE.z) }
    : SCENE_SPAWN;
const SPAWN_YAW = BOOT_PLAYER_STATE && Number.isFinite(Number(BOOT_PLAYER_STATE.yaw))
    ? Number(BOOT_PLAYER_STATE.yaw)
    : activeSpawnPoint
    ? activeSpawnPoint.yaw === undefined
        ? activeSpawnPoint.rotation ? activeSpawnPoint.rotation.y || 0.0 : 0.0
        : activeSpawnPoint.yaw
    : 0.0;
const PLAYER_RADIUS = Math.max(0.1, runtimePlayer.radius || 0.68);
const PLAYER_HEIGHT = Math.max(PLAYER_RADIUS * 2.0, runtimePlayer.height || 2.25);
const PLAYER_GROUND_Y = SCENE_SPAWN.y === undefined ? 0.08 : SCENE_SPAWN.y;
const WALK_SPEED = Math.max(0.01, runtimePlayer.walkSpeed || 0.125);
const RUN_SPEED = Math.max(WALK_SPEED, runtimePlayer.runSpeed || 0.19);
const JUMP_SPEED = Math.max(0.0, runtimePlayer.jumpSpeed === undefined ? 0.30 : runtimePlayer.jumpSpeed);
const GRAVITY = Math.max(0.0001, runtimePlayer.gravity || 0.014);
const SUPPORT_PROBE = 0.08;
const LANDING_SEARCH_STEPS = 7;
let playerX = SPAWN.x;
let playerZ = SPAWN.z;
let playerY = SPAWN.y === undefined ? PLAYER_GROUND_Y : SPAWN.y;
let playerVelocityY = 0.0;
let playerGrounded = true;
let playerYaw = SPAWN_YAW;
let cameraYaw = activeSpawnPoint ? SPAWN_YAW : EDITOR_CAMERA ? EDITOR_CAMERA.rotation.y : 0.0;
const runtimePlayerHealthConfig = runtimePlayer.health || {};
const runtimePlayerGameplay = runtimeEngineState.playerGameplay;
const configuredPlayerMaximumHealth = Math.max(1, Math.min(999999, Math.round(runtimePlayerHealthConfig.maximum || 100)));
if (!runtimePlayerGameplay.initialized) {
    runtimePlayerGameplay.initialized = true;
    runtimePlayerGameplay.currentHealth = Math.max(0, Math.min(
        configuredPlayerMaximumHealth,
        Math.round(runtimePlayerHealthConfig.initial === undefined ? configuredPlayerMaximumHealth : runtimePlayerHealthConfig.initial)
    ));
    runtimePlayerGameplay.invulnerabilityFrames = 0;
}
runtimePlayerGameplay.enabled = runtimePlayerHealthConfig.enabled === true;
runtimePlayerGameplay.maximumHealth = configuredPlayerMaximumHealth;
runtimePlayerGameplay.currentHealth = Math.max(0, Math.min(configuredPlayerMaximumHealth, runtimePlayerGameplay.currentHealth));

const runtimeGameplayComponents = [];
const runtimeGameplayById = {};
const runtimeGameplayByTrigger = {};
const runtimeHealthByTarget = {};
for (let gameplayIndex = 0; gameplayIndex < EDITOR_GAMEPLAY_COMPONENTS.length; gameplayIndex++) {
    const definition = EDITOR_GAMEPLAY_COMPONENTS[gameplayIndex];
    if (!definition || !definition.id || !definition.type) continue;
    const storedState = runtimePersistentScene.components[definition.id] || {};
    const state = {
        definition: definition,
        consumed: (definition.type === "collectible" || (definition.type === "interactable" && definition.once === true))
            ? storedState.consumed === true
            : false,
        cooldownFrames: 0,
        invulnerabilityFrames: 0,
        health: 0
    };
    if (definition.type === "health") {
        const maximum = Math.max(1, Math.min(999999, Math.round(definition.maximum || 100)));
        const initial = Math.max(0, Math.min(maximum, Math.round(definition.initial === undefined ? maximum : definition.initial)));
        state.health = definition.persistent === true && Number.isFinite(Number(storedState.health))
            ? Math.max(0, Math.min(maximum, Number(storedState.health)))
            : initial;
        state.maximumHealth = maximum;
        runtimeHealthByTarget[definition.objectId] = state;
        if (state.health <= 0 && definition.hideOnDeath !== false && runtimeObjectVisibility[definition.objectId] !== undefined) {
            runtimeObjectVisibility[definition.objectId] = false;
        }
    }
    if (definition.type === "collectible" && state.consumed) {
        const visualTargets = definition.visualTargetIds || [];
        for (let targetIndex = 0; targetIndex < visualTargets.length; targetIndex++) {
            if (runtimeObjectVisibility[visualTargets[targetIndex]] !== undefined) runtimeObjectVisibility[visualTargets[targetIndex]] = false;
        }
    }
    runtimeGameplayComponents.push(state);
    runtimeGameplayById[definition.id] = state;
    if (definition.triggerId) {
        if (!runtimeGameplayByTrigger[definition.triggerId]) runtimeGameplayByTrigger[definition.triggerId] = [];
        runtimeGameplayByTrigger[definition.triggerId].push(state);
    }
}
if (BOOT_PLAYER_STATE && !isPlayerValid(playerX, playerZ)) {
    const fallbackPosition = SCENE_SPAWN;
    const fallbackYaw = activeSpawnPoint
        ? activeSpawnPoint.yaw === undefined
            ? activeSpawnPoint.rotation ? activeSpawnPoint.rotation.y || 0.0 : 0.0
            : activeSpawnPoint.yaw
        : 0.0;
    console.log("[Heavenfall] Posicao salva invalida nesta cena; usando o ponto de entrada");
    playerX = fallbackPosition.x;
    playerY = fallbackPosition.y === undefined ? PLAYER_GROUND_Y : fallbackPosition.y;
    playerZ = fallbackPosition.z;
    playerYaw = fallbackYaw;
    cameraYaw = fallbackYaw;
}
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
const MENU_OPTIONS = ["Continuar", "Iniciar Jogo", "Créditos"];
let gameState = BOOT_SKIP_MENU ? GAME_STATE_GAME : GAME_STATE_MENU;
let menuSelection = runtimeSaveCanContinue() ? 0 : 1;
let menuStickLocked = false;
let menuPulse = 0;
let menuFrame = 0;
let menuAudioRequested = false;
let menuAudioStarted = false;
let runtimeAutoplayStarted = false;

Sound.setVolume(100);
let menuAudio = null;
if (!BOOT_SKIP_MENU && std.exists(MENU_AUDIO_ASSET)) {
    try {
        menuAudio = persistentRuntimeStream(MENU_AUDIO_ASSET);
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
        const sound = definition.mode === "sfx" ? Sound.Sfx(definition.asset) : persistentRuntimeStream(definition.asset);
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

let runtimeSceneTransition = null;
let runtimeFadeInRemaining = BOOT_SKIP_MENU ? BOOT_FADE_FRAMES : 0;
let runtimeTriggerPhaseActive = false;
let triggerTransitionSuppressionFrames = BOOT_SKIP_MENU ? BOOT_FADE_FRAMES : 0;

function sceneProjectEntry(sceneId) {
    for (let i = 0; i < EDITOR_SCENE_PROJECT.scenes.length; i++) {
        if (EDITOR_SCENE_PROJECT.scenes[i].id === sceneId) return EDITOR_SCENE_PROJECT.scenes[i];
    }
    return null;
}

function runtimeSaveCanContinue(data) {
    const save = data || runtimeEngineState.saveData;
    return Boolean(save && sceneProjectEntry(save.sceneId));
}

function buildRuntimeSaveData() {
    const variables = {};
    for (let index = 0; index < runtimeVariableDefinitions.length; index++) {
        const definition = runtimeVariableDefinitions[index];
        if (!definition || !definition.id) continue;
        const value = readPersistentVariable(definition.id, definition.initialValue, definition.type);
        if (runtimeSavePrimitive(value) !== undefined) variables[definition.id] = value;
    }
    return normalizeRuntimeSaveData({
        version: RUNTIME_SAVE_VERSION,
        sceneId: EDITOR_SCENE_META.id || BOOT_SCENE_ID || EDITOR_SCENE_PROJECT.startupSceneId,
        player: {
            x: playerX,
            y: playerY,
            z: playerZ,
            yaw: playerYaw,
            health: runtimePlayerGameplay.enabled ? runtimePlayerGameplay.currentHealth : undefined
        },
        variables: variables,
        scenes: runtimeEngineState.persistentState.scenes
    });
}

function applyRuntimeSaveData(data) {
    const save = normalizeRuntimeSaveData(data);
    if (!save || !runtimeSaveCanContinue(save)) return false;
    const variables = {};
    for (let index = 0; index < runtimeVariableDefinitions.length; index++) {
        const definition = runtimeVariableDefinitions[index];
        if (!definition || !definition.id) continue;
        const stored = Object.prototype.hasOwnProperty.call(save.variables, definition.id)
            ? save.variables[definition.id]
            : definition.initialValue;
        variables[definition.id] = coercePersistentVariable(stored, definition.type, definition.initialValue);
    }
    const scenes = {};
    for (let index = 0; index < EDITOR_SCENE_PROJECT.scenes.length; index++) {
        const id = EDITOR_SCENE_PROJECT.scenes[index].id;
        if (save.scenes[id]) scenes[id] = save.scenes[id];
    }
    runtimeEngineState.persistentState = { variables: variables, scenes: scenes };
    if (save.player.health !== undefined) {
        runtimeEngineState.playerGameplay.currentHealth = Math.max(0, Math.min(
            runtimeEngineState.playerGameplay.maximumHealth || 999999,
            Number(save.player.health)
        ));
    }
    runtimeEngineState.saveData = save;
    runtimeEngineState.saveAvailable = true;
    return true;
}

function showRuntimeSaveMessage(text, success) {
    runtimeMessageText = text;
    runtimeMessageTimer = success ? 150 : 240;
    console.log("[Heavenfall] " + text);
}

function saveRuntimeGame(showFeedback, preparedSnapshot) {
    const snapshot = preparedSnapshot || buildRuntimeSaveData();
    if (!snapshot) {
        if (showFeedback !== false) showRuntimeSaveMessage("Nao foi possivel preparar o checkpoint.", false);
        return false;
    }
    runtimeEngineState.sessionCheckpoint = snapshot;
    const result = writeRuntimeSaveFile(snapshot);
    if (result.ok) {
        if (showFeedback !== false) showRuntimeSaveMessage("Progresso salvo no Memory Card.", true);
        return true;
    }
    runtimeEngineState.lastSaveError = result.error || "Falha desconhecida ao salvar";
    if (showFeedback !== false) showRuntimeSaveMessage(runtimeEngineState.lastSaveError, false);
    return false;
}

function loadRuntimeGame(showFeedback) {
    if (runtimeSceneTransition) return false;
    const save = runtimeEngineState.sessionCheckpoint || readRuntimeSaveFile();
    if (!save || !runtimeSaveCanContinue(save)) {
        if (showFeedback !== false) showRuntimeSaveMessage("Nenhum progresso compativel foi encontrado.", false);
        return false;
    }
    if (!requestSceneTransition(save.sceneId, "", 24, save.player)) {
        if (showFeedback !== false) showRuntimeSaveMessage("Nao foi possivel carregar a cena salva.", false);
        return false;
    }
    applyRuntimeSaveData(save);
    if (showFeedback !== false) showRuntimeSaveMessage("Carregando progresso salvo...", true);
    return true;
}

function requestSceneTransition(sceneId, spawnId, fadeFrames, playerState) {
    if (runtimeSceneTransition || !sceneId) return false;
    if (runtimeTriggerPhaseActive && triggerTransitionSuppressionFrames > 0) {
        console.log("[VeuAzul] Transicao de trigger ignorada durante a entrada na cena");
        return false;
    }
    const entry = sceneProjectEntry(sceneId);
    if (!entry || !entry.file || !std.exists(entry.file)) {
        console.log("[VeuAzul] Transicao ignorada; cena ausente: " + sceneId);
        return false;
    }
    let resolvedSpawnId = spawnId || "";
    if (resolvedSpawnId) {
        let foundSpawn = false;
        const spawnPoints = entry.spawnPoints || [];
        for (let i = 0; i < spawnPoints.length; i++) {
            if (spawnPoints[i].id === resolvedSpawnId) {
                foundSpawn = true;
                break;
            }
        }
        if (!foundSpawn) {
            console.log("[VeuAzul] Entrada ausente em " + sceneId + ": " + resolvedSpawnId + "; usando a padrao");
            resolvedSpawnId = "";
        }
    }
    const resolvedPlayer = playerState && Number.isFinite(Number(playerState.x))
        && Number.isFinite(Number(playerState.y)) && Number.isFinite(Number(playerState.z))
        && Number.isFinite(Number(playerState.yaw))
        ? { x: Number(playerState.x), y: Number(playerState.y), z: Number(playerState.z), yaw: Number(playerState.yaw) }
        : null;
    runtimeSceneTransition = {
        sceneId: sceneId,
        spawnId: resolvedSpawnId,
        fadeFrames: Math.max(1, Math.min(300, Math.round(fadeFrames || 30))),
        elapsed: 0,
        player: resolvedPlayer
    };
    console.log("[VeuAzul] Preparando cena " + sceneId + (resolvedSpawnId ? " em " + resolvedSpawnId : ""));
    return true;
}

function compareRuntimeVariable(left, operator, right) {
    if (operator === "neq") return left !== right;
    if (operator === "gt") return Number(left) > Number(right);
    if (operator === "gte") return Number(left) >= Number(right);
    if (operator === "lt") return Number(left) < Number(right);
    if (operator === "lte") return Number(left) <= Number(right);
    return left === right;
}

function portalConditionSatisfied(condition) {
    if (!condition || condition.enabled !== true) return true;
    const type = runtimeVariableTypes[condition.variableId];
    if (!type) return false;
    return compareRuntimeVariable(
        readPersistentVariable(condition.variableId, undefined, type),
        condition.operator || "eq",
        condition.value
    );
}

function runPortalPhase(triggerId, phase) {
    for (let i = 0; i < EDITOR_PORTALS.length; i++) {
        const portal = EDITOR_PORTALS[i];
        if (portal.triggerId !== triggerId || portal.activation !== phase || !portalConditionSatisfied(portal.condition)) continue;
        requestSceneTransition(portal.targetSceneId, portal.targetSpawnId, portal.fadeFrames);
        return;
    }
}

function runCheckpointPhase(triggerId, phase) {
    for (let index = 0; index < EDITOR_CHECKPOINTS.length; index++) {
        const checkpoint = EDITOR_CHECKPOINTS[index];
        if (checkpoint.triggerId !== triggerId || checkpoint.activation !== phase) continue;
        const snapshot = buildRuntimeSaveData();
        if (!snapshot) {
            showRuntimeSaveMessage("Nao foi possivel ativar o checkpoint.", false);
            return;
        }
        runtimeEngineState.sessionCheckpoint = snapshot;
        if (checkpoint.autosave !== false) saveRuntimeGame(true, snapshot);
        else showRuntimeSaveMessage("Checkpoint ativado.", true);
        return;
    }
}

function persistRuntimeGameplayState(state) {
    if (!state || !state.definition) return;
    const definition = state.definition;
    const persistent = definition.type === "collectible"
        || (definition.type === "interactable" && definition.once === true)
        || (definition.type === "health" && definition.persistent === true);
    if (!persistent) return;
    const stored = runtimePersistentScene.components[definition.id] || {};
    if (definition.type === "health") stored.health = state.health;
    else stored.consumed = state.consumed === true;
    runtimePersistentScene.components[definition.id] = stored;
}

function emitRuntimeGameplayEvent(componentId, eventName, payload) {
    if (!runtimeVisualScripts || typeof runtimeVisualScripts.gameplay !== "function") return;
    runtimeVisualScripts.gameplay(componentId, eventName, payload || {});
}

function setRuntimeGameplayVisibility(targetIds, visible) {
    const targets = targetIds || [];
    for (let index = 0; index < targets.length; index++) {
        const targetId = targets[index];
        if (runtimeObjectVisibility[targetId] === undefined) continue;
        runtimeObjectVisibility[targetId] = visible !== false;
        persistRuntimeObjectVisibility(targetId);
    }
}

function respawnRuntimePlayer(fadeFrames) {
    if (runtimeSceneTransition) return false;
    const checkpoint = runtimeEngineState.sessionCheckpoint;
    if (checkpoint && runtimeSaveCanContinue(checkpoint)) {
        applyRuntimeSaveData(checkpoint);
        runtimePlayerGameplay.currentHealth = checkpoint.player.health === undefined
            ? runtimePlayerGameplay.maximumHealth
            : Math.max(1, Math.min(runtimePlayerGameplay.maximumHealth, checkpoint.player.health));
        runtimePlayerGameplay.invulnerabilityFrames = 0;
        setRuntimeCharacterState("__player__", "idle", 0, true);
        emitRuntimeGameplayEvent("player-health", "respawn", { health: runtimePlayerGameplay.currentHealth });
        return requestSceneTransition(checkpoint.sceneId, "", fadeFrames || 24, checkpoint.player);
    }
    runtimePlayerGameplay.currentHealth = Math.max(1, Math.min(
        runtimePlayerGameplay.maximumHealth,
        runtimePlayerHealthConfig.initial === undefined ? runtimePlayerGameplay.maximumHealth : runtimePlayerHealthConfig.initial
    ));
    runtimePlayerGameplay.invulnerabilityFrames = 0;
    setRuntimeCharacterState("__player__", "idle", 0, true);
    emitRuntimeGameplayEvent("player-health", "respawn", { health: runtimePlayerGameplay.currentHealth });
    return requestSceneTransition(EDITOR_SCENE_META.id || BOOT_SCENE_ID || EDITOR_SCENE_PROJECT.startupSceneId, "", fadeFrames || 24);
}

function applyRuntimeDamage(targetId, amount, sourceComponentId) {
    const damage = Math.max(0, Math.min(999999, Number(amount) || 0));
    if (damage <= 0) return false;
    if (!targetId || targetId === "__player__") {
        if (!runtimePlayerGameplay.enabled || runtimePlayerGameplay.currentHealth <= 0 || runtimePlayerGameplay.invulnerabilityFrames > 0) return false;
        runtimePlayerGameplay.currentHealth = Math.max(0, runtimePlayerGameplay.currentHealth - damage);
        runtimePlayerGameplay.invulnerabilityFrames = Math.max(0, Math.round(runtimePlayerHealthConfig.invulnerabilityFrames || 0));
        setRuntimeCharacterState("__player__", runtimePlayerGameplay.currentHealth <= 0 ? "death" : "hurt",
            runtimePlayerGameplay.currentHealth <= 0 ? 0 : (runtimePlayer.character && runtimePlayer.character.hurtFrames) || 24, true);
        emitRuntimeGameplayEvent("player-health", "damaged", {
            amount: damage,
            health: runtimePlayerGameplay.currentHealth,
            sourceComponentId: sourceComponentId || ""
        });
        if (runtimePlayerGameplay.currentHealth <= 0) {
            emitRuntimeGameplayEvent("player-health", "death", { sourceComponentId: sourceComponentId || "" });
            if (runtimePlayerHealthConfig.respawnOnDeath !== false) respawnRuntimePlayer(24);
        }
        return true;
    }
    const state = runtimeHealthByTarget[targetId];
    if (!state || state.health <= 0 || state.invulnerabilityFrames > 0) return false;
    const definition = state.definition;
    state.health = Math.max(0, state.health - damage);
    state.invulnerabilityFrames = Math.max(0, Math.round(definition.invulnerabilityFrames || 0));
    const characterDefinition = runtimeObjectDefinitions[definition.objectId]
        ? runtimeObjectDefinitions[definition.objectId].character
        : null;
    setRuntimeCharacterState(definition.objectId, state.health <= 0 ? "death" : "hurt",
        state.health <= 0 ? 0 : characterDefinition && characterDefinition.hurtFrames || 24, true);
    persistRuntimeGameplayState(state);
    emitRuntimeGameplayEvent(definition.id, "damaged", { amount: damage, health: state.health, sourceComponentId: sourceComponentId || "" });
    if (state.health <= 0) {
        if (definition.hideOnDeath !== false) setRuntimeGameplayVisibility([definition.objectId], false);
        emitRuntimeGameplayEvent(definition.id, "death", { sourceComponentId: sourceComponentId || "" });
    }
    return true;
}

function applyRuntimeHealing(targetId, amount) {
    const healing = Math.max(0, Math.min(999999, Number(amount) || 0));
    if (healing <= 0) return false;
    if (!targetId || targetId === "__player__") {
        if (!runtimePlayerGameplay.enabled) return false;
        const previous = runtimePlayerGameplay.currentHealth;
        runtimePlayerGameplay.currentHealth = Math.min(runtimePlayerGameplay.maximumHealth, previous + healing);
        if (runtimePlayerGameplay.currentHealth === previous) return false;
        if (previous <= 0) setRuntimeCharacterState("__player__", "idle", 0, true);
        emitRuntimeGameplayEvent("player-health", "healed", { amount: runtimePlayerGameplay.currentHealth - previous, health: runtimePlayerGameplay.currentHealth });
        return true;
    }
    const state = runtimeHealthByTarget[targetId];
    if (!state) return false;
    const previous = state.health;
    state.health = Math.min(state.maximumHealth, state.health + healing);
    if (state.health === previous) return false;
    if (previous <= 0) {
        const healedCharacter = runtimeObjectDefinitions[targetId] && runtimeObjectDefinitions[targetId].character;
        setRuntimeCharacterState(targetId, healedCharacter ? healedCharacter.initialState || "idle" : "idle", 0, true);
    }
    if (previous <= 0 && state.definition.hideOnDeath !== false) setRuntimeGameplayVisibility([state.definition.objectId], true);
    persistRuntimeGameplayState(state);
    emitRuntimeGameplayEvent(state.definition.id, "healed", { amount: state.health - previous, health: state.health });
    return true;
}

function collectRuntimeGameplayComponent(state) {
    if (!state || state.consumed) return false;
    const definition = state.definition;
    state.consumed = true;
    persistRuntimeGameplayState(state);
    if (definition.variableId && runtimeVariableTypes[definition.variableId] === "number") {
        const current = Number(readPersistentVariable(definition.variableId, 0, "number")) || 0;
        writePersistentVariable(definition.variableId, current + (Number(definition.amount) || 0), "number");
    }
    setRuntimeGameplayVisibility(definition.visualTargetIds, false);
    if (definition.message) {
        runtimeMessageText = definition.message;
        runtimeMessageTimer = 150;
    }
    emitRuntimeGameplayEvent(definition.id, "collected", {
        variableId: definition.variableId || "",
        amount: Number(definition.amount) || 0
    });
    if (definition.autosave === true) saveRuntimeGame(true);
    return true;
}

function runtimeInteractionAllowed(triggerId) {
    const components = runtimeGameplayByTrigger[triggerId] || [];
    for (let index = 0; index < components.length; index++) {
        const state = components[index];
        if (state.definition.type === "interactable" && state.definition.once === true && state.consumed) return false;
    }
    return true;
}

function runRuntimeGameplayPhase(triggerId, phase) {
    if (phase === "onEnter" && triggerTransitionSuppressionFrames > 0) return;
    const components = runtimeGameplayByTrigger[triggerId] || [];
    for (let index = 0; index < components.length; index++) {
        const state = components[index];
        const definition = state.definition;
        if (definition.type === "damage" && definition.activation === phase && state.cooldownFrames <= 0) {
            if (applyRuntimeDamage(definition.targetId, definition.amount, definition.id)) {
                state.cooldownFrames = Math.max(0, Math.round(definition.cooldownFrames || 0));
                emitRuntimeGameplayEvent(definition.id, "activated", { targetId: definition.targetId, amount: definition.amount });
            }
        } else if (definition.type === "collectible" && definition.activation === phase) {
            collectRuntimeGameplayComponent(state);
        } else if (definition.type === "interactable" && phase === "onInteract" && !state.consumed) {
            emitRuntimeGameplayEvent(definition.id, "interacted", { triggerId: triggerId });
            if (definition.once === true) {
                state.consumed = true;
                persistRuntimeGameplayState(state);
            }
        } else if (definition.type === "deathZone" && phase === "onEnter") {
            emitRuntimeGameplayEvent(definition.id, "entered", { triggerId: triggerId });
            respawnRuntimePlayer(definition.fadeFrames);
        }
    }
}

function stepRuntimeGameplay() {
    if (runtimePlayerGameplay.invulnerabilityFrames > 0) runtimePlayerGameplay.invulnerabilityFrames--;
    for (let index = 0; index < runtimeGameplayComponents.length; index++) {
        const state = runtimeGameplayComponents[index];
        if (state.cooldownFrames > 0) state.cooldownFrames--;
        if (state.invulnerabilityFrames > 0) state.invulnerabilityFrames--;
    }
}

function updateRuntimeCharacterStates(movedThisFrame, runningThisFrame) {
    for (const targetId in runtimeCharacterControllers) {
        const controller = runtimeCharacterControllers[targetId];
        if (controller.lockFrames > 0) controller.lockFrames--;
        if (targetId === "__player__") continue;
        const health = runtimeHealthByTarget[targetId];
        if (health && health.health <= 0) {
            setRuntimeCharacterState(targetId, "death", 0, false);
        } else if (controller.lockFrames <= 0) {
            setRuntimeCharacterState(targetId, controller.definition.initialState || "idle", 0, false);
        }
    }
    const playerController = runtimeCharacterControllers.__player__;
    if (!playerController || playerController.lockFrames > 0) return;
    let state = "idle";
    if (runtimePlayerGameplay.enabled && runtimePlayerGameplay.currentHealth <= 0) state = "death";
    else if (!playerGrounded) state = playerVelocityY > 0.0 ? "jump" : "fall";
    else if (movedThisFrame) state = runningThisFrame ? "run" : "walk";
    setRuntimeCharacterState("__player__", state, 0, false);
}

function runtimeInteractionPrompt() {
    for (let triggerIndex = 0; triggerIndex < activeTriggerIds.length; triggerIndex++) {
        const components = runtimeGameplayByTrigger[activeTriggerIds[triggerIndex]] || [];
        for (let index = 0; index < components.length; index++) {
            const state = components[index];
            if (state.definition.type === "interactable" && !state.consumed) return state.definition.prompt || "Pressione Triangulo para interagir";
            if (state.definition.type === "collectible" && state.definition.activation === "onInteract" && !state.consumed) return "Pressione Triangulo para coletar";
        }
    }
    return "";
}

function resetRuntimeGameplayForNewGame() {
    runtimePlayerGameplay.currentHealth = Math.max(0, Math.min(
        runtimePlayerGameplay.maximumHealth,
        runtimePlayerHealthConfig.initial === undefined ? runtimePlayerGameplay.maximumHealth : runtimePlayerHealthConfig.initial
    ));
    runtimePlayerGameplay.invulnerabilityFrames = 0;
    setRuntimeCharacterState("__player__", "idle", 0, true);
    for (let index = 0; index < runtimeGameplayComponents.length; index++) {
        const state = runtimeGameplayComponents[index];
        state.consumed = false;
        state.cooldownFrames = 0;
        state.invulnerabilityFrames = 0;
        if (state.definition.type === "health") {
            state.health = Math.max(0, Math.min(state.maximumHealth, state.definition.initial));
            if (state.definition.hideOnDeath !== false) setRuntimeGameplayVisibility([state.definition.objectId], state.health > 0);
            const resetCharacter = runtimeObjectDefinitions[state.definition.objectId]
                ? runtimeObjectDefinitions[state.definition.objectId].character
                : null;
            setRuntimeCharacterState(state.definition.objectId, resetCharacter ? resetCharacter.initialState || "idle" : "idle", 0, true);
        }
    }
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
            persistRuntimeObjectVisibility(id);
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
    if (action.type === "scene") {
        requestSceneTransition(action.sceneId, action.spawnId, action.fadeFrames);
        return;
    }
    if (action.type === "save") {
        saveRuntimeGame(true);
        return;
    }
    if (action.type === "load") {
        loadRuntimeGame(true);
        return;
    }
    if (action.type === "damage") {
        applyRuntimeDamage(action.targetId, action.amount, action.sourceComponentId);
        return;
    }
    if (action.type === "heal") {
        applyRuntimeHealing(action.targetId, action.amount);
        return;
    }
    if (action.type === "respawn") {
        respawnRuntimePlayer(action.fadeFrames);
        return;
    }
    if (action.type === "character") {
        const targetId = action.targetId || "__player__";
        const controller = runtimeCharacterControllers[targetId];
        const duration = action.durationFrames === undefined
            ? action.state === "hurt" ? controller && controller.definition.hurtFrames || 24
                : action.state === "attack" ? controller && controller.definition.attackFrames || 30 : 0
            : action.durationFrames;
        setRuntimeCharacterState(targetId, action.state || "idle", duration, true);
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
    runtimeTriggerPhaseActive = true;
    for (let i = 0; i < EDITOR_EVENTS.length; i++) {
        const definition = EDITOR_EVENTS[i];
        if (definition.triggerId !== triggerId) continue;
        const actions = definition[phase] || [];
        for (let actionIndex = 0; actionIndex < actions.length; actionIndex++) {
            executeRuntimeAction(actions[actionIndex]);
        }
    }
    if (runtimeVisualScripts) runtimeVisualScripts.trigger(triggerId, phase);
    runRuntimeGameplayPhase(triggerId, phase);
    runCheckpointPhase(triggerId, phase);
    runPortalPhase(triggerId, phase);
    runtimeTriggerPhaseActive = false;
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
        for (let i = 0; i < activeTriggerIds.length; i++) {
            if (runtimeInteractionAllowed(activeTriggerIds[i])) runTriggerPhase(activeTriggerIds[i], "onInteract");
        }
    }
    previousTriggerIds = activeTriggerIds.slice();
    if (triggerTransitionSuppressionFrames > 0) triggerTransitionSuppressionFrames--;
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

const pad = runtimeEngineState.pad;
pad.update();

function executeVisualScriptAction(type, config) {
    if (type === "actionMessage") executeRuntimeAction({ type: "message", text: config.text, duration: config.duration });
    else if (type === "actionDisplayVariable") {
        const variableType = runtimeVariableTypes[config.variableId];
        const value = variableType
            ? readPersistentVariable(config.variableId, undefined, variableType)
            : "?";
        executeRuntimeAction({
            type: "message",
            text: String(config.prefix || "") + String(value),
            duration: config.duration
        });
    }
    else if (type === "actionVisibility") executeRuntimeAction({
        type: "visibility", targetId: config.targetId, targetIds: config.targetIds, mode: config.mode
    });
    else if (type === "actionTeleport") executeRuntimeAction({ type: "teleport", position: config.position });
    else if (type === "actionAudio") executeRuntimeAction({ type: "audio", targetId: config.targetId, mode: config.mode });
    else if (type === "actionParticle") executeRuntimeAction({ type: "particle", targetId: config.targetId, mode: config.mode });
    else if (type === "actionVideo") executeRuntimeAction({ type: "video", targetId: config.targetId, mode: config.mode });
    else if (type === "actionScene") executeRuntimeAction({
        type: "scene", sceneId: config.sceneId, spawnId: config.spawnId, fadeFrames: config.fadeFrames
    });
    else if (type === "actionSaveGame") executeRuntimeAction({ type: "save" });
    else if (type === "actionLoadGame") executeRuntimeAction({ type: "load" });
    else if (type === "actionDamage") executeRuntimeAction({ type: "damage", targetId: config.targetId, amount: config.amount });
    else if (type === "actionHeal") executeRuntimeAction({ type: "heal", targetId: config.targetId, amount: config.amount });
    else if (type === "actionRespawn") executeRuntimeAction({ type: "respawn", fadeFrames: config.fadeFrames });
    else if (type === "actionCharacterState") executeRuntimeAction({
        type: "character", targetId: config.targetId, state: config.state, durationFrames: config.durationFrames
    });
}

const runtimeVisualScripts = typeof VisualScriptingRuntime !== "undefined"
    ? VisualScriptingRuntime.create(runtimeLogicDefinition, {
        execute: executeVisualScriptAction,
        readVariable: function (id, fallback, type) {
            return readPersistentVariable(id, fallback, type);
        },
        writeVariable: function (id, value, type) {
            return writePersistentVariable(id, value, type);
        },
        buttonPressed: function (buttonName) {
            const button = Pads[buttonName];
            return button !== undefined && pad.justPressed(button);
        },
        log: function (message) { console.log("[VisualScript] " + message); }
    })
    : null;
if (BOOT_SKIP_MENU && runtimeVisualScripts) runtimeVisualScripts.start();

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

function menuOptionEnabled(index) {
    return index !== 0 || runtimeSaveCanContinue();
}

function moveMenuSelection(direction) {
    for (let attempts = 0; attempts < MENU_OPTIONS.length; attempts++) {
        menuSelection += direction;
        if (menuSelection < 0) menuSelection = MENU_OPTIONS.length - 1;
        if (menuSelection >= MENU_OPTIONS.length) menuSelection = 0;
        if (menuOptionEnabled(menuSelection)) break;
    }
    menuPulse = 12;
}

function startExistingScenario() {
    runtimePersistentScene.objects = {};
    runtimePersistentScene.components = {};
    runtimeEngineState.persistentState = { variables: {}, scenes: {} };
    runtimeEngineState.persistentState.scenes[EDITOR_SCENE_META.id || BOOT_SCENE_ID || "legacy"] = runtimePersistentScene;
    runtimeEngineState.sessionCheckpoint = null;
    initializePersistentVariables(runtimeVariableDefinitions);
    resetRuntimeGameplayForNewGame();
    stopMenuAudio();
    startRuntimeAutoplayAudio();
    gameState = GAME_STATE_GAME;
    titleTimer = 330;
    collisionFlash = 0;
    runtimeMessageTimer = 0;
    if (runtimeVisualScripts) runtimeVisualScripts.start();
}

function startSavedScenario() {
    if (!loadRuntimeGame(true)) return;
    stopMenuAudio();
    gameState = GAME_STATE_GAME;
    titleTimer = 0;
    collisionFlash = 0;
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
        if (!menuOptionEnabled(menuSelection)) return;
        if (menuSelection === 0) startSavedScenario();
        else if (menuSelection === 1) startExistingScenario();
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
        playerYaw = SPAWN_YAW;
        cameraYaw = activeSpawnPoint ? SPAWN_YAW : EDITOR_CAMERA ? EDITOR_CAMERA.rotation.y : 0.0;
    }
    if (pad.justPressed(Pads.START)) showHud = !showHud;
    if (pad.justPressed(Pads.L1)) shoulderSide *= -1.0;
    if (pad.justPressed(Pads.R3)) cameraYaw = playerYaw;
    if (pad.justPressed(Pads.SQUARE) && playerGrounded && JUMP_SPEED > 0.0) {
        playerVelocityY = JUMP_SPEED;
        playerGrounded = false;
        if (runtimeVisualScripts) runtimeVisualScripts.playerJump();
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
    const runningThisFrame = buttonHeld(Pads.CROSS);
    const speed = runningThisFrame ? RUN_SPEED : WALK_SPEED;
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
    stepRuntimeGameplay();
    processRuntimeEvents();
    if (runtimeVisualScripts) runtimeVisualScripts.step();
    updateRuntimeAudio();
    updateRuntimeCharacterStates(movedThisFrame, runningThisFrame);

    if (playerObject) {
        playerObject.position = { x: playerX, y: playerY, z: playerZ };
        playerObject.rotation = { x: 0.0, y: playerYaw, z: 0.0 };
    }

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
        const enabled = menuOptionEnabled(i);
        const y = baseY + i * itemSpacing;
        const scale = selected ? 0.66 : 0.58;
        const text = MENU_OPTIONS[i];
        const textX = (canvas.width - estimateTextWidth(text, scale)) * 0.5;

        if (selected && enabled) {
            const pulse = 74 + Math.floor((Math.sin(menuFrame * 0.15) + 1.0) * 18.0);
            Draw.rect(boxX, y - 8, boxWidth, 34, Color.new(6, 24, 38, pulse));
            Draw.rect(boxX, y - 9, boxWidth, 1, Color.new(108, 200, 240, 88));
            Draw.rect(boxX, y + 27, boxWidth, 1, Color.new(23, 85, 116, 76));
            Draw.rect(boxX + 18, y + 2, 4, 16, Color.new(159, 225, 250, 116));
            Draw.rect(boxX + 22, y + 5, 4, 10, Color.new(159, 225, 250, 106));
            Draw.rect(boxX + 26, y + 8, 4, 4, Color.new(159, 225, 250, 96));
            font.color = Color.new(232, 244, 250, 128);
        } else if (enabled) {
            font.color = Color.new(151, 184, 202, 104);
        } else {
            font.color = Color.new(82, 102, 116, 72);
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
        runtimeUiFonts[resourceDefinition.fontAsset] = persistentRuntimeFont(resourceDefinition.fontAsset);
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

function safelyCall(resource, method) {
    if (!resource || typeof resource[method] !== "function") return;
    try {
        resource[method]();
    } catch (resourceError) {
        console.log("[VeuAzul] Falha ao liberar recurso (" + method + "): " + resourceError);
    }
}

function reapRetiredActiveSfx() {
    const pending = runtimeEngineState.retiredActiveSfx;
    let retainedCount = 0;
    for (let i = 0; i < pending.length; i++) {
        const entry = pending[i];
        let stillPlaying = true;
        try {
            stillPlaying = entry && entry.sound && entry.channel >= 0 && entry.sound.playing(entry.channel);
        } catch (sfxStateError) {
            console.log("[VeuAzul] Falha ao revisar SFX encerrado: " + sfxStateError);
        }
        if (stillPlaying) {
            pending[retainedCount++] = entry;
        } else if (entry) {
            safelyCall(entry.sound, "free");
        }
    }
    pending.length = retainedCount;
}

function suspendRuntimeStream(resource) {
    if (!resource) return;
    try {
        resource.loop = false;
        if (resource.playing()) {
            resource.pause();
            resource.rewind();
        }
    } catch (streamError) {
        console.log("[VeuAzul] Falha ao suspender stream persistente: " + streamError);
    }
}

function retainBorrowedNativeView(view) {
    if (view === undefined || view === null) return;
    const retired = runtimeEngineState.retiredNativeViews;
    if (retired.indexOf(view) < 0) retired.push(view);
}

function retireRenderObject(resource) {
    if (!resource) return;
    try {
        retainBorrowedNativeView(resource.transform);
        retainBorrowedNativeView(resource.bones);
        retainBorrowedNativeView(resource.bone_matrices);
    } catch (viewError) {
        console.log("[VeuAzul] Falha ao proteger views do objeto 3D: " + viewError);
    }
    safelyCall(resource, "free");
}

function releaseRenderData(resource) {
    if (!resource) return;
    // Skinned RenderData exposes bone vectors/matrices backed by pointers into
    // its native skeleton. Keep only those borrowed views alive after free;
    // ordinary OBJ RenderData can be collected normally. Release any texture
    // wrappers first so the safety guard does not retain VRAM.
    let hasBorrowedBoneViews = false;
    try {
        hasBorrowedBoneViews = resource.bones !== undefined && resource.bones !== null;
    } catch (boneProbeError) {
        console.log("[VeuAzul] Falha ao verificar dados esqueleticos: " + boneProbeError);
    }
    if (hasBorrowedBoneViews) {
        const textures = resource.textures;
        if (textures && textures.length) {
            for (let textureIndex = 0; textureIndex < textures.length; textureIndex++) {
                safelyCall(textures[textureIndex], "free");
            }
        }
        retainBorrowedNativeView(resource.bones);
    }
    safelyCall(resource, "free");
}

function freeRuntimeSceneResources() {
    console.log("[VeuAzul] Descarregando midia e audio");
    for (const id in runtimeUiMedia) {
        const entry = runtimeUiMedia[id];
        if (entry.type === "video") {
            // Video.frame is an Image view over the MPEG player's internal
            // texture in AthenaEnv. Never finalize it after destroying Video.
            retainBorrowedNativeView(entry.frame);
            safelyCall(entry.media, "stop");
        }
        safelyCall(entry.media, "free");
    }
    for (let i = 0; i < runtimeAudio.length; i++) {
        const entry = runtimeAudio[i];
        if (entry.definition.mode === "stream") {
            // AthenaEnv keeps the active stream in a native global used by the
            // audsrv fill callback. sound_free() closes and frees the stream
            // without clearing that global, so collecting/freeing it between
            // scenes can leave the audio callback pointing at released memory.
            // Streams are cached for the runtime lifetime and only suspended.
            suspendRuntimeStream(entry.sound);
            continue;
        }
        entry.sound.loop = false;
        let stillPlaying = false;
        try {
            stillPlaying = entry.channel >= 0 && entry.sound.playing(entry.channel);
        } catch (sfxStateError) {
            console.log("[VeuAzul] Falha ao consultar SFX: " + sfxStateError);
            stillPlaying = true;
        }
        if (stillPlaying) runtimeEngineState.retiredActiveSfx.push({ sound: entry.sound, channel: entry.channel });
        else safelyCall(entry.sound, "free");
    }
    suspendRuntimeStream(menuAudio);
    console.log("[VeuAzul] Descarregando objetos 3D");
    for (let i = 0; i < sceneObjects.length; i++) retireRenderObject(sceneObjects[i]);
    retireRenderObject(playerObject);
    for (let i = 0; i < runtimeParticleEmitters.length; i++) {
        const pool = runtimeParticleEmitters[i].pool;
        for (let particleIndex = 0; particleIndex < pool.length; particleIndex++) retireRenderObject(pool[particleIndex].object);
    }
    for (let i = 0; i < runtimeAnimationCollections.length; i++) safelyCall(runtimeAnimationCollections[i], "free");
    for (let i = 0; i < sceneRenderData.length; i++) releaseRenderData(sceneRenderData[i]);
    releaseRenderData(playerData);
    for (let i = 0; i < runtimeParticleEmitters.length; i++) releaseRenderData(runtimeParticleEmitters[i].data);
    for (let i = 0; i < runtimeShadows.length; i++) {
        safelyCall(runtimeShadows[i].projector, "free");
        safelyCall(runtimeShadows[i].texture, "free");
    }
    for (let i = 0; i < runtimeMaterialTextures.length; i++) safelyCall(runtimeMaterialTextures[i], "free");
    safelyCall(menuBackground, "free");
    console.log("[VeuAzul] Recursos da cena liberados");
}

function drawSceneTransitionFade() {
    let alpha = 0;
    if (runtimeSceneTransition) {
        runtimeSceneTransition.elapsed++;
        alpha = Math.round(128.0 * runtimeSceneTransition.elapsed / runtimeSceneTransition.fadeFrames);
    } else if (runtimeFadeInRemaining > 0) {
        alpha = Math.round(128.0 * runtimeFadeInRemaining / BOOT_FADE_FRAMES);
        runtimeFadeInRemaining--;
    }
    if (alpha <= 0) return;
    Screen.setParam(Screen.DEPTH_TEST_ENABLE, false);
    Draw.rect(0, 0, canvas.width, canvas.height, Color.new(0, 0, 0, Math.min(128, alpha)));
    Screen.setParam(Screen.DEPTH_TEST_ENABLE, true);
    Screen.setParam(Screen.DEPTH_TEST_METHOD, Screen.DEPTH_GEQUAL);
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
        if (runtimePlayerGameplay.enabled && runtimePlayerHealthConfig.showHud !== false) {
            const healthRatio = runtimePlayerGameplay.maximumHealth > 0
                ? clamp(runtimePlayerGameplay.currentHealth / runtimePlayerGameplay.maximumHealth, 0.0, 1.0)
                : 0.0;
            Draw.rect(14, 67, 184, 18, Color.new(3, 10, 16, 104));
            Draw.rect(17, 70, 178 * healthRatio, 12, Color.new(194, 52, 73, 118));
            font.scale = 0.36;
            font.color = Color.new(244, 232, 235, 128);
            font.print(22, 69, "VIDA " + Math.round(runtimePlayerGameplay.currentHealth) + " / " + Math.round(runtimePlayerGameplay.maximumHealth));
        }
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

    const interactionPrompt = runtimeInteractionPrompt();
    if (interactionPrompt) {
        const promptText = interactionPrompt.substring(0, 72);
        const promptWidth = Math.min(canvas.width - 48, Math.max(240, estimateTextWidth(promptText, 0.44) + 36));
        Draw.rect((canvas.width - promptWidth) * 0.5, canvas.height - 178, promptWidth, 30, Color.new(4, 11, 18, 108));
        font.scale = 0.44;
        font.color = Color.new(225, 238, 245, 128);
        font.print((canvas.width - estimateTextWidth(promptText, 0.44)) * 0.5, canvas.height - 169, promptText);
    }

    Screen.setParam(Screen.DEPTH_TEST_ENABLE, true);
    Screen.setParam(Screen.DEPTH_TEST_METHOD, Screen.DEPTH_GEQUAL);
}

let runtimeLoopRunning = true;

function renderGameFrame() {
    Screen.clear(CLEAR_COLOR);
    if (typeof Render.resetStats === "function") Render.resetStats();
    Render.begin();
    pointLightTime += 1.0 / 60.0;
    for (let i = 0; i < sceneObjects.length; i++) {
        const definition = EDITOR_SCENE[i];
        const center = definition.boundsCenter || definition.position;
        applyPointLightsAt(center.x, center.y, center.z);
        if (sceneObjects[i] && runtimeObjectVisibility[definition.id] !== false) sceneObjects[i].render();
    }
    renderRuntimeShadows();
    updateAndRenderParticles();
    applyPointLightsAt(playerX, playerY + PLAYER_HEIGHT * 0.5, playerZ);
    if (playerObject) playerObject.render();
    disablePointLights();
    drawHud();
    drawSceneTransitionFade();
    Screen.flip();
    if (runtimeSceneTransition && runtimeSceneTransition.elapsed >= runtimeSceneTransition.fadeFrames) runtimeLoopRunning = false;
}

while (runtimeLoopRunning) {
    reapRetiredActiveSfx();
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

if (!runtimeLoopRunning && runtimeSceneTransition) {
    const completedTransition = {
        sceneId: runtimeSceneTransition.sceneId,
        spawnId: runtimeSceneTransition.spawnId,
        fadeFrames: runtimeSceneTransition.fadeFrames,
        player: runtimeSceneTransition.player
    };
    drawRuntimeLoading("CARREGANDO " + completedTransition.sceneId.toUpperCase() + "...");
    freeRuntimeSceneResources();
    console.log("[VeuAzul] Cena " + (EDITOR_SCENE_META.id || "atual") + " descarregada");
    let restoreDirectoryResult = os.chdir(runtimePreviousDirectory);
    if (typeof restoreDirectoryResult === "number" && restoreDirectoryResult !== 0) {
        console.log("[VeuAzul] Falha ao restaurar diretorio " + runtimePreviousDirectory + ": " + restoreDirectoryResult + "; tentando ..");
        restoreDirectoryResult = os.chdir("..");
        if (typeof restoreDirectoryResult === "number" && restoreDirectoryResult !== 0) {
            throw new Error("Nao foi possivel sair da pasta assets: " + restoreDirectoryResult);
        }
    }
    return completedTransition;
}

return null;
}

let runtimeNextSceneTransition = runAthenaGame(null);
while (runtimeNextSceneTransition) {
    const completedSceneTransition = runtimeNextSceneTransition;
    // runAthenaGame initializes every generated global before loading the next
    // script. Do not force QuickJS GC here: explicit native frees followed by
    // an immediate cycle collection corrupt shapes in current AthenaEnv builds.
    console.log("[VeuAzul] Carregando cena " + completedSceneTransition.sceneId + " no runtime atual");
    runtimeNextSceneTransition = runAthenaGame(completedSceneTransition);
}
