import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import {
  LOGIC_BUTTONS,
  LOGIC_NODE_DEFINITIONS,
  createLogicGraph,
  createLogicNode,
  createLogicVariable,
  normalizeLogic,
  validateLogic,
} from "./visual-scripting.js";

const $ = (id) => document.getElementById(id);
const viewport = $("viewport");
const objectList = $("object-list");
const assetList = $("asset-list");
const inspector = $("inspector");
const inspectorEmpty = $("inspector-empty");
const loadingIndicator = $("loading-indicator");
const loadingLabel = $("loading-label");
const toastStack = $("toast-stack");
const selectionMarquee = $("selection-marquee");

const state = {
  document: null,
  objects: new Map(),
  assets: [],
  assetFiles: [],
  textures: [],
  fontFiles: [],
  audioFiles: [],
  videoFiles: [],
  prefabs: [],
  selectedIds: new Set(),
  primaryId: null,
  dirty: false,
  documentRevision: 0,
  loading: 0,
  loadGeneration: 0,
  undo: [],
  redo: [],
  transformMode: "translate",
  transformSpace: "world",
  dragSnapshot: null,
  multiTransformStart: null,
  fieldSnapshot: null,
  runPoll: null,
  collidersVisible: true,
  clipboard: null,
  pasteCount: 0,
  rightHandActive: false,
  snapMode: "grid",
  pivotCustom: false,
  pivotEditing: false,
  pivotPosition: new THREE.Vector3(),
  pivotSelectionKey: "",
  boxSelectTool: false,
  boxSelecting: false,
  boxSelectStart: null,
  isolationRoots: new Set(),
  isolatedIds: null,
  collapsedHierarchy: new Set(),
  collapsedPanels: new Set(),
  previewCameraId: null,
  scenes: [],
  globalVariables: [],
  activeSceneId: null,
  startupSceneId: null,
  sceneProjectBusy: false,
  uiMode: false,
  logicMode: false,
  selectedUiId: null,
  selectedLogicGraphId: null,
  selectedLogicNodeId: null,
  logicConnecting: null,
  serverSchemaVersion: 0,
  serverOutdated: false,
};

let saveQueue = Promise.resolve();

const scene = new THREE.Scene();
scene.background = new THREE.Color("#07101d");
scene.fog = new THREE.FogExp2("#07101d", 0.0085);

const camera = new THREE.PerspectiveCamera(52, 1, 0.05, 2000);
camera.position.set(24, 20, 32);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.45;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewport.prepend(renderer.domElement);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;
orbit.target.set(0, 2, 0);
orbit.screenSpacePanning = true;
orbit.maxDistance = 500;
orbit.minDistance = 0.1;
orbit.zoomSpeed = 2;
orbit.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
orbit.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
orbit.mouseButtons.RIGHT = THREE.MOUSE.PAN;

const transform = new TransformControls(camera, renderer.domElement);
transform.setMode("translate");
transform.setSpace("world");
transform.setSize(0.82);
const transformHelper = transform.getHelper();
scene.add(transformHelper);

const editorRoot = new THREE.Group();
editorRoot.name = "EditorObjects";
scene.add(editorRoot);

const grid = new THREE.GridHelper(120, 120, 0x57cef5, 0x244251);
grid.material.opacity = 0.34;
grid.material.transparent = true;
grid.material.depthWrite = false;
scene.add(grid);

const axes = new THREE.AxesHelper(4);
axes.material.depthTest = false;
axes.renderOrder = 5;
scene.add(axes);

const hemisphere = new THREE.HemisphereLight(0xcceeff, 0x263846, 2.35);
scene.add(hemisphere);

const workLight = new THREE.AmbientLight(0xd8edff, 1.25);
scene.add(workLight);

const keyLight = new THREE.DirectionalLight(0xd8f4ff, 2.8);
keyLight.position.set(-18, 28, 16);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -45;
keyLight.shadow.camera.right = 45;
keyLight.shadow.camera.top = 45;
keyLight.shadow.camera.bottom = -45;
scene.add(keyLight);

function updateEditorLightingRig() {
  const hasSceneLights = state.document?.objects?.some((record) => record.source.kind === "light" && record.visible) === true;
  hemisphere.intensity = hasSceneLights ? 0.08 : 2.35;
  workLight.intensity = hasSceneLights ? 0.03 : 1.25;
  keyLight.intensity = hasSceneLights ? 0.12 : 2.8;
}

const warmLight = new THREE.DirectionalLight(0xffae78, 0.72);
warmLight.position.set(18, 9, -20);
scene.add(warmLight);

const selectionBounds = new THREE.Box3();
const selectionBox = new THREE.Box3Helper(selectionBounds, 0x6de0ff);
selectionBox.material.depthTest = false;
selectionBox.material.transparent = true;
selectionBox.material.opacity = 0.9;
selectionBox.renderOrder = 999;
selectionBox.visible = false;
scene.add(selectionBox);

const selectionPivot = new THREE.Object3D();
selectionPivot.name = "MultiSelectionPivot";
scene.add(selectionPivot);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const clock = new THREE.Clock();
let editorElapsedTime = 0;
const materialTextureLoader = new THREE.TextureLoader();
const materialTextureCache = new Map();

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function uid(prefix = "object") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clampNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanNumber(value) {
  const number = Math.abs(value) < 0.000001 ? 0 : value;
  return Number(number.toFixed(4));
}

function fileName(asset) {
  return String(asset || "").split("/").pop() || "Objeto";
}

const eventPhases = ["onEnter", "onExit", "onInteract"];
const eventActionTypes = ["message", "visibility", "teleport", "audio", "particle", "video", "save", "load", "scene"];

function normalizeEventAction(action = {}) {
  const type = eventActionTypes.includes(action.type) ? action.type : "message";
  return {
    id: String(action.id || uid("action")).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 96),
    type,
    ...(type === "message" ? {
      text: String(action.text || "Uma passagem foi encontrada.").slice(0, 160),
      duration: Math.round(THREE.MathUtils.clamp(clampNumber(action.duration, 180), 1, 3600)),
    } : {}),
    ...(type === "visibility" ? {
      targetId: typeof action.targetId === "string" ? action.targetId : "",
      mode: ["toggle", "show", "hide"].includes(action.mode) ? action.mode : "toggle",
    } : {}),
    ...(type === "teleport" ? {
      position: {
        x: clampNumber(action.position?.x),
        y: clampNumber(action.position?.y, 0.08),
        z: clampNumber(action.position?.z, 18),
      },
    } : {}),
    ...(type === "audio" ? {
      targetId: typeof action.targetId === "string" ? action.targetId : "",
      mode: ["play", "stop"].includes(action.mode) ? action.mode : "play",
    } : {}),
    ...(type === "particle" ? {
      targetId: typeof action.targetId === "string" ? action.targetId : "",
      mode: ["start", "stop", "burst"].includes(action.mode) ? action.mode : "burst",
    } : {}),
    ...(type === "video" ? {
      targetId: typeof action.targetId === "string" ? action.targetId : "",
      mode: ["play", "pause", "stop"].includes(action.mode) ? action.mode : "play",
    } : {}),
    ...(type === "scene" ? {
      sceneId: String(action.sceneId || "").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 96),
      spawnId: String(action.spawnId || "").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 96),
      fadeFrames: Math.round(THREE.MathUtils.clamp(clampNumber(action.fadeFrames, 30), 1, 300)),
    } : {}),
  };
}

function normalizeRecordEvents(events = {}) {
  return Object.fromEntries(eventPhases.map((phase) => [
    phase,
    (Array.isArray(events?.[phase]) ? events[phase] : []).slice(0, 32).map(normalizeEventAction),
  ]));
}

function normalizeUiElement(item = {}, index = 0) {
  const type = ["panel", "text", "image", "video"].includes(item.type) ? item.type : "text";
  const media = type === "image" || type === "video";
  const defaultWidth = media ? 192 : type === "panel" ? 240 : 280;
  const defaultHeight = media ? 108 : type === "panel" ? 72 : 28;
  const outline = THREE.MathUtils.clamp(clampNumber(item.outline), 0, 8);
  const dropshadow = outline > 0 ? 0 : THREE.MathUtils.clamp(clampNumber(item.dropshadow), 0, 16);
  return {
    id: String(item.id || uid("ui")).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 96),
    name: String(item.name || ({ panel: "Painel", text: "Texto", image: "Imagem", video: "Vídeo" }[type])).slice(0, 120),
    type,
    x: THREE.MathUtils.clamp(clampNumber(item.x, type === "panel" ? 24 : 32), 0, 640),
    y: THREE.MathUtils.clamp(clampNumber(item.y, type === "panel" ? 24 : 32), 0, 448),
    width: THREE.MathUtils.clamp(clampNumber(item.width, defaultWidth), 1, 640),
    height: THREE.MathUtils.clamp(clampNumber(item.height, defaultHeight), 1, 448),
    text: String(item.text || (type === "text" ? "Novo texto" : "")).slice(0, 240),
    asset: String(item.asset || ""),
    fontAsset: String(item.fontAsset || ""),
    fontScale: THREE.MathUtils.clamp(clampNumber(item.fontScale, 0.55), 0.15, 3),
    color: /^#[0-9a-f]{6}$/i.test(item.color || "") ? item.color : "#ffffff",
    outline,
    outlineColor: /^#[0-9a-f]{6}$/i.test(item.outlineColor || "") ? item.outlineColor : "#000000",
    dropshadow,
    dropshadowColor: /^#[0-9a-f]{6}$/i.test(item.dropshadowColor || "") ? item.dropshadowColor : "#000000",
    background: /^#[0-9a-f]{6}$/i.test(item.background || "") ? item.background : "#07121b",
    opacity: THREE.MathUtils.clamp(clampNumber(item.opacity, type === "panel" ? 0.82 : 1), 0, 1),
    align: ["left", "center", "right"].includes(item.align) ? item.align : "left",
    autoplay: item.autoplay !== false,
    loop: item.loop === true,
    visible: item.visible !== false,
    runtime: item.runtime !== false,
  };
}

function normalizeRecord(record = {}) {
  let kind = ["model", "primitive", "group", "collider", "light", "camera", "audio", "particle", "shadow", "spawn"].includes(record.source?.kind)
    ? record.source.kind
    : "model";
  const legacyName = String(record.name || "").toLocaleLowerCase("pt-BR");
  if (kind === "model" && !record.source?.asset) {
    if (record.light || record.source?.light || legacyName.startsWith("luz ")) kind = "light";
    else if (record.camera || legacyName.includes("câmera") || legacyName.includes("camera")) kind = "camera";
  }
  const materialColor = /^#[0-9a-f]{6}$/i.test(record.material?.color || "")
    ? record.material.color
    : kind === "primitive" && /^#[0-9a-f]{6}$/i.test(record.color || "") ? record.color : "#ffffff";
  const inferredLightType = legacyName.includes("ambiente") ? "ambient" : legacyName.includes("pontual") ? "point" : "directional";
  const lightType = ["ambient", "directional", "point"].includes(record.light?.type || record.source?.light)
    ? (record.light?.type || record.source?.light)
    : inferredLightType;
  const cameraNear = Math.max(0.01, clampNumber(record.camera?.near, 0.1));
  const cameraFar = Math.max(cameraNear + 0.1, clampNumber(record.camera?.far, 500));
  return {
    id: record.id || uid(kind),
    name: record.name || ({ primitive: "Primitiva", group: "Grupo", collider: "Colisor", light: "Luz", camera: "Câmera", audio: "Áudio", particle: "Partículas", shadow: "Projetor de sombra", spawn: "Ponto de entrada" }[kind] || fileName(record.source?.asset)),
    source: {
      kind,
      asset: record.source?.asset || "",
      ...(kind === "primitive" ? { primitive: record.source?.primitive || "cube" } : {}),
      ...(kind === "collider" ? { collider: ["box", "sphere", "capsule"].includes(record.source?.collider) ? record.source.collider : "box" } : {}),
      ...(kind === "light" ? { light: lightType } : {}),
    },
    parentId: record.parentId || null,
    position: {
      x: clampNumber(record.position?.x), y: clampNumber(record.position?.y), z: clampNumber(record.position?.z),
    },
    rotation: {
      x: clampNumber(record.rotation?.x), y: clampNumber(record.rotation?.y), z: clampNumber(record.rotation?.z),
    },
    scale: {
      x: clampNumber(record.scale?.x, 1), y: clampNumber(record.scale?.y, 1), z: clampNumber(record.scale?.z, 1),
    },
    color: /^#[0-9a-f]{6}$/i.test(record.color || "") ? record.color : "#8bd5f7",
    visible: record.visible !== false,
    locked: record.locked === true,
    runtime: record.runtime !== false,
    persistent: record.persistent === true,
    ...(["model", "primitive"].includes(kind) ? {
      material: {
        color: materialColor,
        texture: String(record.material?.texture || ""),
        opacity: THREE.MathUtils.clamp(clampNumber(record.material?.opacity, 1), 0, 1),
        roughness: THREE.MathUtils.clamp(clampNumber(record.material?.roughness, 0.72), 0, 1),
        metalness: THREE.MathUtils.clamp(clampNumber(record.material?.metalness, 0), 0, 1),
        emissive: /^#[0-9a-f]{6}$/i.test(record.material?.emissive || "") ? record.material.emissive : "#000000",
        emissiveIntensity: Math.max(0, clampNumber(record.material?.emissiveIntensity, 0)),
        unlit: record.material?.unlit === true,
        doubleSided: record.material?.doubleSided !== false,
        textureMapping: record.material?.textureMapping !== false,
        smoothShading: record.material?.smoothShading !== false,
        accurateClipping: record.material?.accurateClipping === true,
      },
    } : {}),
    ...(kind === "model" ? {
      animation: {
        clip: String(record.animation?.clip || "").slice(0, 120),
        autoplay: record.animation?.autoplay === true,
        loop: record.animation?.loop !== false,
      },
    } : {}),
    ...(kind === "collider" ? {
      collider: {
        trigger: record.collider?.trigger === true || record.portal?.enabled === true || record.checkpoint?.enabled === true,
        cameraBlocker: record.portal?.enabled === true || record.checkpoint?.enabled === true
          ? false
          : record.collider?.cameraBlocker !== false,
      },
      events: normalizeRecordEvents(record.events || record.collider?.events),
      portal: {
        enabled: record.portal?.enabled === true,
        targetSceneId: String(record.portal?.targetSceneId || "").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 96),
        targetSpawnId: String(record.portal?.targetSpawnId || "").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 96),
        activation: ["onEnter", "onInteract"].includes(record.portal?.activation) ? record.portal.activation : "onEnter",
        fadeFrames: Math.round(THREE.MathUtils.clamp(clampNumber(record.portal?.fadeFrames, 30), 1, 300)),
        condition: {
          enabled: record.portal?.condition?.enabled === true,
          variableId: String(record.portal?.condition?.variableId || "").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 96),
          operator: ["eq", "neq", "gt", "gte", "lt", "lte"].includes(record.portal?.condition?.operator)
            ? record.portal.condition.operator
            : "eq",
          value: ["string", "number", "boolean"].includes(typeof record.portal?.condition?.value)
            ? record.portal.condition.value
            : false,
        },
      },
      checkpoint: {
        enabled: record.checkpoint?.enabled === true,
        activation: ["onEnter", "onInteract"].includes(record.checkpoint?.activation) ? record.checkpoint.activation : "onEnter",
        autosave: record.checkpoint?.autosave !== false,
      },
    } : {}),
    ...(kind === "spawn" ? {
      spawn: { default: record.spawn?.default === true },
    } : {}),
    ...(kind === "light" ? {
      light: {
        type: lightType,
        color: /^#[0-9a-f]{6}$/i.test(record.light?.color || "") ? record.light.color : "#ffffff",
        intensity: Math.max(0, clampNumber(record.light?.intensity, lightType === "ambient" ? 0.45 : 2)),
        distance: Math.max(0.1, clampNumber(record.light?.distance, 12)),
        castShadow: record.light?.castShadow === true,
        flicker: record.light?.flicker === true,
        flickerAmount: THREE.MathUtils.clamp(clampNumber(record.light?.flickerAmount, 0.24), 0, 1),
        flickerSpeed: THREE.MathUtils.clamp(clampNumber(record.light?.flickerSpeed, 7.5), 0.1, 40),
      },
    } : {}),
    ...(kind === "camera" ? {
      camera: {
        fov: THREE.MathUtils.clamp(clampNumber(record.camera?.fov, 52), 15, 120),
        near: cameraNear,
        far: cameraFar,
        active: record.camera?.active === true,
        mode: ["follow", "fixed", "lookAtPlayer"].includes(record.camera?.mode) ? record.camera.mode : "follow",
      },
    } : {}),
    ...(kind === "audio" ? {
      audio: {
        mode: record.source?.asset
          ? (String(record.source.asset).toLowerCase().endsWith(".adp") ? "sfx" : "stream")
          : (["stream", "sfx"].includes(record.audio?.mode) ? record.audio.mode : "stream"),
        autoplay: record.audio?.autoplay !== false,
        loop: record.audio?.loop === true,
        volume: Math.round(THREE.MathUtils.clamp(clampNumber(record.audio?.volume, 80), 0, 100)),
        spatial: record.audio?.spatial === true,
        distance: THREE.MathUtils.clamp(clampNumber(record.audio?.distance, 14), 0.1, 500),
        pan: Math.round(THREE.MathUtils.clamp(clampNumber(record.audio?.pan), -100, 100)),
        pitch: Math.round(THREE.MathUtils.clamp(clampNumber(record.audio?.pitch), -100, 100)),
      },
    } : {}),
    ...(kind === "particle" ? {
      particle: {
        preset: ["fire", "smoke", "sparks"].includes(record.particle?.preset) ? record.particle.preset : "fire",
        color: /^#[0-9a-f]{6}$/i.test(record.particle?.color || "")
          ? record.particle.color
          : particlePresetHex(["fire", "smoke", "sparks"].includes(record.particle?.preset) ? record.particle.preset : "fire"),
        autoplay: record.particle?.autoplay !== false,
        maxParticles: Math.round(THREE.MathUtils.clamp(clampNumber(record.particle?.maxParticles, 6), 1, 8)),
        rate: THREE.MathUtils.clamp(clampNumber(record.particle?.rate, 8), 0.1, 30),
        lifetime: Math.round(THREE.MathUtils.clamp(clampNumber(record.particle?.lifetime, 70), 8, 360)),
        speed: THREE.MathUtils.clamp(clampNumber(record.particle?.speed, 0.035), 0, 0.25),
        spread: THREE.MathUtils.clamp(clampNumber(record.particle?.spread, 0.65), 0, 5),
        size: THREE.MathUtils.clamp(clampNumber(record.particle?.size, 0.16), 0.01, 2),
        gravity: THREE.MathUtils.clamp(clampNumber(record.particle?.gravity, -0.0004), -0.05, 0.05),
      },
    } : {}),
    ...(kind === "shadow" ? {
      shadow: {
        width: THREE.MathUtils.clamp(clampNumber(record.shadow?.width, 2.5), 0.1, 100),
        height: THREE.MathUtils.clamp(clampNumber(record.shadow?.height, 2.5), 0.1, 100),
        gridX: Math.round(THREE.MathUtils.clamp(clampNumber(record.shadow?.gridX, 6), 2, 32)),
        gridZ: Math.round(THREE.MathUtils.clamp(clampNumber(record.shadow?.gridZ, 6), 2, 32)),
        lightDirection: {
          x: clampNumber(record.shadow?.lightDirection?.x),
          y: clampNumber(record.shadow?.lightDirection?.y, 1),
          z: clampNumber(record.shadow?.lightDirection?.z, 1),
        },
        bias: THREE.MathUtils.clamp(clampNumber(record.shadow?.bias, -0.02), -1, 1),
        lightOffset: THREE.MathUtils.clamp(clampNumber(record.shadow?.lightOffset, 1), -100, 100),
        color: /^#[0-9a-f]{6}$/i.test(record.shadow?.color || "") ? record.shadow.color : "#000000",
        opacity: THREE.MathUtils.clamp(clampNumber(record.shadow?.opacity, 0.65), 0, 1),
        blend: ["darken", "alpha", "add"].includes(record.shadow?.blend) ? record.shadow.blend : "darken",
        followPlayer: record.shadow?.followPlayer === true,
      },
    } : {}),
    ...(record.prefabId ? { prefabId: record.prefabId } : {}),
  };
}

function setStatus(message) {
  $("status-message").textContent = message;
}

function toast(message, kind = "info", timeout = 3300) {
  const element = document.createElement("div");
  element.className = `toast ${kind}`;
  element.textContent = message;
  toastStack.append(element);
  window.setTimeout(() => element.remove(), timeout);
}

function setLoading(delta, label = "Carregando modelos…") {
  state.loading = Math.max(0, state.loading + delta);
  loadingIndicator.hidden = state.loading === 0;
  loadingLabel.textContent = label;
}

function markDirty(value = true) {
  if (value) state.documentRevision += 1;
  state.dirty = value;
  $("save-dot").classList.toggle("dirty", value);
  $("save-dot").title = value ? "Alterações ainda não salvas" : "Cena salva";
  document.title = `${value ? "● " : ""}Athena Visual Editor`;
}

function syncRecordFromObject(record, object) {
  record.position = {
    x: cleanNumber(object.position.x), y: cleanNumber(object.position.y), z: cleanNumber(object.position.z),
  };
  record.rotation = {
    x: cleanNumber(THREE.MathUtils.radToDeg(object.rotation.x)),
    y: cleanNumber(THREE.MathUtils.radToDeg(object.rotation.y)),
    z: cleanNumber(THREE.MathUtils.radToDeg(object.rotation.z)),
  };
  record.scale = {
    x: cleanNumber(object.scale.x), y: cleanNumber(object.scale.y), z: cleanNumber(object.scale.z),
  };
}

function applyRecordTransform(record, object) {
  object.position.set(record.position.x, record.position.y, record.position.z);
  object.rotation.set(
    THREE.MathUtils.degToRad(record.rotation.x),
    THREE.MathUtils.degToRad(record.rotation.y),
    THREE.MathUtils.degToRad(record.rotation.z),
  );
  object.scale.set(record.scale.x, record.scale.y, record.scale.z);
  applyEditorVisibility(record, object);
  object.updateMatrixWorld(true);
}

function syncAllRecords() {
  for (const record of state.document?.objects || []) {
    const object = state.objects.get(record.id);
    if (object) syncRecordFromObject(record, object);
  }
}

function saveCameraToDocument() {
  if (!state.document) return;
  state.document.settings.camera = {
    position: { x: cleanNumber(camera.position.x), y: cleanNumber(camera.position.y), z: cleanNumber(camera.position.z) },
    target: { x: cleanNumber(orbit.target.x), y: cleanNumber(orbit.target.y), z: cleanNumber(orbit.target.z) },
  };
}

function serializeScene() {
  syncAllRecords();
  saveCameraToDocument();
  return JSON.stringify(state.document);
}

function updateHistoryButtons() {
  $("undo-button").disabled = state.undo.length === 0;
  $("redo-button").disabled = state.redo.length === 0;
}

function updateClipboardButtons() {
  $("copy-button").disabled = state.selectedIds.size === 0;
  $("paste-button").disabled = !state.clipboard?.objects?.length;
}

function restoreClipboard() {
  try {
    const stored = JSON.parse(localStorage.getItem("athena-visual-editor-clipboard") || "null");
    if (stored?.version === 1 && Array.isArray(stored.objects) && stored.objects.length) {
      state.clipboard = stored;
    }
  } catch {
    state.clipboard = null;
  }
  updateClipboardButtons();
}

const editorLayoutStorageKey = "athena-visual-editor-layout-v1";

function restoreLayoutState() {
  try {
    const stored = JSON.parse(localStorage.getItem(editorLayoutStorageKey) || "null");
    state.collapsedHierarchy = new Set(Array.isArray(stored?.hierarchy) ? stored.hierarchy : []);
    state.collapsedPanels = new Set(Array.isArray(stored?.panels) ? stored.panels : []);
  } catch {
    state.collapsedHierarchy.clear();
    state.collapsedPanels.clear();
  }
}

function saveLayoutState() {
  try {
    localStorage.setItem(editorLayoutStorageKey, JSON.stringify({
      hierarchy: [...state.collapsedHierarchy],
      panels: [...state.collapsedPanels],
    }));
  } catch {
    // O layout continua funcionando durante a sessão se o armazenamento estiver bloqueado.
  }
}

function panelAccordionKey(section, index) {
  const side = section.closest(".left-panel") ? "left" : "right";
  const semanticClass = [...section.classList].find((name) => name.endsWith("-section") && !["panel-section", "inspector-section", "accordion-section"].includes(name));
  return `${side}:${section.id || semanticClass || `section-${index}`}`;
}

function applyPanelAccordion(section, collapsed) {
  section.classList.toggle("is-collapsed", collapsed);
  const toggle = section.querySelector(":scope > .accordion-header .accordion-toggle");
  if (toggle) {
    toggle.textContent = collapsed ? "▸" : "▾";
    toggle.title = collapsed ? "Expandir seção" : "Recolher seção";
    toggle.setAttribute("aria-expanded", String(!collapsed));
  }
}

function setupPanelAccordions() {
  const sections = [...document.querySelectorAll(".left-panel > .panel-section, .right-panel .inspector-section")];
  sections.forEach((section, index) => {
    if (section.classList.contains("accordion-section")) return;
    let header = [...section.children].find((child) => child.classList?.contains("section-heading") || child.classList?.contains("inspector-section-title"));
    if (!header) {
      const title = [...section.children].find((child) => child.tagName === "H3");
      if (!title) return;
      header = document.createElement("div");
      header.className = "inspector-section-title";
      section.insertBefore(header, title);
      header.append(title);
    }

    section.classList.add("accordion-section");
    header.classList.add("accordion-header");
    const content = document.createElement("div");
    content.className = "accordion-content";
    for (const child of [...section.children]) {
      if (child !== header) content.append(child);
    }
    section.append(content);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "accordion-toggle";
    toggle.setAttribute("aria-label", "Minimizar ou maximizar seção");
    if (section.closest(".left-panel")) {
      let actions = header.querySelector(":scope > .heading-actions");
      if (!actions) {
        actions = document.createElement("div");
        actions.className = "heading-actions";
        header.append(actions);
      }
      actions.prepend(toggle);
    } else {
      header.prepend(toggle);
    }

    const key = panelAccordionKey(section, index);
    section.dataset.accordionKey = key;
    applyPanelAccordion(section, state.collapsedPanels.has(key));
    header.addEventListener("click", (event) => {
      if (event.target.closest("button:not(.accordion-toggle), input, select, label")) return;
      const collapsed = !section.classList.contains("is-collapsed");
      if (collapsed) state.collapsedPanels.add(key);
      else state.collapsedPanels.delete(key);
      applyPanelAccordion(section, collapsed);
      saveLayoutState();
    });
  });
}

function pushHistorySnapshot(snapshot) {
  if (!snapshot || snapshot === serializeScene()) return;
  state.undo.push(snapshot);
  if (state.undo.length > 40) state.undo.shift();
  state.redo.length = 0;
  updateHistoryButtons();
  markDirty();
}

function stageFieldHistory() {
  if (state.fieldSnapshot !== null) return;
  const snapshot = serializeScene();
  state.fieldSnapshot = snapshot;
  state.undo.push(snapshot);
  if (state.undo.length > 40) state.undo.shift();
  state.redo.length = 0;
  updateHistoryButtons();
}

function finishFieldHistory() {
  state.fieldSnapshot = null;
}

function disposeObject(object) {
  object.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value?.isTexture) value.dispose();
      }
      material.dispose?.();
    }
  });
}

function primitiveGeometry(kind) {
  switch (kind) {
    case "sphere": return new THREE.SphereGeometry(1, 24, 16);
    case "cylinder": return new THREE.CylinderGeometry(1, 1, 2, 20);
    case "cone": return new THREE.ConeGeometry(1, 2, 20);
    case "plane": {
      const geometry = new THREE.PlaneGeometry(6, 6, 1, 1);
      geometry.rotateX(-Math.PI / 2);
      return geometry;
    }
    default: return new THREE.BoxGeometry(2, 2, 2);
  }
}

function createPrimitive(record) {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.72,
    metalness: 0.03,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(primitiveGeometry(record.source.primitive), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createCollider(record) {
  const root = new THREE.Group();
  const color = record.collider?.trigger ? 0xffaa63 : 0x68e0b2;
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.16,
    wireframe: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const wireMaterial = new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.9 });
  const shape = record.source.collider;
  if (shape === "sphere") {
    root.add(new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), material));
    root.add(new THREE.Mesh(new THREE.SphereGeometry(1.005, 16, 10), wireMaterial));
  } else if (shape === "capsule") {
    const cylinder = new THREE.CylinderGeometry(1, 1, 2, 14, 1, true);
    cylinder.rotateX(Math.PI / 2);
    root.add(new THREE.Mesh(cylinder, material), new THREE.Mesh(cylinder.clone(), wireMaterial));
    for (const z of [-1, 1]) {
      const cap = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      if (z < 0) cap.rotateX(Math.PI);
      cap.translate(0, 0, z);
      root.add(new THREE.Mesh(cap, material), new THREE.Mesh(cap.clone(), wireMaterial));
    }
  } else {
    root.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material));
    root.add(new THREE.Mesh(new THREE.BoxGeometry(2.01, 2.01, 2.01), wireMaterial));
  }
  root.userData.colliderVisual = true;
  root.traverse((child) => {
    child.renderOrder = 800;
    child.userData.colliderVisual = true;
  });
  return root;
}

function markEditorVisual(object) {
  object.traverse((child) => {
    child.userData.editorVisual = true;
    child.renderOrder = 900;
  });
  return object;
}

function createLightObject(record) {
  const root = new THREE.Group();
  const settings = record.light;
  let light;
  if (settings.type === "ambient") {
    light = new THREE.AmbientLight(settings.color, settings.intensity);
  } else if (settings.type === "point") {
    light = new THREE.PointLight(settings.color, settings.intensity, settings.distance, 2);
    light.castShadow = settings.castShadow;
    light.shadow.mapSize.set(1024, 1024);
  } else {
    light = new THREE.DirectionalLight(settings.color, settings.intensity);
    light.castShadow = settings.castShadow;
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.camera.left = -24;
    light.shadow.camera.right = 24;
    light.shadow.camera.top = 24;
    light.shadow.camera.bottom = -24;
    const target = new THREE.Object3D();
    target.position.set(0, 0, -1);
    root.add(target);
    light.target = target;
  }
  light.userData.editorLight = true;
  root.add(light);

  const color = new THREE.Color(settings.color);
  const visual = new THREE.Group();
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(settings.type === "ambient" ? 0.42 : 0.24, 12, 8),
    new THREE.MeshBasicMaterial({ color, wireframe: true, toneMapped: false }),
  );
  visual.add(sphere);
  if (settings.type === "directional") {
    const lineGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -2)]);
    visual.add(new THREE.Line(lineGeometry, new THREE.LineBasicMaterial({ color, toneMapped: false })));
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.42, 10), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    arrow.rotation.x = -Math.PI / 2;
    arrow.position.z = -2;
    visual.add(arrow);
  } else if (settings.type === "point") {
    const range = new THREE.Mesh(
      new THREE.SphereGeometry(settings.distance, 20, 12),
      new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.12, depthWrite: false, toneMapped: false }),
    );
    range.userData.lightRange = true;
    range.raycast = () => {};
    visual.add(range);
  }
  markEditorVisual(visual);
  root.add(visual);
  root.userData.editorLight = light;
  return root;
}

function createCameraObject(record) {
  const root = new THREE.Group();
  const settings = record.camera;
  const previewCamera = new THREE.PerspectiveCamera(settings.fov, 640 / 448, settings.near, settings.far);
  previewCamera.userData.editorPreviewCamera = true;
  root.add(previewCamera);

  const depth = 2;
  const halfHeight = Math.tan(THREE.MathUtils.degToRad(settings.fov * 0.5)) * depth;
  const halfWidth = halfHeight * previewCamera.aspect;
  const corners = [
    new THREE.Vector3(-halfWidth, halfHeight, -depth), new THREE.Vector3(halfWidth, halfHeight, -depth),
    new THREE.Vector3(halfWidth, -halfHeight, -depth), new THREE.Vector3(-halfWidth, -halfHeight, -depth),
  ];
  const points = [];
  for (const corner of corners) points.push(new THREE.Vector3(), corner);
  for (let index = 0; index < corners.length; index++) points.push(corners[index], corners[(index + 1) % corners.length]);
  const frustum = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0x57cef5, transparent: true, opacity: 0.8, toneMapped: false }),
  );
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 0.34, 0.42),
    new THREE.MeshBasicMaterial({ color: record.camera.active ? 0xffc15c : 0x57cef5, wireframe: true, toneMapped: false }),
  );
  body.position.z = 0.18;
  const visual = new THREE.Group();
  visual.add(frustum, body);
  markEditorVisual(visual);
  root.add(visual);
  root.userData.previewCamera = previewCamera;
  return root;
}

function createAudioObject(record) {
  const root = new THREE.Group();
  const color = record.audio.mode === "sfx" ? 0x78d8ba : 0x57cef5;
  const visual = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.52, 0.34),
    new THREE.MeshBasicMaterial({ color, wireframe: true, toneMapped: false }),
  );
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.34, 0.46, 12, 1, true),
    new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.8, toneMapped: false }),
  );
  cone.rotation.z = -Math.PI / 2;
  cone.position.x = 0.4;
  visual.add(body, cone);
  if (record.audio.mode === "sfx" && record.audio.spatial) {
    const range = new THREE.Mesh(
      new THREE.SphereGeometry(record.audio.distance, 18, 10),
      new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.1, depthWrite: false, toneMapped: false }),
    );
    range.raycast = () => {};
    visual.add(range);
  }
  markEditorVisual(visual);
  root.add(visual);
  return root;
}

function particlePresetColor(preset) {
  return { fire: 0xff380a, smoke: 0x616b7a, sparks: 0xffb814 }[preset] || 0xff380a;
}

function particlePresetHex(preset) {
  return `#${particlePresetColor(preset).toString(16).padStart(6, "0")}`;
}

function updateLegacyParticlePreview(particle, settings, index, particleCount, elapsedSeconds) {
  const seed = (index * 73 + 19) % 101;
  const progress = (elapsedSeconds * settings.rate / Math.max(1, particleCount) + index / Math.max(1, particleCount)) % 1;
  const angle = seed * 2.399;
  const radial = ((seed * 37) % 100) / 100 * settings.spread;
  const ageFrames = progress * settings.lifetime;
  let x = Math.cos(angle) * radial;
  let z = Math.sin(angle) * radial;
  let y = settings.speed * ageFrames - settings.gravity * ageFrames * ageFrames * 0.5;
  if (settings.preset === "smoke") {
    x += Math.sin(progress * 5 + seed) * settings.spread * 0.35;
    z += Math.cos(progress * 4 + seed) * settings.spread * 0.35;
  } else if (settings.preset === "sparks") {
    x += Math.cos(angle) * settings.speed * ageFrames;
    z += Math.sin(angle) * settings.speed * ageFrames;
    y = settings.speed * ageFrames * 0.75 - Math.abs(settings.gravity || 0.002) * ageFrames * ageFrames * 0.5;
  }
  particle.alive = settings.autoplay;
  particle.age = ageFrames;
  particle.life = settings.lifetime;
  particle.progress = progress;
  particle.x = x;
  particle.y = y * Math.max(0.2, settings.lifetime / 60);
  particle.z = z;
}

function stepLegacyParticlePreview(simulation, settings) {
  simulation.elapsedSeconds += 1 / 60;
  for (let index = 0; index < simulation.particles.length; index++) {
    const particle = simulation.particles[index];
    updateLegacyParticlePreview(particle, settings, index, simulation.particles.length, simulation.elapsedSeconds);
  }
}

function updateParticlePreviewObject(record, root, deltaSeconds) {
  const simulation = root?.userData.editorParticleSimulation;
  if (!simulation) return;
  const settings = record.particle;
  simulation.frameAccumulator += Math.min(Math.max(deltaSeconds || 0, 0), 0.25) * 60;
  while (simulation.frameAccumulator >= 1) {
    stepLegacyParticlePreview(simulation, settings);
    simulation.frameAccumulator -= 1;
  }
  for (let index = 0; index < simulation.particles.length; index++) {
    const particle = simulation.particles[index];
    const mesh = simulation.meshes[index];
    mesh.visible = particle.alive;
    if (!particle.alive) continue;
    const progress = particle.progress;
    const scale = settings.size;
    mesh.position.set(particle.x, particle.y, particle.z);
    mesh.rotation.set(progress * 2, progress * 3 + index, progress);
    mesh.scale.setScalar(scale);
  }
}

function createParticleObject(record) {
  const root = new THREE.Group();
  const particleGeometry = new THREE.OctahedronGeometry(1, 0);
  const particleMaterial = new THREE.MeshBasicMaterial({ color: record.particle.color, toneMapped: false });
  const meshes = [];
  const particles = [];
  for (let index = 0; index < record.particle.maxParticles; index++) {
    const mesh = new THREE.Mesh(particleGeometry, particleMaterial);
    mesh.visible = false;
    meshes.push(mesh);
    particles.push({ alive: false, age: 0, life: record.particle.lifetime, progress: 0, x: 0, y: 0, z: 0 });
    root.add(mesh);
  }
  const marker = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.38, 0.18, 12),
    new THREE.MeshBasicMaterial({ color: record.particle.color, wireframe: true, toneMapped: false }),
  );
  for (const mesh of meshes) markEditorVisual(mesh);
  markEditorVisual(marker);
  root.add(marker);
  root.userData.editorParticleSimulation = {
    particles,
    meshes,
    elapsedSeconds: 0,
    frameAccumulator: 0,
  };
  updateParticlePreviewObject(record, root, 0);
  return root;
}

function createSpawnPointObject(record) {
  const root = new THREE.Group();
  const color = record.spawn?.default ? 0xffc15c : 0x57cef5;
  const material = new THREE.MeshBasicMaterial({ color, wireframe: true, toneMapped: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.055, 8, 28), material);
  ring.rotation.x = Math.PI / 2;
  const stem = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1.35, 0)]),
    new THREE.LineBasicMaterial({ color, toneMapped: false }),
  );
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.55, 12), material);
  arrow.rotation.x = -Math.PI / 2;
  arrow.position.set(0, 0.28, -0.72);
  const direction = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.28, 0), new THREE.Vector3(0, 0.28, -0.72)]),
    new THREE.LineBasicMaterial({ color, toneMapped: false }),
  );
  root.add(ring, stem, arrow, direction);
  markEditorVisual(root);
  return root;
}

function normalizeRuntimeSettings(runtime = {}) {
  return {
    vsync: runtime.vsync !== false,
    showPerformance: runtime.showPerformance === true,
    legacyArenaBounds: runtime.legacyArenaBounds !== false,
    player: {
      spawn: {
        x: clampNumber(runtime.player?.spawn?.x),
        y: clampNumber(runtime.player?.spawn?.y, 0.08),
        z: clampNumber(runtime.player?.spawn?.z, 18),
      },
      radius: THREE.MathUtils.clamp(clampNumber(runtime.player?.radius, 0.68), 0.1, 5),
      height: THREE.MathUtils.clamp(clampNumber(runtime.player?.height, 2.25), 0.2, 10),
      walkSpeed: THREE.MathUtils.clamp(clampNumber(runtime.player?.walkSpeed, 0.125), 0.01, 2),
      runSpeed: THREE.MathUtils.clamp(clampNumber(runtime.player?.runSpeed, 0.19), 0.01, 3),
      jumpSpeed: THREE.MathUtils.clamp(clampNumber(runtime.player?.jumpSpeed, 0.3), 0, 2),
      gravity: THREE.MathUtils.clamp(clampNumber(runtime.player?.gravity, 0.014), 0.0001, 0.25),
    },
  };
}

function renderRuntimeSettings() {
  const settings = state.document?.settings;
  if (!settings) return;
  const runtime = settings.runtime;
  $("scene-background").value = settings.background;
  $("runtime-vsync").checked = runtime.vsync;
  $("runtime-performance").checked = runtime.showPerformance;
  $("runtime-arena-bounds").checked = runtime.legacyArenaBounds;
  $("player-spawn-x").value = runtime.player.spawn.x;
  $("player-spawn-y").value = runtime.player.spawn.y;
  $("player-spawn-z").value = runtime.player.spawn.z;
  $("player-radius").value = runtime.player.radius;
  $("player-height").value = runtime.player.height;
  $("player-walk-speed").value = runtime.player.walkSpeed;
  $("player-run-speed").value = runtime.player.runSpeed;
  $("player-jump-speed").value = runtime.player.jumpSpeed;
  $("player-gravity").value = runtime.player.gravity;
}

function updateRuntimeSettings() {
  if (!state.document) return;
  stageFieldHistory();
  state.document.settings.background = $("scene-background").value;
  state.document.settings.runtime = normalizeRuntimeSettings({
    vsync: $("runtime-vsync").checked,
    showPerformance: $("runtime-performance").checked,
    legacyArenaBounds: $("runtime-arena-bounds").checked,
    player: {
      spawn: {
        x: $("player-spawn-x").value,
        y: $("player-spawn-y").value,
        z: $("player-spawn-z").value,
      },
      radius: $("player-radius").value,
      height: $("player-height").value,
      walkSpeed: $("player-walk-speed").value,
      runSpeed: $("player-run-speed").value,
      jumpSpeed: $("player-jump-speed").value,
      gravity: $("player-gravity").value,
    },
  });
  const background = new THREE.Color(state.document.settings.background);
  scene.background = background;
  scene.fog.color.copy(background);
  renderUiPreview();
  markDirty();
}

function createShadowObject(record) {
  const root = new THREE.Group();
  const settings = record.shadow;
  const material = new THREE.MeshBasicMaterial({
    color: settings.color,
    transparent: true,
    opacity: settings.opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(settings.width, settings.height, settings.gridX - 1, settings.gridZ - 1), material);
  surface.rotation.x = -Math.PI / 2;
  surface.userData.shadowSurface = true;
  const wire = new THREE.LineSegments(
    new THREE.EdgesGeometry(surface.geometry, 20),
    new THREE.LineBasicMaterial({ color: 0x9b78ff, transparent: true, opacity: 0.9, toneMapped: false }),
  );
  wire.rotation.copy(surface.rotation);
  markEditorVisual(wire);
  surface.userData.editorVisual = true;
  surface.renderOrder = 850;
  root.add(surface, wire);
  return root;
}

async function applyShadowTexture(record, object = state.objects.get(record.id)) {
  if (!object || record.source.kind !== "shadow") return;
  const token = (object.userData.shadowTextureToken || 0) + 1;
  object.userData.shadowTextureToken = token;
  let texture = null;
  try {
    if (record.source.asset) {
      const sourceTexture = await loadMaterialTexture(record.source.asset);
      texture = sourceTexture?.clone() || null;
      if (texture) texture.needsUpdate = true;
    }
  } catch (error) {
    toast(`Textura de sombra não carregada: ${error.message}`, "error");
  }
  if (object.userData.shadowTextureToken !== token) {
    texture?.dispose?.();
    return;
  }
  let surface = null;
  object.traverse((child) => {
    if (child.userData.shadowSurface) surface = child;
  });
  if (!surface?.material) {
    texture?.dispose?.();
    return;
  }
  surface.material.map?.dispose?.();
  surface.material.map = texture;
  surface.material.needsUpdate = true;
}

async function loadObj(asset) {
  const url = `/assets/${asset.split("/").map(encodeURIComponent).join("/")}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Não foi possível abrir ${asset}`);
  const source = await response.text();
  const objectLoader = new OBJLoader();
  const materialMatch = source.match(/^\s*mtllib\s+(.+)$/mi);

  if (materialMatch) {
    const baseUrl = url.slice(0, url.lastIndexOf("/") + 1);
    const materialName = materialMatch[1].trim().replace(/^['"]|['"]$/g, "");
    try {
      const materialLoader = new MTLLoader();
      materialLoader.setResourcePath(baseUrl);
      const materials = await materialLoader.loadAsync(`${baseUrl}${materialName.split("/").map(encodeURIComponent).join("/")}`);
      materials.preload();
      objectLoader.setMaterials(materials);
    } catch (error) {
      console.warn(`MTL não carregado para ${asset}:`, error);
    }
  }
  return objectLoader.parse(source);
}

async function loadModel(asset) {
  const extension = asset.split(".").pop()?.toLowerCase();
  if (extension === "obj") return loadObj(asset);
  if (extension === "gltf" || extension === "glb") {
    const loader = new GLTFLoader();
    const url = `/assets/${asset.split("/").map(encodeURIComponent).join("/")}`;
    const result = await loader.loadAsync(url);
    result.scene.userData.editorAnimations = result.animations || [];
    return result.scene;
  }
  throw new Error(`Formato não suportado: ${extension || "desconhecido"}`);
}

function configureEditorAnimation(record, object, content = object?.children.find((child) => child.userData.editorContent)) {
  object?.userData.animationMixer?.stopAllAction();
  if (!object) return;
  object.userData.animationMixer = null;
  const clips = content?.userData.editorAnimations || [];
  object.userData.animationClips = clips;
  if (!record.animation?.autoplay || clips.length === 0 || !content) return;
  const clip = clips.find((candidate) => candidate.name === record.animation.clip) || clips[0];
  const mixer = new THREE.AnimationMixer(content);
  const action = mixer.clipAction(clip);
  action.setLoop(record.animation.loop ? THREE.LoopRepeat : THREE.LoopOnce, record.animation.loop ? Infinity : 1);
  action.clampWhenFinished = !record.animation.loop;
  action.play();
  object.userData.animationMixer = mixer;
}

function prepareModel(object) {
  let vertices = 0;
  let triangles = 0;
  object.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    if (!child.geometry.attributes.normal) child.geometry.computeVertexNormals();
    const count = child.geometry.attributes.position?.count || 0;
    vertices += count;
    triangles += child.geometry.index ? child.geometry.index.count / 3 : count / 3;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!material) continue;
      material.side = THREE.DoubleSide;
      if (child.geometry.attributes.color) material.vertexColors = true;
      material.needsUpdate = true;
    }
  });
  return { vertices: Math.round(vertices), triangles: Math.round(triangles) };
}

async function loadMaterialTexture(asset) {
  if (!asset) return null;
  if (!materialTextureCache.has(asset)) {
    const url = `/assets/${asset.split("/").map(encodeURIComponent).join("/")}`;
    materialTextureCache.set(asset, materialTextureLoader.loadAsync(url).then((texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      return texture;
    }).catch((error) => {
      materialTextureCache.delete(asset);
      throw error;
    }));
  }
  return materialTextureCache.get(asset);
}

function captureMaterialSources(object) {
  object.traverse((child) => {
    if (!child.isMesh || child.userData.editorMaterialSources) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    child.userData.editorMaterialSources = materials.map((material) => ({
      color: material?.color?.clone?.() || new THREE.Color(0xffffff),
      map: material?.map || null,
      vertexColors: material?.vertexColors === true,
      alphaTest: material?.alphaTest || 0,
    }));
  });
}

function createEditorMaterial(settings, source, overrideTexture) {
  const tint = source.color.clone().multiply(new THREE.Color(settings.color));
  const common = {
    color: tint,
    map: settings.textureMapping === false ? null : overrideTexture || source.map,
    transparent: settings.opacity < 0.999,
    opacity: settings.opacity,
    alphaTest: source.alphaTest,
    side: settings.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    vertexColors: source.vertexColors,
    toneMapped: !settings.unlit,
    flatShading: settings.smoothShading === false,
  };
  const material = settings.unlit
    ? new THREE.MeshBasicMaterial(common)
    : new THREE.MeshStandardMaterial({
      ...common,
      roughness: settings.roughness,
      metalness: settings.metalness,
      emissive: settings.emissive,
      emissiveIntensity: settings.emissiveIntensity,
    });
  material.userData.editorGenerated = true;
  return material;
}

async function applyRecordMaterial(record, object = state.objects.get(record.id)) {
  if (!object || !record.material || !["model", "primitive"].includes(record.source.kind)) return;
  const token = (object.userData.materialUpdateToken || 0) + 1;
  object.userData.materialUpdateToken = token;
  let texture = null;
  try {
    if (record.material.texture) {
      if (object.userData.materialTexturePath === record.material.texture && object.userData.materialOverrideTexture) {
        texture = object.userData.materialOverrideTexture;
      } else {
        const sourceTexture = await loadMaterialTexture(record.material.texture);
        texture = sourceTexture?.clone() || null;
        if (texture) texture.needsUpdate = true;
      }
    }
  } catch (error) {
    toast(`Textura não carregada: ${error.message}`, "error");
  }
  if (object.userData.materialUpdateToken !== token) {
    if (texture && texture !== object.userData.materialOverrideTexture) texture.dispose();
    return;
  }
  if (object.userData.materialOverrideTexture !== texture) object.userData.materialOverrideTexture?.dispose?.();
  object.userData.materialOverrideTexture = texture;
  object.userData.materialTexturePath = record.material.texture;
  captureMaterialSources(object);
  object.traverse((child) => {
    if (!child.isMesh || !child.userData.editorMaterialSources) return;
    const previous = Array.isArray(child.material) ? child.material : [child.material];
    const materials = child.userData.editorMaterialSources.map((source) => createEditorMaterial(record.material, source, texture));
    for (const material of previous) {
      if (material?.userData?.editorGenerated) material.dispose();
    }
    child.material = Array.isArray(child.material) ? materials : materials[0];
  });
}

function createErrorPlaceholder(record) {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshBasicMaterial({ color: 0xff5266, wireframe: true }),
  );
  const marker = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xff5266 }));
  marker.scale.setScalar(0.22);
  marker.position.y = 1.5;
  group.add(mesh, marker);
  group.userData.loadError = true;
  group.userData.errorText = `Falha ao carregar ${record.source.asset}`;
  return group;
}

async function createEditorObject(record, generation = state.loadGeneration) {
  const group = new THREE.Group();
  group.name = record.name;
  group.userData.editorId = record.id;
  group.userData.stats = { vertices: 0, triangles: 0 };
  applyRecordTransform(record, group);
  editorRoot.add(group);
  state.objects.set(record.id, group);

  if (record.source.kind === "group") {
    group.userData.stats = { vertices: 0, triangles: 0 };
    return group;
  }

  if (["light", "camera", "audio", "particle", "shadow", "spawn"].includes(record.source.kind)) {
    const content = record.source.kind === "light"
      ? createLightObject(record)
      : record.source.kind === "camera"
        ? createCameraObject(record)
        : record.source.kind === "audio"
          ? createAudioObject(record)
          : record.source.kind === "particle"
            ? createParticleObject(record)
            : record.source.kind === "shadow"
              ? createShadowObject(record)
              : createSpawnPointObject(record);
    content.userData.editorContent = true;
    group.add(content);
    group.userData.stats = { vertices: 0, triangles: 0 };
    if (record.source.kind === "light") group.userData.editorLight = content.userData.editorLight;
    if (record.source.kind === "camera") group.userData.previewCamera = content.userData.previewCamera;
    if (record.source.kind === "particle") group.userData.editorParticleRoot = content;
    if (record.source.kind === "shadow") await applyShadowTexture(record, group);
    updateEditorLightingRig();
    updateViewportStats();
    return group;
  }

  setLoading(1, record.source.kind === "collider" ? `Criando ${record.name}…` : `Carregando ${record.name}…`);
  try {
    const content = record.source.kind === "primitive"
      ? createPrimitive(record)
      : record.source.kind === "collider"
        ? createCollider(record)
        : await loadModel(record.source.asset);
    if (generation !== state.loadGeneration || !state.objects.has(record.id)) {
      disposeObject(content);
      return group;
    }
    content.userData.editorContent = true;
    group.add(content);
    group.userData.stats = record.source.kind === "collider" ? { vertices: 0, triangles: 0 } : prepareModel(content);
    await applyRecordMaterial(record, group);
    if (record.source.kind === "model") configureEditorAnimation(record, group, content);
  } catch (error) {
    console.error(error);
    group.add(createErrorPlaceholder(record));
    group.userData.error = error.message;
    toast(`${record.name}: ${error.message}`, "error", 5200);
  } finally {
    setLoading(-1);
  }

  updateViewportStats();
  if (state.selectedIds.has(record.id)) refreshSelectionVisuals();
  return group;
}

function currentRecord() {
  return state.document?.objects.find((item) => item.id === state.primaryId) || null;
}

function currentObject() {
  return state.objects.get(state.primaryId) || null;
}

function recordById(id) {
  return state.document?.objects.find((item) => item.id === id) || null;
}

function uiElementById(id) {
  return state.document?.ui?.find((item) => item.id === id) || null;
}

function selectedRecords() {
  return [...state.selectedIds].map(recordById).filter(Boolean);
}

function selectedObjects() {
  return [...state.selectedIds].map((id) => state.objects.get(id)).filter(Boolean);
}

function isDescendant(id, ancestorId) {
  let current = recordById(id);
  const visited = new Set();
  while (current?.parentId && !visited.has(current.parentId)) {
    if (current.parentId === ancestorId) return true;
    visited.add(current.parentId);
    current = recordById(current.parentId);
  }
  return false;
}

function isRecordEffectivelyLocked(record) {
  let current = record;
  const visited = new Set();
  while (current && !visited.has(current.id)) {
    if (current.locked) return true;
    visited.add(current.id);
    current = current.parentId ? recordById(current.parentId) : null;
  }
  return false;
}

function isRecordEffectivelyVisible(record) {
  if (!record || (state.isolatedIds && !state.isolatedIds.has(record.id))) return false;
  let current = record;
  const visited = new Set();
  while (current && !visited.has(current.id)) {
    if (!current.visible) return false;
    visited.add(current.id);
    current = current.parentId ? recordById(current.parentId) : null;
  }
  return record.source.kind !== "collider" || state.collidersVisible;
}

function applyEditorVisibility(record, object = state.objects.get(record.id)) {
  if (!object) return;
  object.visible = record.visible
    && (!state.isolatedIds || state.isolatedIds.has(record.id))
    && (record.source.kind !== "collider" || state.collidersVisible);
}

function refreshEditorVisibility() {
  for (const record of state.document?.objects || []) applyEditorVisibility(record);
  refreshSelectionVisuals();
}

function isolationIdsFor(rootIds) {
  const ids = new Set();
  for (const rootId of rootIds) {
    const root = recordById(rootId);
    if (!root) continue;
    ids.add(rootId);
    for (const record of state.document.objects) {
      if (isDescendant(record.id, rootId)) ids.add(record.id);
    }
    let current = root;
    const visited = new Set();
    while (current?.parentId && !visited.has(current.parentId)) {
      ids.add(current.parentId);
      visited.add(current.parentId);
      current = recordById(current.parentId);
    }
  }
  return ids;
}

function updateIsolationUi() {
  const active = Boolean(state.isolatedIds);
  const button = $("isolate-selection-button");
  button.disabled = !active && state.selectedIds.size === 0;
  button.classList.toggle("active", active);
  button.title = active ? "Sair do isolamento (/)" : "Isolar seleção (/)";
}

function setIsolation(rootIds = null) {
  if (!rootIds?.size) {
    state.isolationRoots.clear();
    state.isolatedIds = null;
    setStatus("Isolamento encerrado");
  } else {
    state.isolationRoots = new Set(rootIds);
    state.isolatedIds = isolationIdsFor(state.isolationRoots);
    setStatus(`${rootIds.size} objeto${rootIds.size === 1 ? " isolado" : "s isolados"}`);
  }
  refreshEditorVisibility();
  renderHierarchy();
  updateIsolationUi();
  setSelection(state.primaryId, { additive: true });
}

function toggleIsolation(ids = state.selectedIds) {
  if (state.isolatedIds) setIsolation(null);
  else if (ids.size) setIsolation(new Set(ids));
}

function hideSelectedObjects() {
  if (!state.selectedIds.size) return;
  const before = serializeScene();
  for (const record of selectedRecords()) {
    record.visible = false;
    applyEditorVisibility(record);
  }
  pushHistorySnapshot(before);
  updateEditorLightingRig();
  const count = state.selectedIds.size;
  setSelection(null);
  setStatus(`${count} objeto${count === 1 ? " ocultado" : "s ocultados"}`);
}

function showAllObjects() {
  const before = serializeScene();
  let changed = false;
  for (const record of state.document.objects) {
    if (!record.visible) changed = true;
    record.visible = true;
  }
  state.isolationRoots.clear();
  state.isolatedIds = null;
  refreshEditorVisibility();
  updateEditorLightingRig();
  renderHierarchy();
  updateIsolationUi();
  if (changed) pushHistorySnapshot(before);
  setStatus("Todos os objetos estão visíveis");
}

function transformSelectionIds() {
  return [...state.selectedIds].filter((id) => {
    const record = recordById(id);
    const object = state.objects.get(id);
    if (!record || !object || isRecordEffectivelyLocked(record) || !isRecordEffectivelyVisible(record)) return false;
    return ![...state.selectedIds].some((otherId) => otherId !== id && isDescendant(id, otherId));
  });
}

function selectionIdentity() {
  return [...state.selectedIds].sort().join("|");
}

function updatePivotUi() {
  $("pivot-button").classList.toggle("active", state.pivotCustom || state.pivotEditing);
  $("pivot-button").textContent = state.pivotEditing ? "Concluir" : "Pivô";
  $("pivot-reset-button").disabled = !state.pivotCustom;
}

function resetPivotForSelection() {
  state.pivotSelectionKey = selectionIdentity();
  state.pivotCustom = false;
  state.pivotEditing = false;
  if (updateSelectionBounds()) state.pivotPosition.copy(selectionBounds.getCenter(new THREE.Vector3()));
  updatePivotUi();
}

function prepareSelectionPivot(position) {
  selectionPivot.position.copy(position);
  selectionPivot.rotation.set(0, 0, 0);
  selectionPivot.scale.set(1, 1, 1);
  selectionPivot.updateMatrixWorld(true);
}

function setSelection(id, { additive = false, toggle = false } = {}) {
  if (id && state.selectedUiId) {
    state.selectedUiId = null;
    renderUiElements();
    renderUiPreview();
  }
  if (!additive) state.selectedIds.clear();
  if (id && state.objects.has(id)) {
    if (toggle && state.selectedIds.has(id)) state.selectedIds.delete(id);
    else state.selectedIds.add(id);
  }
  state.primaryId = id && state.selectedIds.has(id) ? id : [...state.selectedIds].at(-1) || null;
  if (state.pivotSelectionKey !== selectionIdentity()) resetPivotForSelection();
  transform.detach();
  selectionBox.visible = false;
  const targets = transformSelectionIds();
  if (!state.rightHandActive && !state.boxSelectTool) {
    if (state.pivotEditing && targets.length > 0) {
      prepareSelectionPivot(state.pivotPosition);
      transform.setMode("translate");
      transform.attach(selectionPivot);
    } else if (targets.length === 1 && state.selectedIds.size === 1 && !state.pivotCustom) {
      transform.setMode(state.transformMode);
      transform.attach(state.objects.get(targets[0]));
    } else if (targets.length > 0) {
      updateSelectionBounds();
      const center = state.pivotCustom ? state.pivotPosition : selectionBounds.getCenter(new THREE.Vector3());
      prepareSelectionPivot(center);
      transform.setMode(state.transformMode);
      transform.attach(selectionPivot);
    }
  }
  refreshSelectionVisuals();
  renderHierarchy();
  renderInspector();
  $("create-prefab-button").disabled = state.selectedIds.size === 0;
  updateClipboardButtons();
  updateIsolationUi();
  updatePivotUi();
}

function updateSelectionBounds() {
  selectionBounds.makeEmpty();
  for (const id of state.selectedIds) {
    const record = recordById(id);
    const object = state.objects.get(id);
    if (record && object && isRecordEffectivelyVisible(record)) selectionBounds.expandByObject(object, true);
  }
  return !selectionBounds.isEmpty();
}

function refreshSelectionVisuals() {
  selectionBox.visible = state.selectedIds.size > 0 && updateSelectionBounds();
}

function renderHierarchy() {
  const query = $("hierarchy-search").value.trim().toLocaleLowerCase("pt-BR");
  objectList.replaceChildren();
  const records = state.document?.objects || [];
  const children = new Map();
  for (const record of records) {
    const parentId = record.parentId && records.some((item) => item.id === record.parentId) ? record.parentId : null;
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(record);
  }
  const ordered = [];
  const visit = (parentId, depth) => {
    for (const record of children.get(parentId) || []) {
      ordered.push({ record, depth });
      if (!state.collapsedHierarchy.has(record.id)) visit(record.id, depth + 1);
    }
  };
  if (query) {
    for (const record of records) {
      if (record.name.toLocaleLowerCase("pt-BR").includes(query)) ordered.push({ record, depth: 0 });
    }
  } else {
    visit(null, 0);
  }

  const icons = { group: "▱", collider: "▣", primitive: "◆", model: "◇", light: "✦", camera: "▣", audio: "♪", particle: "⁙", shadow: "◒", spawn: "⌖" };
  for (const { record, depth } of ordered) {
    if (query && !record.name.toLocaleLowerCase("pt-BR").includes(query)) continue;
    const hasChildren = (children.get(record.id) || []).length > 0;
    const collapsed = state.collapsedHierarchy.has(record.id);
    const row = document.createElement("div");
    row.className = `object-row${state.selectedIds.has(record.id) ? " selected" : ""}${record.visible ? "" : " hidden-object"}${isRecordEffectivelyLocked(record) ? " locked-object" : ""}${state.isolationRoots.has(record.id) ? " isolated-object" : ""}${state.isolatedIds && !state.isolatedIds.has(record.id) ? " isolation-hidden" : ""}`;
    row.dataset.id = record.id;
    row.draggable = !isRecordEffectivelyLocked(record);
    row.style.setProperty("--depth", depth);
    row.setAttribute("role", "treeitem");
    if (hasChildren) row.setAttribute("aria-expanded", String(!collapsed));
    row.innerHTML = `
      <button class="tree-toggle${hasChildren ? "" : " empty"}" title="${collapsed ? "Expandir" : "Recolher"}" ${hasChildren ? "" : "disabled"}>${hasChildren ? (collapsed ? "▸" : "▾") : ""}</button>
      <span class="object-icon">${icons[record.source.kind] || "◇"}</span>
      <span class="object-name"></span>
      <button class="visibility-button" title="${record.visible ? "Ocultar" : "Mostrar"}">${record.visible ? "◉" : "○"}</button>
      <button class="lock-button" title="${record.locked ? "Desbloquear" : "Bloquear"}">${record.locked ? "▣" : "□"}</button>
      <button class="isolate-button${state.isolationRoots.has(record.id) ? " active" : ""}" title="${state.isolationRoots.has(record.id) ? "Sair do isolamento" : "Isolar objeto"}">◎</button>
    `;
    row.querySelector(".object-name").textContent = record.name;
    row.querySelector(".tree-toggle").addEventListener("click", (event) => {
      event.stopPropagation();
      if (!hasChildren) return;
      if (collapsed) state.collapsedHierarchy.delete(record.id);
      else state.collapsedHierarchy.add(record.id);
      saveLayoutState();
      renderHierarchy();
    });
    row.addEventListener("click", (event) => setSelection(record.id, {
      additive: event.ctrlKey || event.metaKey || event.shiftKey,
      toggle: event.ctrlKey || event.metaKey,
    }));
    row.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/athena-object", record.id);
      event.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragover", (event) => {
      if (!event.dataTransfer.types.includes("text/athena-object")) return;
      event.preventDefault();
      row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", (event) => {
      row.classList.remove("drag-over");
      const childId = event.dataTransfer.getData("text/athena-object");
      if (!childId) return;
      event.preventDefault();
      setParent(childId, record.id);
    });
    row.querySelector(".visibility-button").addEventListener("click", (event) => {
      event.stopPropagation();
      const before = serializeScene();
      record.visible = !record.visible;
      applyEditorVisibility(record);
      if (record.source.kind === "light") updateEditorLightingRig();
      pushHistorySnapshot(before);
      setSelection(record.id);
    });
    row.querySelector(".lock-button").addEventListener("click", (event) => {
      event.stopPropagation();
      const before = serializeScene();
      record.locked = !record.locked;
      pushHistorySnapshot(before);
      setSelection(record.id);
    });
    row.querySelector(".isolate-button").addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.isolationRoots.has(record.id)) setIsolation(null);
      else {
        setSelection(record.id);
        setIsolation(new Set([record.id]));
      }
    });
    objectList.append(row);
  }
  $("empty-hint").hidden = records.length !== 0;
}

function currentUiElement() {
  return state.document?.ui?.find((item) => item.id === state.selectedUiId) || null;
}

function renderUiElements() {
  const list = $("ui-element-list");
  list.replaceChildren();
  for (const item of state.document?.ui || []) {
    const row = document.createElement("div");
    row.className = `ui-element-row${item.id === state.selectedUiId ? " selected" : ""}`;
    row.innerHTML = `<span>${({ panel: "▰", text: "T", image: "▧", video: "▶" })[item.type] || "T"}</span><strong></strong><button title="${item.visible ? "Ocultar" : "Mostrar"}">${item.visible ? "◉" : "○"}</button>`;
    row.querySelector("strong").textContent = item.name;
    row.addEventListener("click", () => {
      setUiMode(true);
      selectUiElement(item.id);
    });
    row.querySelector("button").addEventListener("click", (event) => {
      event.stopPropagation();
      const before = serializeScene();
      item.visible = !item.visible;
      pushHistorySnapshot(before);
      renderUiElements();
      renderUiPreview();
    });
    list.append(row);
  }
}

function applyUiPreviewStyle(node, item) {
  node.style.left = `${item.x / 6.4}%`;
  node.style.top = `${item.y / 4.48}%`;
  node.style.width = `${item.width / 6.4}%`;
  node.style.height = `${item.height / 4.48}%`;
  node.style.setProperty("--ui-background", item.background);
  node.style.setProperty("--ui-opacity", item.opacity);
  node.style.setProperty("--ui-color", item.color);
  node.style.setProperty("--ui-font-scale", item.fontScale);
  node.classList.toggle("align-center", item.align === "center");
  node.classList.toggle("align-right", item.align === "right");
  node.hidden = !item.visible;
  if (item.type === "text") node.firstChild.textContent = item.text;
  if (item.type === "image") {
    node.style.backgroundImage = item.asset ? `url("/assets/${item.asset.split("/").map(encodeURIComponent).join("/")}")` : "none";
  }
}

function beginUiPointerEdit(event, item, node, resizing) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  if (state.selectedUiId !== item.id) {
    state.selectedUiId = item.id;
    state.selectedIds.clear();
    state.primaryId = null;
    transform.detach();
    selectionBox.visible = false;
    node.classList.add("selected");
    renderHierarchy();
    renderUiElements();
    renderInspector();
  }
  const before = serializeScene();
  const start = { x: event.clientX, y: event.clientY, item: deepClone(item) };
  const canvasRect = $("ui-canvas").getBoundingClientRect();
  node.setPointerCapture?.(event.pointerId);
  const move = (moveEvent) => {
    const deltaX = (moveEvent.clientX - start.x) * 640 / Math.max(1, canvasRect.width);
    const deltaY = (moveEvent.clientY - start.y) * 448 / Math.max(1, canvasRect.height);
    if (resizing) {
      item.width = cleanNumber(THREE.MathUtils.clamp(start.item.width + deltaX, 1, 640 - item.x));
      item.height = cleanNumber(THREE.MathUtils.clamp(start.item.height + deltaY, 1, 448 - item.y));
    } else {
      item.x = cleanNumber(THREE.MathUtils.clamp(start.item.x + deltaX, 0, 640 - item.width));
      item.y = cleanNumber(THREE.MathUtils.clamp(start.item.y + deltaY, 0, 448 - item.height));
    }
    applyUiPreviewStyle(node, item);
    renderUiInspector(item);
    markDirty();
  };
  const finish = (upEvent) => {
    node.releasePointerCapture?.(upEvent.pointerId);
    node.removeEventListener("pointermove", move);
    node.removeEventListener("pointerup", finish);
    node.removeEventListener("pointercancel", finish);
    pushHistorySnapshot(before);
    renderUiPreview();
  };
  node.addEventListener("pointermove", move);
  node.addEventListener("pointerup", finish);
  node.addEventListener("pointercancel", finish);
}

function renderUiPreview() {
  const canvas = $("ui-canvas");
  canvas.replaceChildren();
  canvas.style.background = state.document?.settings?.background || "#07101d";
  for (const item of state.document?.ui || []) {
    const node = document.createElement("div");
    node.className = `ui-preview-element ${item.type}${item.id === state.selectedUiId ? " selected" : ""}`;
    node.dataset.uiId = item.id;
    if (item.type === "text") node.append(document.createTextNode(item.text));
    if (item.type === "video") {
      const placeholder = document.createElement("span");
      placeholder.className = "ui-video-placeholder";
      placeholder.textContent = item.asset ? `MPEG · ${fileName(item.asset)}` : "Selecione um vídeo MPEG";
      node.append(placeholder);
    }
    applyUiPreviewStyle(node, item);
    node.addEventListener("pointerdown", (event) => beginUiPointerEdit(event, item, node, event.target.classList.contains("ui-resize-handle")));
    if (item.id === state.selectedUiId) {
      const handle = document.createElement("span");
      handle.className = "ui-resize-handle";
      node.append(handle);
    }
    canvas.append(node);
  }
  canvas.onpointerdown = (event) => {
    if (event.target === canvas) selectUiElement(null);
  };
}

function selectUiElement(id) {
  state.selectedUiId = state.document?.ui?.some((item) => item.id === id) ? id : null;
  state.selectedIds.clear();
  state.primaryId = null;
  transform.detach();
  selectionBox.visible = false;
  renderHierarchy();
  renderUiElements();
  renderUiPreview();
  renderInspector();
}

function setUiMode(active) {
  if (active && state.logicMode) setLogicMode(false);
  state.uiMode = Boolean(active);
  $("ui-editor").hidden = !state.uiMode;
  viewport.classList.toggle("ui-mode", state.uiMode);
  $("ui-mode-button").classList.toggle("active", state.uiMode);
  $("open-ui-editor-button").textContent = state.uiMode ? "Fechar" : "Editar";
  orbit.enabled = !state.uiMode && !state.logicMode;
  transformHelper.visible = !state.uiMode && !state.logicMode;
  if (state.uiMode) {
    setSelection(null);
    renderUiPreview();
    setStatus("Editor de interface · 640 × 448");
  } else {
    state.selectedUiId = null;
    renderUiElements();
    renderInspector();
    setStatus(`${state.document?.name || "Cena"} · modo 3D`);
  }
}

function addUiElement(type) {
  const before = serializeScene();
  const media = type === "image" || type === "video";
  const defaultAsset = type === "image" ? (state.textures[0]?.path || "") : type === "video" ? (state.videoFiles[0]?.path || "") : "";
  const item = normalizeUiElement({
    id: uid("ui"),
    name: ({ panel: "Novo painel", text: "Novo texto", image: "Nova imagem", video: "Novo vídeo" })[type] || "Novo elemento",
    type,
    x: type === "panel" ? 200 : media ? 224 : 180,
    y: type === "panel" ? 174 : media ? 170 : 200,
    width: type === "panel" ? 240 : media ? 192 : 280,
    height: type === "panel" ? 72 : media ? 108 : 32,
    text: type === "text" ? "Novo texto" : "",
    asset: defaultAsset,
    autoplay: type === "video",
    loop: type === "video",
  });
  state.document.ui.push(item);
  pushHistorySnapshot(before);
  setUiMode(true);
  selectUiElement(item.id);
  updateViewportStats();
  setStatus(`${item.name} adicionado à interface`);
}

function duplicateUiElement() {
  const item = currentUiElement();
  if (!item) return;
  const before = serializeScene();
  const copy = normalizeUiElement({ ...deepClone(item), id: uid("ui"), name: `${item.name} — cópia`, x: item.x + 12, y: item.y + 12 });
  state.document.ui.push(copy);
  pushHistorySnapshot(before);
  selectUiElement(copy.id);
  updateViewportStats();
}

function deleteUiElement() {
  const item = currentUiElement();
  if (!item) return;
  const before = serializeScene();
  state.document.ui = state.document.ui.filter((candidate) => candidate.id !== item.id);
  state.selectedUiId = null;
  pushHistorySnapshot(before);
  renderUiElements();
  renderUiPreview();
  renderInspector();
  updateViewportStats();
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderAssets() {
  const query = $("asset-search").value.trim().toLocaleLowerCase("pt-BR");
  assetList.replaceChildren();
  const models = state.assets.filter((asset) => !query || asset.path.toLocaleLowerCase("pt-BR").includes(query));
  for (const asset of models) {
    const row = document.createElement("div");
    row.className = "asset-row";
    row.innerHTML = `
      <span class="asset-badge">${asset.extension.slice(1).toUpperCase()}</span>
      <span class="asset-info"><strong></strong><small></small></span>
      <button title="Adicionar à cena">＋</button>
    `;
    row.querySelector("strong").textContent = asset.name;
    row.querySelector("small").textContent = `${asset.path} · ${formatBytes(asset.size)}`;
    row.querySelector("button").addEventListener("click", () => addAssetToScene(asset.path));
    row.addEventListener("dblclick", () => addAssetToScene(asset.path));
    assetList.append(row);
  }
}

function renderPrefabs() {
  const list = $("prefab-list");
  list.replaceChildren();
  if (!state.prefabs.length) {
    const empty = document.createElement("div");
    empty.className = "prefab-empty";
    empty.textContent = "Selecione objetos e use “Da seleção” para criar um prefab.";
    list.append(empty);
    return;
  }
  for (const prefab of state.prefabs) {
    const row = document.createElement("div");
    row.className = "prefab-row";
    row.innerHTML = `
      <span class="asset-badge">PF</span>
      <span class="asset-info"><strong></strong><small></small></span>
      <button class="prefab-add" title="Instanciar prefab">＋</button>
      <button class="prefab-delete" title="Excluir prefab">×</button>
    `;
    row.querySelector("strong").textContent = prefab.name;
    row.querySelector("small").textContent = `${prefab.objects?.length || 0} objeto(s)`;
    row.querySelector(".prefab-add").addEventListener("click", () => instantiatePrefab(prefab));
    row.querySelector(".prefab-delete").addEventListener("click", () => deletePrefab(prefab));
    row.addEventListener("dblclick", () => instantiatePrefab(prefab));
    list.append(row);
  }
}

function setVectorInputs(prefix, vector) {
  $(`${prefix}-x`).value = cleanNumber(vector.x);
  $(`${prefix}-y`).value = cleanNumber(vector.y);
  $(`${prefix}-z`).value = cleanNumber(vector.z);
}

function renderMaterialTextureOptions(record) {
  const select = $("material-texture");
  select.replaceChildren(new Option("Material original", ""));
  for (const texture of state.textures) select.append(new Option(texture.path, texture.path));
  if (record.material?.texture && !state.textures.some((texture) => texture.path === record.material.texture)) {
    select.append(new Option(record.material.texture, record.material.texture));
  }
  select.value = record.material?.texture || "";
}

function renderAudioAssetOptions(record) {
  const select = $("audio-asset");
  select.replaceChildren(new Option("Selecione um áudio", ""));
  for (const asset of state.audioFiles) select.append(new Option(asset.path, asset.path));
  if (record.source.asset && !state.audioFiles.some((asset) => asset.path === record.source.asset)) {
    select.append(new Option(record.source.asset, record.source.asset));
  }
  select.value = record.source.asset || "";
}

function renderAnimationClipOptions(record, object = state.objects.get(record.id)) {
  const select = $("animation-clip");
  const clips = object?.userData.animationClips || [];
  select.replaceChildren(new Option(clips.length ? "Primeira animação" : "Nenhuma animação encontrada", ""));
  for (const clip of clips) select.append(new Option(clip.name || `Animação ${select.options.length}`, clip.name || ""));
  if (record.animation?.clip && !clips.some((clip) => clip.name === record.animation.clip)) {
    select.append(new Option(record.animation.clip, record.animation.clip));
  }
  select.value = record.animation?.clip || "";
}

function renderShadowTextureOptions(record) {
  const select = $("shadow-texture");
  select.replaceChildren(new Option("Selecione uma textura", ""));
  for (const texture of state.textures) select.append(new Option(texture.path, texture.path));
  if (record.source.asset && !state.textures.some((texture) => texture.path === record.source.asset)) {
    select.append(new Option(record.source.asset, record.source.asset));
  }
  select.value = record.source.asset || "";
}

function renderUiMediaAssetOptions(item) {
  const select = $("ui-media-asset");
  const assets = item.type === "video" ? state.videoFiles : state.textures;
  select.replaceChildren(new Option(item.type === "video" ? "Selecione um MPEG" : "Selecione uma imagem", ""));
  for (const asset of assets) select.append(new Option(asset.path, asset.path));
  if (item.asset && !assets.some((asset) => asset.path === item.asset)) select.append(new Option(item.asset, item.asset));
  select.value = item.asset || "";
}

function renderUiFontOptions(item) {
  const select = $("ui-font-asset");
  select.replaceChildren(new Option("Fonte padrão do Athena", ""));
  for (const asset of state.fontFiles) select.append(new Option(asset.path, asset.path));
  if (item.fontAsset && !state.fontFiles.some((asset) => asset.path === item.fontAsset)) {
    select.append(new Option(item.fontAsset, item.fontAsset));
  }
  select.value = item.fontAsset || "";
}

function eventPhaseLabel(phase) {
  return { onEnter: "Entrar", onExit: "Sair", onInteract: "Interagir" }[phase] || phase;
}

function projectSpawnPoints(sceneId) {
  if (sceneId === state.activeSceneId) {
    return (state.document?.objects || [])
      .filter((record) => record.source.kind === "spawn" && record.runtime && record.visible)
      .map((record) => ({ id: record.id, name: record.name, default: record.spawn?.default === true }));
  }
  return state.scenes.find((entry) => entry.id === sceneId)?.spawnPoints || [];
}

function fillProjectSceneSelect(select, value, emptyLabel = "Selecione uma cena") {
  select.replaceChildren(new Option(emptyLabel, ""));
  for (const entry of state.scenes) select.append(new Option(entry.name, entry.id));
  if (value && !state.scenes.some((entry) => entry.id === value)) select.append(new Option(`${value} · ausente`, value));
  select.value = value || "";
}

function fillProjectSpawnSelect(select, sceneId, value) {
  const points = projectSpawnPoints(sceneId);
  select.replaceChildren(new Option(points.length ? "Entrada padrão da cena" : "Cena sem pontos de entrada", ""));
  for (const point of points) select.append(new Option(`${point.default ? "★ " : ""}${point.name}`, point.id));
  if (value && !points.some((point) => point.id === value)) select.append(new Option(`${value} · ausente`, value));
  select.value = value || "";
  select.disabled = !sceneId || points.length === 0;
}

function fillPortalVariableSelect(select, value) {
  select.replaceChildren(new Option(state.globalVariables.length ? "Selecione uma variável" : "Crie uma variável no modo LOGIC", ""));
  for (const variable of state.globalVariables) select.append(new Option(variable.name, variable.id));
  if (value && !state.globalVariables.some((variable) => variable.id === value)) {
    select.append(new Option(`${value} · ausente`, value));
  }
  select.value = value || "";
  select.disabled = state.globalVariables.length === 0;
}

function renderPortalConditionValue(condition) {
  const input = $("portal-condition-value");
  const variable = state.globalVariables.find((item) => item.id === condition.variableId);
  input.disabled = !variable;
  input.type = variable?.type === "boolean" ? "checkbox" : variable?.type === "number" ? "number" : "text";
  if (variable?.type === "boolean") input.checked = condition.value === true;
  else input.value = condition.value === undefined || condition.value === null ? "" : String(condition.value);
}

function renderPortalEditor(record) {
  const container = $("portal-editor");
  container.hidden = record.source.kind !== "collider";
  if (container.hidden) return;
  record.portal ||= normalizeRecord({ source: { kind: "collider", collider: record.source.collider } }).portal;
  $("portal-enabled").checked = record.portal.enabled;
  fillProjectSceneSelect($("portal-scene"), record.portal.targetSceneId);
  fillProjectSpawnSelect($("portal-spawn"), record.portal.targetSceneId, record.portal.targetSpawnId);
  $("portal-activation").value = record.portal.activation;
  $("portal-fade").value = record.portal.fadeFrames;
  record.portal.condition ||= { enabled: false, variableId: "", operator: "eq", value: false };
  $("portal-condition-enabled").checked = record.portal.condition.enabled;
  fillPortalVariableSelect($("portal-condition-variable"), record.portal.condition.variableId);
  $("portal-condition-operator").value = record.portal.condition.operator;
  $("portal-condition-fields").hidden = !record.portal.condition.enabled;
  renderPortalConditionValue(record.portal.condition);
  const target = state.scenes.find((entry) => entry.id === record.portal.targetSceneId);
  const baseNote = !record.portal.enabled
    ? "Ative o portal para carregar outra cena por este trigger."
    : !target
      ? "Escolha uma cena de destino existente."
      : projectSpawnPoints(target.id).length
        ? "Somente a cena de destino ficará carregada após o fade."
        : "A cena não possui entrada; será usado o spawn configurado no Runtime.";
  const conditionVariable = state.globalVariables.find((item) => item.id === record.portal.condition.variableId);
  $("portal-note").textContent = record.portal.condition.enabled
    ? `${baseNote} ${conditionVariable ? `Condição: ${conditionVariable.name}.` : "Escolha uma variável global para a condição."}`
    : baseNote;
}

function renderCheckpointEditor(record) {
  const container = $("checkpoint-editor");
  container.hidden = record.source.kind !== "collider";
  if (container.hidden) return;
  record.checkpoint ||= { enabled: false, activation: "onEnter", autosave: true };
  $("checkpoint-enabled").checked = record.checkpoint.enabled;
  $("checkpoint-activation").value = record.checkpoint.activation;
  $("checkpoint-autosave").checked = record.checkpoint.autosave !== false;
  $("checkpoint-note").textContent = !record.checkpoint.enabled
    ? "Ative o componente para registrar a cena, a posição e o estado persistente."
    : record.checkpoint.autosave !== false
      ? "Ao ativar, o progresso será gravado no Memory Card do slot 1."
      : "O checkpoint ficará disponível somente durante a sessão atual.";
}

function eventActionSummary(action) {
  if (action.type === "message") return action.text;
  if (action.type === "save") return "Salvar progresso no Memory Card";
  if (action.type === "load") return "Carregar último save";
  if (action.type === "teleport") return `Jogador → ${action.position.x}, ${action.position.y}, ${action.position.z}`;
  if (action.type === "scene") {
    const sceneName = state.scenes.find((entry) => entry.id === action.sceneId)?.name || action.sceneId || "Sem cena";
    const spawnName = projectSpawnPoints(action.sceneId).find((entry) => entry.id === action.spawnId)?.name;
    return `${sceneName}${spawnName ? ` → ${spawnName}` : ""} · fade ${action.fadeFrames}`;
  }
  const target = recordById(action.targetId)?.name || uiElementById(action.targetId)?.name || action.targetId || "Sem alvo";
  if (action.type === "audio") return `${action.mode === "stop" ? "Parar" : "Tocar"}: ${target}`;
  if (action.type === "particle") return `${{ start: "Iniciar", stop: "Parar", burst: "Explodir" }[action.mode] || action.mode}: ${target}`;
  if (action.type === "video") return `${{ play: "Tocar", pause: "Pausar", stop: "Parar" }[action.mode] || action.mode}: ${target}`;
  const mode = { toggle: "Alternar", show: "Mostrar", hide: "Ocultar" }[action.mode] || action.mode;
  return `${mode}: ${target}`;
}

function updateEventDraftUi() {
  const type = $("event-action-type").value;
  $("event-message-row").hidden = type !== "message";
  $("event-duration-row").hidden = type !== "message";
  const targetKind = type === "audio" ? "audio" : type === "particle" ? "particle" : type === "video" ? "video" : null;
  $("event-target-row").hidden = type !== "visibility" && !targetKind;
  $("event-visibility-row").hidden = type !== "visibility";
  $("event-effect-mode-row").hidden = !targetKind;
  $("event-teleport-row").hidden = type !== "teleport";
  $("event-scene-row").hidden = type !== "scene";
  $("event-spawn-row").hidden = type !== "scene";
  $("event-fade-row").hidden = type !== "scene";
  if (type === "scene") {
    const previousScene = $("event-scene").value;
    const previousSpawn = $("event-spawn").value;
    fillProjectSceneSelect($("event-scene"), previousScene);
    fillProjectSpawnSelect($("event-spawn"), previousScene, previousSpawn);
  }
  const targetSelect = $("event-target");
  const previousTarget = targetSelect.value;
  targetSelect.replaceChildren(new Option(targetKind ? "Selecione um componente" : "Selecione um objeto", ""));
  if (targetKind === "video") {
    for (const candidate of state.document.ui) {
      if (candidate.type === "video") targetSelect.append(new Option(candidate.name, candidate.id));
    }
  } else {
    for (const candidate of state.document.objects) {
      const accepted = targetKind
        ? candidate.source.kind === targetKind
        : ["model", "primitive", "group"].includes(candidate.source.kind);
      if (accepted) targetSelect.append(new Option(candidate.name, candidate.id));
    }
  }
  if ([...targetSelect.options].some((option) => option.value === previousTarget)) targetSelect.value = previousTarget;
  $("event-target-label").textContent = targetKind === "audio" ? "Fonte de áudio" : targetKind === "particle" ? "Emissor" : targetKind === "video" ? "Vídeo de UI" : "Objeto";
  $("event-target-help").textContent = targetKind ? "Componente executado no jogo" : "Alvo da ação";
  const modeSelect = $("event-effect-mode");
  modeSelect.replaceChildren();
  if (type === "audio") {
    modeSelect.append(new Option("Tocar", "play"), new Option("Parar", "stop"));
  } else if (type === "particle") {
    modeSelect.append(new Option("Explosão única", "burst"), new Option("Iniciar emissão", "start"), new Option("Parar emissão", "stop"));
  } else if (type === "video") {
    modeSelect.append(new Option("Tocar", "play"), new Option("Pausar", "pause"), new Option("Parar e rebobinar", "stop"));
  }
}

function removeTriggerAction(recordId, phase, actionId) {
  const record = recordById(recordId);
  if (!record?.events?.[phase]) return;
  const before = serializeScene();
  record.events[phase] = record.events[phase].filter((action) => action.id !== actionId);
  pushHistorySnapshot(before);
  renderInspector();
  setStatus("Ação removida do trigger");
}

function renderTriggerEvents(record) {
  const container = $("trigger-events-editor");
  container.hidden = record.collider?.trigger !== true;
  if (container.hidden) return;
  record.events ||= normalizeRecordEvents();

  const list = $("event-action-list");
  list.replaceChildren();
  let count = 0;
  for (const phase of eventPhases) {
    for (const action of record.events[phase]) {
      count++;
      const row = document.createElement("div");
      row.className = "event-action-item";
      const phaseLabel = document.createElement("em");
      phaseLabel.textContent = eventPhaseLabel(phase);
      const summary = document.createElement("span");
      summary.textContent = eventActionSummary(action);
      summary.title = summary.textContent;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.title = "Remover ação";
      remove.addEventListener("click", () => removeTriggerAction(record.id, phase, action.id));
      row.append(phaseLabel, summary, remove);
      list.append(row);
    }
  }
  if (!count) {
    const empty = document.createElement("div");
    empty.className = "event-action-empty";
    empty.textContent = "Nenhuma ação configurada";
    list.append(empty);
  }
  $("event-convert-logic-button").disabled = count === 0;
  updateEventDraftUi();
}

function addTriggerAction() {
  const record = currentRecord();
  if (!record?.collider?.trigger) return;
  const phase = $("event-when").value;
  const type = $("event-action-type").value;
  let action;
  if (["visibility", "audio", "particle", "video"].includes(type)) {
    const targetId = $("event-target").value;
    if (!targetId) {
      toast("Selecione o alvo que receberá a ação.", "error");
      return;
    }
    action = {
      type,
      targetId,
      mode: type === "visibility" ? $("event-visibility-mode").value : $("event-effect-mode").value,
    };
  } else if (type === "teleport") {
    action = {
      type,
      position: {
        x: clampNumber($("event-teleport-x").value),
        y: clampNumber($("event-teleport-y").value, 0.08),
        z: clampNumber($("event-teleport-z").value, 18),
      },
    };
  } else if (type === "scene") {
    const sceneId = $("event-scene").value;
    if (!sceneId) {
      toast("Selecione a cena de destino.", "error");
      return;
    }
    action = {
      type,
      sceneId,
      spawnId: $("event-spawn").value,
      fadeFrames: clampNumber($("event-fade").value, 30),
    };
  } else if (type === "save" || type === "load") {
    action = { type };
  } else {
    action = {
      type: "message",
      text: $("event-message").value.trim() || "Uma passagem foi encontrada.",
      duration: clampNumber($("event-duration").value, 180),
    };
  }
  const before = serializeScene();
  record.events ||= normalizeRecordEvents();
  record.events[phase].push(normalizeEventAction(action));
  pushHistorySnapshot(before);
  renderInspector();
  setStatus(`Ação adicionada: ${eventPhaseLabel(phase)}`);
}

function currentLogicGraph() {
  return state.document?.logic?.graphs?.find((graph) => graph.id === state.selectedLogicGraphId) || null;
}

function currentLogicNode() {
  return currentLogicGraph()?.nodes.find((node) => node.id === state.selectedLogicNodeId) || null;
}

function renderLogicSummary() {
  const graphs = state.document?.logic?.graphs || [];
  const variables = state.document?.logic?.variables || [];
  const nodes = graphs.reduce((total, graph) => total + graph.nodes.length, 0);
  $("logic-summary").textContent = graphs.length
    ? `${graphs.length} fluxo${graphs.length === 1 ? "" : "s"} · ${nodes} nó${nodes === 1 ? "" : "s"} · ${variables.length} ${variables.length === 1 ? "variável" : "variáveis"}`
    : "Nenhum fluxo configurado";
}

function logicCategoryLabel(category) {
  return { event: "Eventos", condition: "Condições", action: "Ações", variable: "Variáveis", flow: "Fluxo" }[category] || category;
}

function logicTargetName(id) {
  return recordById(id)?.name || uiElementById(id)?.name || id || "Sem alvo";
}

function logicNodeSummary(node) {
  const config = node.config || {};
  if (node.type === "eventStart") return "Executa uma vez ao iniciar o jogo";
  if (node.type === "eventTrigger") return `${eventPhaseLabel(config.phase)} · ${logicTargetName(config.triggerId)}`;
  if (node.type === "eventInput") return `Pad.${config.button}`;
  if (node.type === "eventTimer") return `${config.intervalFrames} quadros${config.repeat ? " · repetir" : ""}`;
  if (node.type === "eventPlayerJump") return "Dispara somente quando um pulo começa";
  if (node.type === "conditionVariable") {
    const variable = state.document.logic.variables.find((item) => item.id === config.variableId);
    return `${variable?.name || "Variável"} ${{ eq: "=", neq: "≠", gt: ">", gte: "≥", lt: "<", lte: "≤" }[config.operator]} ${String(config.value)}`;
  }
  if (node.type === "actionMessage") return config.text;
  if (node.type === "actionDisplayVariable") {
    const variable = state.document.logic.variables.find((item) => item.id === config.variableId);
    return `${config.prefix}${variable?.name || "Variável"}`;
  }
  if (node.type === "actionVisibility") return `${config.mode} · ${logicTargetName(config.targetId)}`;
  if (node.type === "actionTeleport") return `${config.position.x}, ${config.position.y}, ${config.position.z}`;
  if (["actionAudio", "actionParticle", "actionVideo"].includes(node.type)) return `${config.mode} · ${logicTargetName(config.targetId)}`;
  if (node.type === "actionSaveGame") return "Grava o checkpoint atual no Memory Card";
  if (node.type === "actionLoadGame") return "Restaura o último save válido";
  if (node.type === "actionScene") {
    const scene = state.scenes.find((entry) => entry.id === config.sceneId);
    const spawn = projectSpawnPoints(config.sceneId).find((entry) => entry.id === config.spawnId);
    return `${scene?.name || config.sceneId || "Sem cena"}${spawn ? ` → ${spawn.name}` : ""} · fade ${config.fadeFrames}`;
  }
  if (node.type === "actionSetVariable") {
    const variable = state.document.logic.variables.find((item) => item.id === config.variableId);
    return `${variable?.name || "Variável"} · ${config.operation}`;
  }
  if (node.type === "flowDelay") return `${config.frames} quadros`;
  return "";
}

function logicCommit(mutator, message) {
  if (!state.document) return;
  const before = serializeScene();
  mutator();
  state.document.logic = normalizeLogic(state.document.logic, uid);
  syncGlobalVariablesFromDocument();
  pushHistorySnapshot(before);
  renderLogicSummary();
  renderLogicEditor();
  if (message) setStatus(message);
}

function syncGlobalVariablesFromDocument() {
  if (!state.document) return;
  state.globalVariables = state.document.logic.variables.map((variable) => ({ ...variable }));
}

function renderLogicPalette() {
  const palette = $("logic-node-palette");
  palette.replaceChildren();
  for (const category of ["event", "condition", "action", "variable", "flow"]) {
    const group = document.createElement("div");
    group.className = "logic-palette-group";
    const heading = document.createElement("strong");
    heading.textContent = logicCategoryLabel(category);
    group.append(heading);
    for (const [type, definition] of Object.entries(LOGIC_NODE_DEFINITIONS)) {
      if (definition.category !== category) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "logic-palette-button";
      button.dataset.logicNodeType = type;
      button.textContent = definition.label;
      button.disabled = !currentLogicGraph();
      button.addEventListener("click", () => addLogicNode(type));
      group.append(button);
    }
    palette.append(group);
  }
}

function renderLogicLinks() {
  const graph = currentLogicGraph();
  const svg = $("logic-links");
  svg.replaceChildren();
  if (!graph || $("logic-editor").hidden) return;
  const canvasRect = $("logic-canvas").getBoundingClientRect();
  for (const link of graph.links) {
    const output = document.querySelector(`[data-logic-output-node="${link.from}"][data-logic-output-port="${link.fromPort}"]`);
    const input = document.querySelector(`[data-logic-input-node="${link.to}"]`);
    if (!output || !input) continue;
    const fromRect = output.getBoundingClientRect();
    const toRect = input.getBoundingClientRect();
    const x1 = fromRect.right - canvasRect.left;
    const y1 = fromRect.top + fromRect.height * 0.5 - canvasRect.top;
    const x2 = toRect.left - canvasRect.left;
    const y2 = toRect.top + toRect.height * 0.5 - canvasRect.top;
    const curve = Math.max(50, Math.abs(x2 - x1) * 0.45);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`);
    path.setAttribute("class", `logic-link ${link.fromPort}`);
    svg.append(path);
  }
}

function beginLogicNodeDrag(event, node, element) {
  if (event.button !== 0 || event.target.closest("button")) return;
  event.preventDefault();
  state.selectedLogicNodeId = node.id;
  renderLogicProperties();
  element.classList.add("selected");
  const before = serializeScene();
  const start = { x: event.clientX, y: event.clientY, nodeX: node.x, nodeY: node.y };
  const move = (moveEvent) => {
    node.x = Math.max(0, Math.min(3810, cleanNumber(start.nodeX + moveEvent.clientX - start.x)));
    node.y = Math.max(0, Math.min(2920, cleanNumber(start.nodeY + moveEvent.clientY - start.y)));
    element.style.left = `${node.x}px`;
    element.style.top = `${node.y}px`;
    renderLogicLinks();
    markDirty();
  };
  const finish = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    pushHistorySnapshot(before);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
}

function startLogicConnection(nodeId, port) {
  if (state.logicConnecting?.nodeId === nodeId && state.logicConnecting?.port === port) state.logicConnecting = null;
  else state.logicConnecting = { nodeId, port };
  renderLogicNodes();
  $("logic-cancel-connection-button").hidden = !state.logicConnecting;
  $("logic-connection-hint").textContent = state.logicConnecting
    ? "Agora clique na entrada do nó de destino."
    : "Clique em uma saída e depois na entrada de outro nó para conectar.";
  setStatus(state.logicConnecting ? "Saída selecionada · escolha o nó de destino" : "Conexão cancelada");
}

function finishLogicConnection(targetId) {
  const graph = currentLogicGraph();
  const source = state.logicConnecting;
  if (!graph || !source) {
    setStatus("Selecione primeiro uma saída do grafo");
    return;
  }
  const duplicate = graph.links.some((link) => link.from === source.nodeId && link.fromPort === source.port && link.to === targetId);
  if (!duplicate) logicCommit(() => graph.links.push({ id: uid("link"), from: source.nodeId, fromPort: source.port, to: targetId }), "Nós conectados");
  state.logicConnecting = null;
  $("logic-cancel-connection-button").hidden = true;
  $("logic-connection-hint").textContent = "Clique em uma saída e depois na entrada de outro nó para conectar.";
  renderLogicNodes();
}

function renderLogicNodes() {
  const container = $("logic-nodes");
  container.replaceChildren();
  const graph = currentLogicGraph();
  if (!graph) {
    requestAnimationFrame(renderLogicLinks);
    return;
  }
  for (const node of graph.nodes) {
    const definition = LOGIC_NODE_DEFINITIONS[node.type];
    const element = document.createElement("article");
    element.className = `logic-node ${definition.category}${node.id === state.selectedLogicNodeId ? " selected" : ""}`;
    element.style.left = `${node.x}px`;
    element.style.top = `${node.y}px`;
    element.dataset.logicNodeId = node.id;
    element.dataset.logicNodeType = node.type;

    const header = document.createElement("div");
    header.className = "logic-node-header";
    const title = document.createElement("strong");
    title.textContent = definition.label;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.title = "Excluir nó";
    remove.addEventListener("click", (event) => { event.stopPropagation(); deleteLogicNode(node.id); });
    header.append(title, remove);
    header.addEventListener("pointerdown", (event) => beginLogicNodeDrag(event, node, element));

    const summary = document.createElement("div");
    summary.className = "logic-node-summary";
    summary.textContent = logicNodeSummary(node);
    summary.title = summary.textContent;
    const ports = document.createElement("div");
    ports.className = "logic-ports";
    if (definition.inputs.length) {
      const input = document.createElement("button");
      input.type = "button";
      input.className = "logic-input-port";
      input.textContent = "entrada";
      input.dataset.logicInputNode = node.id;
      input.addEventListener("click", (event) => { event.stopPropagation(); finishLogicConnection(node.id); });
      ports.append(input);
    }
    const outputs = document.createElement("div");
    outputs.className = "logic-output-list";
    for (const port of definition.outputs) {
      const output = document.createElement("button");
      output.type = "button";
      output.className = `logic-output-port ${port}${state.logicConnecting?.nodeId === node.id && state.logicConnecting?.port === port ? " connecting" : ""}`;
      output.textContent = { next: "saída", true: "sim", false: "não" }[port] || port;
      output.dataset.logicOutputNode = node.id;
      output.dataset.logicOutputPort = port;
      output.addEventListener("click", (event) => { event.stopPropagation(); startLogicConnection(node.id, port); });
      outputs.append(output);
    }
    ports.append(outputs);
    element.append(header, summary, ports);
    element.addEventListener("click", () => {
      state.selectedLogicNodeId = node.id;
      renderLogicNodes();
      renderLogicProperties();
    });
    container.append(element);
  }
  requestAnimationFrame(renderLogicLinks);
}

function logicField(labelText, control) {
  const label = document.createElement("label");
  label.className = "logic-property";
  const caption = document.createElement("span");
  caption.textContent = labelText;
  label.append(caption, control);
  return label;
}

function logicSelect(options, value) {
  const select = document.createElement("select");
  for (const option of options) select.append(new Option(option.label, option.value));
  select.value = value === undefined || value === null ? "" : String(value);
  return select;
}

function bindLogicControl(control, apply, message = "Lógica atualizada") {
  const liveText = control.tagName === "TEXTAREA" || (control.tagName === "INPUT" && (!control.type || control.type === "text"));
  if (liveText) {
    let before = null;
    control.addEventListener("focus", () => { before ||= serializeScene(); });
    control.addEventListener("input", () => {
      before ||= serializeScene();
      apply(control);
      syncGlobalVariablesFromDocument();
      markDirty();
      renderLogicSummary();
      renderLogicNodes();
    });
    control.addEventListener("change", () => {
      state.document.logic = normalizeLogic(state.document.logic, uid);
      syncGlobalVariablesFromDocument();
      pushHistorySnapshot(before);
      before = null;
      renderLogicEditor();
      if (message) setStatus(message);
    });
    return control;
  }
  control.addEventListener("change", () => logicCommit(() => apply(control), message));
  return control;
}

function logicObjectOptions(predicate, emptyLabel = "Selecione um alvo") {
  const options = [{ label: emptyLabel, value: "" }];
  for (const record of state.document.objects) if (predicate(record)) options.push({ label: record.name, value: record.id });
  return options;
}

function logicPrimitiveControl(variable, value, apply) {
  if (variable?.type === "boolean") {
    const control = document.createElement("input");
    control.type = "checkbox";
    control.checked = value === true;
    return bindLogicControl(control, (input) => apply(input.checked));
  }
  const control = document.createElement("input");
  control.type = variable?.type === "number" ? "number" : "text";
  control.value = value === undefined || value === null ? "" : value;
  return bindLogicControl(control, (input) => apply(variable?.type === "number" ? clampNumber(input.value) : input.value));
}

function appendLogicVector(container, label, vectorValue, apply) {
  const wrapper = document.createElement("div");
  wrapper.className = "logic-property";
  const caption = document.createElement("span");
  caption.textContent = label;
  const fields = document.createElement("div");
  fields.className = "logic-vector";
  for (const axis of ["x", "y", "z"]) {
    const input = document.createElement("input");
    input.type = "number";
    input.step = "0.1";
    input.title = axis.toUpperCase();
    input.value = vectorValue[axis];
    bindLogicControl(input, (control) => apply(axis, clampNumber(control.value)));
    fields.append(input);
  }
  wrapper.append(caption, fields);
  container.append(wrapper);
}

function renderLogicVariables(container) {
  const heading = document.createElement("div");
  heading.className = "logic-variable-heading";
  const title = document.createElement("span");
  title.textContent = "Variáveis globais do projeto";
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "+ Adicionar";
  add.addEventListener("click", addLogicVariable);
  heading.append(title, add);
  container.append(heading);
  const list = document.createElement("div");
  list.className = "logic-variable-list";
  for (const variable of state.document.logic.variables) {
    const row = document.createElement("div");
    row.className = "logic-variable-row";
    const name = document.createElement("input");
    name.value = variable.name;
    bindLogicControl(name, (control) => { variable.name = control.value.trim() || "Variável"; });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.title = "Excluir variável";
    remove.addEventListener("click", () => deleteLogicVariable(variable.id));
    const type = logicSelect([
      { label: "Booleano", value: "boolean" }, { label: "Número", value: "number" }, { label: "Texto", value: "string" },
    ], variable.type);
    bindLogicControl(type, (control) => {
      variable.type = control.value;
      variable.initialValue = control.value === "number" ? 0 : control.value === "string" ? "" : false;
    });
    const value = logicPrimitiveControl(variable, variable.initialValue, (next) => { variable.initialValue = next; });
    const valueLabel = document.createElement("small");
    valueLabel.textContent = "Valor inicial";
    row.append(name, remove, type, valueLabel, value);
    list.append(row);
  }
  if (!state.document.logic.variables.length) {
    const empty = document.createElement("div");
    empty.className = "logic-empty";
    empty.textContent = "Crie variáveis para guardar chaves, contadores e estados que sobrevivem às trocas de cena.";
    list.append(empty);
  }
  container.append(list);
}

function appendLogicSelect(container, label, options, value, apply) {
  container.append(logicField(label, bindLogicControl(logicSelect(options, value), (control) => apply(control.value))));
}

function appendLogicNumber(container, label, value, apply, min = 1, max = 216000) {
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.value = value;
  container.append(logicField(label, bindLogicControl(input, (control) => apply(clampNumber(control.value, value)))));
}

function renderLogicNodeProperties(container, graph, node) {
  const config = node.config;
  if (node.type === "eventTrigger") {
    appendLogicSelect(container, "Trigger", logicObjectOptions((record) => record.source.kind === "collider" && record.collider?.trigger, "Selecione um trigger"), config.triggerId, (value) => { config.triggerId = value; });
    appendLogicSelect(container, "Quando", [
      { label: "Ao entrar", value: "onEnter" }, { label: "Ao sair", value: "onExit" }, { label: "Ao interagir", value: "onInteract" },
    ], config.phase, (value) => { config.phase = value; });
  } else if (node.type === "eventInput") {
    appendLogicSelect(container, "Botão", LOGIC_BUTTONS.map((button) => ({ label: button, value: button })), config.button, (value) => { config.button = value; });
  } else if (node.type === "eventTimer") {
    appendLogicNumber(container, "Intervalo em quadros", config.intervalFrames, (value) => { config.intervalFrames = value; });
    const repeat = document.createElement("input");
    repeat.type = "checkbox";
    repeat.checked = config.repeat;
    container.append(logicField("Repetir", bindLogicControl(repeat, (control) => { config.repeat = control.checked; })));
  } else if (node.type === "conditionVariable") {
    const variables = [{ label: "Selecione uma variável", value: "" }, ...state.document.logic.variables.map((variable) => ({ label: variable.name, value: variable.id }))];
    appendLogicSelect(container, "Variável", variables, config.variableId, (value) => {
      config.variableId = value;
      const selected = state.document.logic.variables.find((variable) => variable.id === value);
      config.value = selected?.type === "number" ? 0 : selected?.type === "string" ? "" : false;
    });
    appendLogicSelect(container, "Comparação", [
      { label: "Igual", value: "eq" }, { label: "Diferente", value: "neq" }, { label: "Maior", value: "gt" },
      { label: "Maior ou igual", value: "gte" }, { label: "Menor", value: "lt" }, { label: "Menor ou igual", value: "lte" },
    ], config.operator, (value) => { config.operator = value; });
    const variable = state.document.logic.variables.find((item) => item.id === config.variableId);
    container.append(logicField("Valor", logicPrimitiveControl(variable, config.value, (value) => { config.value = value; })));
  } else if (node.type === "actionMessage") {
    const text = document.createElement("textarea");
    text.maxLength = 160;
    text.value = config.text;
    container.append(logicField("Mensagem", bindLogicControl(text, (control) => { config.text = control.value; })));
    appendLogicNumber(container, "Duração em quadros", config.duration, (value) => { config.duration = value; }, 1, 3600);
  } else if (node.type === "actionDisplayVariable") {
    const variables = [{ label: "Selecione uma variável", value: "" }, ...state.document.logic.variables.map((variable) => ({ label: variable.name, value: variable.id }))];
    appendLogicSelect(container, "Variável", variables, config.variableId, (value) => { config.variableId = value; });
    const prefix = document.createElement("input");
    prefix.maxLength = 80;
    prefix.value = config.prefix;
    container.append(logicField("Texto antes do valor", bindLogicControl(prefix, (control) => { config.prefix = control.value; })));
    appendLogicNumber(container, "Duração em quadros", config.duration, (value) => { config.duration = value; }, 1, 3600);
  } else if (node.type === "actionVisibility") {
    appendLogicSelect(container, "Objeto ou grupo", logicObjectOptions((record) => ["model", "primitive", "group"].includes(record.source.kind)), config.targetId, (value) => { config.targetId = value; });
    appendLogicSelect(container, "Operação", [
      { label: "Alternar", value: "toggle" }, { label: "Mostrar", value: "show" }, { label: "Ocultar", value: "hide" },
    ], config.mode, (value) => { config.mode = value; });
  } else if (node.type === "actionTeleport") {
    appendLogicVector(container, "Destino do jogador", config.position, (axis, value) => { config.position[axis] = value; });
  } else if (node.type === "actionAudio") {
    appendLogicSelect(container, "Fonte de áudio", logicObjectOptions((record) => record.source.kind === "audio"), config.targetId, (value) => { config.targetId = value; });
    appendLogicSelect(container, "Comando", [{ label: "Tocar", value: "play" }, { label: "Parar", value: "stop" }], config.mode, (value) => { config.mode = value; });
  } else if (node.type === "actionParticle") {
    appendLogicSelect(container, "Emissor", logicObjectOptions((record) => record.source.kind === "particle"), config.targetId, (value) => { config.targetId = value; });
    appendLogicSelect(container, "Comando", [{ label: "Explodir", value: "burst" }, { label: "Iniciar", value: "start" }, { label: "Parar", value: "stop" }], config.mode, (value) => { config.mode = value; });
  } else if (node.type === "actionVideo") {
    const videos = [{ label: "Selecione um vídeo", value: "" }, ...state.document.ui.filter((item) => item.type === "video").map((item) => ({ label: item.name, value: item.id }))];
    appendLogicSelect(container, "Vídeo de UI", videos, config.targetId, (value) => { config.targetId = value; });
    appendLogicSelect(container, "Comando", [{ label: "Tocar", value: "play" }, { label: "Pausar", value: "pause" }, { label: "Parar", value: "stop" }], config.mode, (value) => { config.mode = value; });
  } else if (node.type === "actionScene") {
    const scenes = [{ label: "Selecione uma cena", value: "" }, ...state.scenes.map((entry) => ({ label: entry.name, value: entry.id }))];
    appendLogicSelect(container, "Cena de destino", scenes, config.sceneId, (value) => {
      config.sceneId = value;
      const points = projectSpawnPoints(value);
      config.spawnId = (points.find((point) => point.default) || points[0])?.id || "";
    });
    const points = projectSpawnPoints(config.sceneId);
    const spawns = [
      { label: points.length ? "Entrada padrão da cena" : "Cena sem pontos de entrada", value: "" },
      ...points.map((point) => ({ label: `${point.default ? "★ " : ""}${point.name}`, value: point.id })),
    ];
    appendLogicSelect(container, "Ponto de entrada", spawns, config.spawnId, (value) => { config.spawnId = value; });
    appendLogicNumber(container, "Fade em quadros", config.fadeFrames, (value) => { config.fadeFrames = value; }, 1, 300);
  } else if (node.type === "actionSetVariable") {
    const variables = [{ label: "Selecione uma variável", value: "" }, ...state.document.logic.variables.map((variable) => ({ label: variable.name, value: variable.id }))];
    appendLogicSelect(container, "Variável", variables, config.variableId, (value) => {
      config.variableId = value;
      config.operation = "set";
      const selected = state.document.logic.variables.find((variable) => variable.id === value);
      config.value = selected?.type === "number" ? 0 : selected?.type === "string" ? "" : false;
    });
    const variable = state.document.logic.variables.find((item) => item.id === config.variableId);
    const operations = variable?.type === "boolean"
      ? [{ label: "Definir", value: "set" }, { label: "Alternar", value: "toggle" }]
      : variable?.type === "number"
        ? [{ label: "Definir", value: "set" }, { label: "Somar", value: "add" }, { label: "Subtrair", value: "subtract" }]
        : [{ label: "Definir", value: "set" }];
    appendLogicSelect(container, "Operação", operations, config.operation, (value) => { config.operation = value; });
    if (config.operation !== "toggle") container.append(logicField("Valor", logicPrimitiveControl(variable, config.value, (value) => { config.value = value; })));
  } else if (node.type === "flowDelay") {
    appendLogicNumber(container, "Esperar quadros", config.frames, (value) => { config.frames = value; });
  } else {
    const description = document.createElement("div");
    description.className = "logic-empty";
    description.textContent = "Este evento não precisa de configuração.";
    container.append(description);
  }

  const relatedLinks = graph.links.filter((link) => link.from === node.id || link.to === node.id);
  if (relatedLinks.length) {
    const heading = document.createElement("div");
    heading.className = "logic-variable-heading";
    heading.textContent = "Conexões";
    container.append(heading);
    for (const link of relatedLinks) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "logic-delete-node";
      const otherId = link.from === node.id ? link.to : link.from;
      const other = graph.nodes.find((candidate) => candidate.id === otherId);
      button.textContent = `Remover · ${LOGIC_NODE_DEFINITIONS[other?.type]?.label || "nó"}`;
      button.addEventListener("click", () => logicCommit(() => { graph.links = graph.links.filter((candidate) => candidate.id !== link.id); }, "Conexão removida"));
      container.append(button);
    }
  }
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "logic-delete-node";
  remove.textContent = "Excluir este nó";
  remove.addEventListener("click", () => deleteLogicNode(node.id));
  container.append(remove);
}

function renderLogicProperties() {
  const container = $("logic-properties");
  container.replaceChildren();
  const graph = currentLogicGraph();
  const node = currentLogicNode();
  $("logic-properties-subtitle").textContent = node ? LOGIC_NODE_DEFINITIONS[node.type].label : "Fluxo";
  if (!graph) {
    const empty = document.createElement("div");
    empty.className = "logic-empty";
    empty.textContent = "Crie um fluxo para começar. Cada fluxo pode responder a diferentes eventos da cena.";
    container.append(empty);
    renderLogicVariables(container);
    return;
  }
  if (!node) {
    const name = document.createElement("input");
    name.value = graph.name;
    bindLogicControl(name, (control) => { graph.name = control.value.trim() || "Fluxo"; }, "Fluxo renomeado");
    container.append(logicField("Nome do fluxo", name));
    const info = document.createElement("div");
    info.className = "logic-empty";
    info.textContent = `${graph.nodes.length} nó${graph.nodes.length === 1 ? "" : "s"} · ${graph.links.length} conexão${graph.links.length === 1 ? "" : "ões"}. Selecione um nó para editar.`;
    container.append(info);
    renderLogicVariables(container);
    return;
  }
  renderLogicNodeProperties(container, graph, node);
}

function renderLogicEditor() {
  const graphSelect = $("logic-graph-select");
  const graphs = state.document?.logic?.graphs || [];
  graphSelect.replaceChildren(new Option(graphs.length ? "Selecione um fluxo" : "Nenhum fluxo", ""));
  for (const graph of graphs) graphSelect.append(new Option(graph.name, graph.id));
  graphSelect.value = currentLogicGraph()?.id || "";
  $("logic-graph-enabled").checked = currentLogicGraph()?.enabled !== false;
  $("logic-graph-enabled").disabled = !currentLogicGraph();
  $("logic-duplicate-graph-button").disabled = !currentLogicGraph();
  $("logic-delete-graph-button").disabled = !currentLogicGraph();
  renderLogicPalette();
  renderLogicNodes();
  renderLogicProperties();
}

function setLogicMode(active) {
  if (active && state.uiMode) setUiMode(false);
  state.logicMode = Boolean(active);
  document.body.classList.toggle("logic-mode-active", state.logicMode);
  $("logic-editor").hidden = !state.logicMode;
  viewport.classList.toggle("logic-mode", state.logicMode);
  $("logic-mode-button").classList.toggle("active", state.logicMode);
  $("open-logic-editor-button").textContent = state.logicMode ? "Fechar" : "Abrir";
  orbit.enabled = !state.logicMode && !state.uiMode;
  transformHelper.visible = !state.logicMode && !state.uiMode;
  if (state.logicMode) {
    setSelection(null);
    renderLogicEditor();
    setStatus("Visual scripting · grafos seguros para o AthenaEnv");
  } else {
    state.logicConnecting = null;
    setStatus(`${state.document?.name || "Cena"} · modo 3D`);
  }
}

function addLogicGraph() {
  const graph = createLogicGraph(`Fluxo ${state.document.logic.graphs.length + 1}`, uid);
  logicCommit(() => state.document.logic.graphs.push(graph), "Novo fluxo criado");
  state.selectedLogicGraphId = graph.id;
  state.selectedLogicNodeId = graph.nodes[0]?.id || null;
  renderLogicEditor();
}

function duplicateLogicGraph() {
  const source = currentLogicGraph();
  if (!source) return;
  const nodeIds = new Map();
  const copy = deepClone(source);
  copy.id = uid("graph");
  copy.name = `${source.name} — cópia`;
  for (const node of copy.nodes) {
    const previous = node.id;
    node.id = uid("node");
    node.x += 28;
    node.y += 28;
    nodeIds.set(previous, node.id);
  }
  for (const link of copy.links) {
    link.id = uid("link");
    link.from = nodeIds.get(link.from);
    link.to = nodeIds.get(link.to);
  }
  logicCommit(() => state.document.logic.graphs.push(copy), "Fluxo duplicado");
  state.selectedLogicGraphId = copy.id;
  state.selectedLogicNodeId = null;
  renderLogicEditor();
}

function deleteLogicGraph() {
  const graph = currentLogicGraph();
  if (!graph || !window.confirm(`Excluir o fluxo “${graph.name}”?`)) return;
  logicCommit(() => { state.document.logic.graphs = state.document.logic.graphs.filter((candidate) => candidate.id !== graph.id); }, "Fluxo excluído");
  state.selectedLogicGraphId = state.document.logic.graphs[0]?.id || null;
  state.selectedLogicNodeId = null;
  renderLogicEditor();
}

function addLogicNode(type) {
  const graph = currentLogicGraph();
  if (!graph) return;
  const scroll = $("logic-canvas-scroll");
  let x = scroll.scrollLeft + 100;
  let y = scroll.scrollTop + 100;
  let attempts = 0;
  while (graph.nodes.some((candidate) => Math.abs(candidate.x - x) < 210 && Math.abs(candidate.y - y) < 105) && attempts < 40) {
    x += 230;
    if (x > scroll.scrollLeft + Math.max(690, scroll.clientWidth - 210)) {
      x = scroll.scrollLeft + 100;
      y += 140;
    }
    attempts++;
  }
  const node = createLogicNode(type, uid, { x, y });
  logicCommit(() => graph.nodes.push(node), `${LOGIC_NODE_DEFINITIONS[type].label} adicionado`);
  state.selectedLogicNodeId = node.id;
  renderLogicEditor();
}

function deleteLogicNode(nodeId) {
  const graph = currentLogicGraph();
  if (!graph) return;
  logicCommit(() => {
    graph.nodes = graph.nodes.filter((node) => node.id !== nodeId);
    graph.links = graph.links.filter((link) => link.from !== nodeId && link.to !== nodeId);
  }, "Nó excluído");
  if (state.selectedLogicNodeId === nodeId) state.selectedLogicNodeId = null;
  if (state.logicConnecting?.nodeId === nodeId) state.logicConnecting = null;
  renderLogicEditor();
}

function addLogicVariable() {
  const name = window.prompt("Nome da variável:", `Variável ${state.document.logic.variables.length + 1}`)?.trim();
  if (!name) return;
  logicCommit(() => state.document.logic.variables.push(createLogicVariable(name, "boolean", uid)), "Variável criada");
}

function deleteLogicVariable(variableId) {
  const variable = state.document.logic.variables.find((item) => item.id === variableId);
  if (!variable || !window.confirm(`Excluir a variável “${variable.name}”?`)) return;
  logicCommit(() => { state.document.logic.variables = state.document.logic.variables.filter((item) => item.id !== variableId); }, "Variável excluída");
}

function validateVisualScripting() {
  const issues = validateLogic(state.document.logic);
  for (const record of state.document.objects) {
    if (record.source.kind !== "collider" || !record.portal?.enabled) continue;
    const target = state.scenes.find((entry) => entry.id === record.portal.targetSceneId);
    if (!target) issues.push(`${record.name}: o portal aponta para uma cena inexistente`);
    else if (record.portal.targetSpawnId && !projectSpawnPoints(target.id).some((point) => point.id === record.portal.targetSpawnId)) {
      issues.push(`${record.name}: o ponto de entrada ${record.portal.targetSpawnId} não existe em ${target.name}`);
    }
    if (record.portal.condition?.enabled && !state.globalVariables.some((variable) => variable.id === record.portal.condition.variableId)) {
      issues.push(`${record.name}: a condição do portal não possui uma variável global válida`);
    }
  }
  for (const graph of state.document.logic.graphs) {
    for (const node of graph.nodes) {
      if (node.type !== "actionScene") continue;
      const scene = state.scenes.find((entry) => entry.id === node.config.sceneId);
      if (!scene) {
        issues.push(`${graph.name}: a troca de cena aponta para uma cena inexistente`);
        continue;
      }
      if (node.config.spawnId && !projectSpawnPoints(scene.id).some((point) => point.id === node.config.spawnId)) {
        issues.push(`${graph.name}: o ponto de entrada ${node.config.spawnId} não existe em ${scene.name}`);
      }
    }
  }
  if (!issues.length) {
    toast("Visual scripting válido e pronto para exportar.", "success");
    setStatus("Nenhum problema encontrado nos grafos");
    return;
  }
  toast(`${issues.length} problema${issues.length === 1 ? "" : "s"}: ${issues.slice(0, 3).join(" · ")}`, "error", 9000);
  setStatus(`${issues.length} problema${issues.length === 1 ? "" : "s"} no visual scripting`);
}

function convertTriggerActionsToLogic() {
  const record = currentRecord();
  if (!record?.collider?.trigger) return;
  const count = eventPhases.reduce((total, phase) => total + (record.events?.[phase]?.length || 0), 0);
  if (!count) {
    toast("Este trigger ainda não possui ações para converter.", "info");
    return;
  }
  if (!window.confirm("Converter as ações deste trigger em um grafo? As listas antigas serão removidas para evitar execução duplicada.")) return;
  const graph = createLogicGraph(`${record.name} · eventos`, uid, false);
  let row = 0;
  for (const phase of eventPhases) {
    const actions = record.events[phase] || [];
    if (!actions.length) continue;
    const eventNode = createLogicNode("eventTrigger", uid, { x: 80, y: 80 + row * 150 });
    eventNode.config = { triggerId: record.id, phase };
    graph.nodes.push(eventNode);
    let previous = eventNode;
    for (let index = 0; index < actions.length; index++) {
      const action = actions[index];
      const type = {
        message: "actionMessage", visibility: "actionVisibility", teleport: "actionTeleport",
        audio: "actionAudio", particle: "actionParticle", video: "actionVideo",
        save: "actionSaveGame", load: "actionLoadGame", scene: "actionScene",
      }[action.type];
      if (!type) continue;
      const node = createLogicNode(type, uid, { x: 330 + index * 230, y: 80 + row * 150 });
      node.config = deepClone(action);
      delete node.config.id;
      graph.nodes.push(node);
      graph.links.push({ id: uid("link"), from: previous.id, fromPort: "next", to: node.id });
      previous = node;
    }
    row++;
  }
  logicCommit(() => {
    state.document.logic.graphs.push(graph);
    record.events = normalizeRecordEvents();
  }, "Ações convertidas para visual scripting");
  state.selectedLogicGraphId = graph.id;
  state.selectedLogicNodeId = graph.nodes[0]?.id || null;
  setLogicMode(true);
  toast("Trigger convertido. O comportamento agora está no grafo visual.", "success");
}

function renderUiInspector(item = currentUiElement()) {
  if (!item) return;
  $("ui-type-icon").textContent = ({ panel: "▰", text: "T", image: "▧", video: "▶" })[item.type] || "T";
  $("ui-name").value = item.name;
  $("ui-x").value = cleanNumber(item.x);
  $("ui-y").value = cleanNumber(item.y);
  $("ui-width").value = cleanNumber(item.width);
  $("ui-height").value = cleanNumber(item.height);
  $("ui-text-section").hidden = item.type !== "text";
  $("ui-panel-section").hidden = item.type !== "panel";
  $("ui-media-section").hidden = !["image", "video"].includes(item.type);
  $("ui-text").value = item.text;
  if (item.type === "text") renderUiFontOptions(item);
  $("ui-font-scale").value = item.fontScale;
  $("ui-align").value = item.align;
  $("ui-color").value = item.color;
  $("ui-outline").value = item.outline;
  $("ui-outline-color").value = item.outlineColor;
  $("ui-dropshadow").value = item.dropshadow;
  $("ui-dropshadow-color").value = item.dropshadowColor;
  $("ui-background").value = item.background;
  $("ui-opacity").value = item.opacity;
  if (["image", "video"].includes(item.type)) {
    renderUiMediaAssetOptions(item);
    $("ui-media-kind").textContent = item.type === "video" ? "Vídeo MPEG" : "Imagem";
    $("ui-media-autoplay-row").hidden = item.type !== "video";
    $("ui-media-loop-row").hidden = item.type !== "video";
    $("ui-media-autoplay").checked = item.autoplay;
    $("ui-media-loop").checked = item.loop;
    $("ui-media-opacity").value = item.opacity;
  }
  $("ui-visible").checked = item.visible;
  $("ui-runtime").checked = item.runtime;
}

function renderInspector() {
  const record = currentRecord();
  const object = currentObject();
  const uiItem = currentUiElement();
  $("ui-inspector").hidden = !uiItem;
  if (uiItem) {
    $("inspector-multi").hidden = true;
    inspector.hidden = true;
    inspectorEmpty.hidden = true;
    renderUiInspector(uiItem);
    return;
  }
  const multi = state.selectedIds.size > 1;
  $("create-prefab-button").disabled = state.selectedIds.size === 0;
  $("inspector-multi").hidden = !multi;
  inspector.hidden = !record || multi;
  inspectorEmpty.hidden = Boolean(record);
  if (multi) {
    inspectorEmpty.hidden = true;
    const count = state.selectedIds.size;
    $("multi-selection-count").textContent = `${count} objetos selecionados`;
    updateSelectionBounds();
    const pivot = state.pivotCustom ? state.pivotPosition : selectionBounds.getCenter(new THREE.Vector3());
    $("multi-pivot").textContent = `${pivot.x.toFixed(2)}, ${pivot.y.toFixed(2)}, ${pivot.z.toFixed(2)}`;
    let triangles = 0;
    for (const selected of selectedObjects()) triangles += selected.userData.stats?.triangles || 0;
    $("multi-triangles").textContent = Math.round(triangles).toLocaleString("pt-BR");
    return;
  }
  if (!record) return;

  $("object-name").value = record.name;
  $("object-type-icon").textContent = ({ group: "▱", collider: "▣", primitive: "◆", model: "◇", light: "✦", camera: "▣", audio: "♪", particle: "⁙", shadow: "◒", spawn: "⌖" })[record.source.kind] || "◇";
  setVectorInputs("position", record.position);
  setVectorInputs("rotation", record.rotation);
  setVectorInputs("scale", record.scale);
  $("object-color").value = record.color;
  $("object-visible").checked = record.visible;
  $("object-locked").checked = record.locked;
  $("object-runtime").checked = record.runtime;
  $("object-persistent").checked = record.persistent;
  $("object-persistent-row").hidden = !["model", "primitive"].includes(record.source.kind);
  $("source-kind").textContent = record.source.kind === "primitive"
    ? `Primitiva · ${record.source.primitive}`
    : record.source.kind === "collider"
      ? `Colisor · ${record.source.collider}`
      : record.source.kind === "light"
        ? `Luz · ${{ ambient: "ambiente", directional: "direcional", point: "pontual" }[record.light.type]}`
        : record.source.kind === "camera"
          ? "Câmera"
          : record.source.kind === "audio"
            ? `Áudio · ${record.audio.mode === "sfx" ? "efeito ADPCM" : "stream"}`
            : record.source.kind === "particle"
              ? `Partículas · ${{ fire: "fogo", smoke: "fumaça", sparks: "faíscas" }[record.particle.preset]}`
              : record.source.kind === "shadow"
                ? "Projetor de sombra"
                : record.source.kind === "spawn"
                  ? "Ponto de entrada"
                  : record.source.kind === "group" ? "Grupo" : "Modelo 3D";
  $("source-asset").textContent = record.source.asset || "—";
  $("source-id").textContent = record.id;
  const stats = object?.userData.stats;
  $("source-stats").textContent = stats ? `${stats.vertices.toLocaleString("pt-BR")} vértices · ${stats.triangles.toLocaleString("pt-BR")} tris` : "Carregando…";

  const parentSelect = $("object-parent");
  parentSelect.replaceChildren(new Option("Raiz da cena", ""));
  for (const candidate of state.document.objects) {
    if (candidate.id === record.id || isDescendant(candidate.id, record.id)) continue;
    parentSelect.append(new Option(candidate.name, candidate.id));
  }
  parentSelect.value = record.parentId || "";

  const colliderMode = record.source.kind === "collider";
  const materialMode = ["model", "primitive"].includes(record.source.kind);
  const lightMode = record.source.kind === "light";
  const cameraMode = record.source.kind === "camera";
  const audioMode = record.source.kind === "audio";
  const particleMode = record.source.kind === "particle";
  const animationMode = record.source.kind === "model";
  const shadowMode = record.source.kind === "shadow";
  const spawnMode = record.source.kind === "spawn";
  $("collider-section").hidden = !colliderMode;
  $("material-section").hidden = !materialMode;
  $("light-section").hidden = !lightMode;
  $("camera-section").hidden = !cameraMode;
  $("audio-section").hidden = !audioMode;
  $("particle-section").hidden = !particleMode;
  $("animation-section").hidden = !animationMode;
  $("shadow-section").hidden = !shadowMode;
  $("spawn-section").hidden = !spawnMode;
  $("object-color-row").hidden = !colliderMode;
  if (colliderMode) {
    $("collider-shape").value = record.source.collider;
    $("collider-trigger").checked = record.collider?.trigger === true;
    $("collider-camera").checked = record.collider?.cameraBlocker !== false;
    renderPortalEditor(record);
    renderCheckpointEditor(record);
    renderTriggerEvents(record);
  }
  if (spawnMode) $("spawn-default").checked = record.spawn?.default === true;
  if (materialMode) {
    renderMaterialTextureOptions(record);
    $("material-color").value = record.material.color;
    $("material-opacity").value = record.material.opacity;
    $("material-roughness").value = record.material.roughness;
    $("material-metalness").value = record.material.metalness;
    $("material-emissive").value = record.material.emissive;
    $("material-emissive-intensity").value = record.material.emissiveIntensity;
    $("material-unlit").checked = record.material.unlit;
    $("material-double-sided").checked = record.material.doubleSided;
    $("material-texture-mapping").checked = record.material.textureMapping;
    $("material-smooth-shading").checked = record.material.smoothShading;
    $("material-accurate-clipping").checked = record.material.accurateClipping;
  }
  if (animationMode) {
    renderAnimationClipOptions(record, object);
    $("animation-autoplay").checked = record.animation.autoplay;
    $("animation-loop").checked = record.animation.loop;
    const gltf = /\.gltf$/i.test(record.source.asset);
    $("animation-runtime-note").textContent = gltf
      ? "PS2 · AnimCollection e RenderObject.playAnim usam os clips do GLTF oficial."
      : "O AthenaEnv documenta AnimCollection para GLTF. Use um modelo .gltf com skin e animações.";
  }
  if (lightMode) {
    $("light-type").value = record.light.type;
    $("light-color").value = record.light.color;
    $("light-intensity").value = record.light.intensity;
    $("light-distance").value = record.light.distance;
    $("light-distance-row").hidden = record.light.type !== "point";
    $("light-flicker").checked = record.light.flicker;
    $("light-flicker-amount").value = record.light.flickerAmount;
    $("light-flicker-speed").value = record.light.flickerSpeed;
    $("light-flicker-row").hidden = record.light.type !== "point";
    $("light-flicker-amount-row").hidden = record.light.type !== "point" || !record.light.flicker;
    $("light-flicker-speed-row").hidden = record.light.type !== "point" || !record.light.flicker;
    $("light-campfire-preset").hidden = record.light.type !== "point";
    $("light-cast-shadow").checked = record.light.castShadow;
    $("light-runtime-note").textContent = record.light.type === "point"
      ? "PS2 · simulação local por objeto. Alcance e flicker funcionam no jogo; blocos menores dão mais precisão. As luzes compartilham 4 slots. Sombras da própria luz são só preview; use um Projetor de sombra para exportá-las."
      : record.light.type === "directional"
        ? "PS2 · luz global. A posição não limita o alcance; use a rotação para controlar a direção."
        : "PS2 · luz global. Clareia toda a cena de forma uniforme.";
  }
  if (cameraMode) {
    $("camera-mode").value = record.camera.mode;
    $("camera-fov").value = record.camera.fov;
    $("camera-near").value = record.camera.near;
    $("camera-far").value = record.camera.far;
    $("camera-active").checked = record.camera.active;
    $("camera-runtime-note").textContent = record.camera.mode === "follow"
      ? "PS2 · câmera de gameplay: segue o jogador e aceita o analógico direito."
      : record.camera.mode === "fixed"
        ? "PS2 · câmera fixa: usa exatamente a posição e a rotação deste objeto."
        : "PS2 · câmera fixa que acompanha o jogador com o olhar.";
  }
  if (audioMode) {
    renderAudioAssetOptions(record);
    $("audio-mode").value = record.audio.mode;
    $("audio-mode").disabled = Boolean(record.source.asset);
    $("audio-autoplay").checked = record.audio.autoplay;
    $("audio-loop").checked = record.audio.loop;
    $("audio-volume").value = record.audio.volume;
    $("audio-spatial").checked = record.audio.spatial;
    $("audio-distance").value = record.audio.distance;
    $("audio-pan").value = record.audio.pan;
    $("audio-pitch").value = record.audio.pitch;
    const sfxMode = record.audio.mode === "sfx";
    $("audio-spatial-row").hidden = !sfxMode;
    $("audio-distance-row").hidden = !sfxMode || !record.audio.spatial;
    $("audio-pan-row").hidden = !sfxMode;
    $("audio-pitch-row").hidden = !sfxMode;
    $("audio-runtime-note").textContent = sfxMode
      ? "PS2 · Sound.Sfx usa ADPCM, volume, pan e pitch. O modo espacial recalcula volume e pan pela distância do jogador; parar aguarda o efeito atual terminar."
      : "PS2 · Sound.Stream toca WAV/OGG globalmente. Apenas o primeiro stream exportado é carregado; volume usa o controle mestre do Athena.";
  }
  if (particleMode) {
    $("particle-preset").value = record.particle.preset;
    $("particle-color").value = record.particle.color;
    $("particle-autoplay").checked = record.particle.autoplay;
    $("particle-max").value = record.particle.maxParticles;
    $("particle-rate").value = record.particle.rate;
    $("particle-lifetime").value = record.particle.lifetime;
    $("particle-speed").value = record.particle.speed;
    $("particle-spread").value = record.particle.spread;
    $("particle-size").value = record.particle.size;
    $("particle-gravity").value = record.particle.gravity;
  }
  if (shadowMode) {
    renderShadowTextureOptions(record);
    $("shadow-width").value = record.shadow.width;
    $("shadow-height").value = record.shadow.height;
    $("shadow-grid-x").value = record.shadow.gridX;
    $("shadow-grid-z").value = record.shadow.gridZ;
    $("shadow-light-x").value = record.shadow.lightDirection.x;
    $("shadow-light-y").value = record.shadow.lightDirection.y;
    $("shadow-light-z").value = record.shadow.lightDirection.z;
    $("shadow-bias").value = record.shadow.bias;
    $("shadow-offset").value = record.shadow.lightOffset;
    $("shadow-color").value = record.shadow.color;
    $("shadow-opacity").value = record.shadow.opacity;
    $("shadow-blend").value = record.shadow.blend;
    $("shadow-follow-player").checked = record.shadow.followPlayer;
  }

  const transformInputs = inspector.querySelectorAll('.vector-inputs input, #reset-transform-button');
  for (const input of transformInputs) input.disabled = isRecordEffectivelyLocked(record);
}

function updateViewportStats() {
  let triangles = 0;
  for (const object of state.objects.values()) triangles += object.userData.stats?.triangles || 0;
  const count = state.document?.objects.length || 0;
  const uiCount = state.document?.ui?.length || 0;
  $("viewport-stats").textContent = `${count} objeto${count === 1 ? "" : "s"} · ${uiCount} UI · ${Math.round(triangles).toLocaleString("pt-BR")} triângulos`;
}

async function refreshAssetCatalog() {
  try {
    const response = await fetch("/api/assets", { cache: "no-store" });
    if (!response.ok) throw new Error("Falha ao listar assets");
    const data = await response.json();
    state.assets = data.models || [];
    state.assetFiles = data.files || [];
    state.textures = state.assetFiles.filter((asset) => [".png", ".jpg", ".jpeg", ".bmp"].includes(asset.extension));
    state.fontFiles = state.assetFiles.filter((asset) => [".ttf", ".otf", ".png", ".jpg", ".jpeg", ".bmp"].includes(asset.extension));
    state.audioFiles = state.assetFiles.filter((asset) => [".wav", ".ogg", ".adp"].includes(asset.extension));
    state.videoFiles = state.assetFiles.filter((asset) => [".m2v", ".mpg", ".mpeg"].includes(asset.extension));
    renderAssets();
    if (currentRecord()?.material || currentRecord()?.audio || currentRecord()?.shadow || currentUiElement()) renderInspector();
  } catch (error) {
    toast(error.message, "error");
  }
}

async function refreshPrefabs() {
  try {
    const response = await fetch("/api/prefabs", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Falha ao listar prefabs");
    state.prefabs = data.prefabs || [];
    renderPrefabs();
  } catch (error) {
    toast(error.message, "error");
  }
}

function recordWorldTransform(record) {
  const object = state.objects.get(record.id);
  object.updateMatrixWorld(true);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  object.matrixWorld.decompose(position, quaternion, scale);
  const rotation = new THREE.Euler().setFromQuaternion(quaternion, "XYZ");
  return {
    position: { x: cleanNumber(position.x), y: cleanNumber(position.y), z: cleanNumber(position.z) },
    rotation: {
      x: cleanNumber(THREE.MathUtils.radToDeg(rotation.x)),
      y: cleanNumber(THREE.MathUtils.radToDeg(rotation.y)),
      z: cleanNumber(THREE.MathUtils.radToDeg(rotation.z)),
    },
    scale: { x: cleanNumber(scale.x), y: cleanNumber(scale.y), z: cleanNumber(scale.z) },
  };
}

async function saveSelectionAsPrefab(nameOverride) {
  if (!state.selectedIds.size) return;
  const defaultName = state.selectedIds.size === 1 ? currentRecord()?.name : `Conjunto de ${state.selectedIds.size} objetos`;
  if (typeof nameOverride !== "string") {
    $("prefab-name-input").value = defaultName || "Novo prefab";
    $("prefab-dialog").showModal();
    $("prefab-name-input").focus();
    $("prefab-name-input").select();
    return;
  }
  const name = nameOverride;
  if (!name?.trim()) return;
  const closure = selectionClosure();
  updateSelectionBounds();
  const origin = selectionBounds.getCenter(new THREE.Vector3());
  const objects = state.document.objects.filter((record) => closure.has(record.id)).map((record) => {
    const copy = deepClone(record);
    if (!record.parentId || !closure.has(record.parentId)) {
      const world = recordWorldTransform(record);
      copy.parentId = null;
      copy.position = {
        x: cleanNumber(world.position.x - origin.x),
        y: cleanNumber(world.position.y - origin.y),
        z: cleanNumber(world.position.z - origin.z),
      };
      copy.rotation = world.rotation;
      copy.scale = world.scale;
    }
    return copy;
  });
  try {
    const response = await fetch("/api/prefabs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), objects }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Falha ao criar prefab");
    await refreshPrefabs();
    toast(`Prefab “${result.prefab.name}” criado.`, "success");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function instantiatePrefab(prefab) {
  if (!prefab?.objects?.length) return;
  const before = serializeScene();
  const idMap = new Map(prefab.objects.map((record) => [record.id, uid(record.source?.kind || "prefab")]));
  const rootIds = [];
  for (const source of prefab.objects) {
    const record = deepClone(source);
    record.id = idMap.get(source.id);
    record.parentId = source.parentId && idMap.has(source.parentId) ? idMap.get(source.parentId) : null;
    record.prefabId = prefab.id;
    if (!record.parentId) {
      record.position.x += orbit.target.x;
      record.position.y += orbit.target.y;
      record.position.z += orbit.target.z;
      rootIds.push(record.id);
    }
    await addRecord(record, { select: false, checkpoint: false });
  }
  rebuildHierarchy();
  pushHistorySnapshot(before);
  state.selectedIds = new Set(rootIds);
  state.primaryId = rootIds.at(-1) || null;
  setSelection(state.primaryId, { additive: true });
  focusSelection();
  toast(`Prefab “${prefab.name}” instanciado.`, "success");
}

async function deletePrefab(prefab) {
  if (!window.confirm(`Excluir o prefab “${prefab.name}”? As instâncias existentes continuarão na cena.`)) return;
  try {
    const response = await fetch(`/api/prefabs/${encodeURIComponent(prefab.id)}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Falha ao excluir prefab");
    await refreshPrefabs();
    toast("Prefab excluído.");
  } catch (error) {
    toast(error.message, "error");
  }
}

function rebuildHierarchy() {
  for (const record of state.document?.objects || []) {
    const object = state.objects.get(record.id);
    if (!object) continue;
    editorRoot.add(object);
    applyRecordTransform(record, object);
  }
  for (const record of state.document?.objects || []) {
    if (!record.parentId) continue;
    const object = state.objects.get(record.id);
    const parent = state.objects.get(record.parentId);
    if (!object || !parent || isDescendant(record.parentId, record.id)) {
      record.parentId = null;
      continue;
    }
    parent.add(object);
    applyRecordTransform(record, object);
  }
  for (const record of state.document?.objects || []) {
    applyEditorVisibility(record);
  }
  editorRoot.updateMatrixWorld(true);
}

function setParent(id, parentId) {
  const record = recordById(id);
  const object = state.objects.get(id);
  const parent = parentId ? state.objects.get(parentId) : editorRoot;
  if (!record || !object || !parent || id === parentId || (parentId && isDescendant(parentId, id))) {
    toast("Essa relação criaria um ciclo na hierarquia.", "error");
    return;
  }
  const before = serializeScene();
  object.updateMatrixWorld(true);
  const world = object.matrixWorld.clone();
  parent.updateMatrixWorld(true);
  parent.add(object);
  const local = parent.matrixWorld.clone().invert().multiply(world);
  local.decompose(object.position, object.quaternion, object.scale);
  object.rotation.setFromQuaternion(object.quaternion, "XYZ");
  record.parentId = parentId || null;
  syncRecordFromObject(record, object);
  pushHistorySnapshot(before);
  setSelection(id);
  setStatus(parentId ? `${record.name} adicionado a ${recordById(parentId)?.name}` : `${record.name} movido para a raiz`);
}

async function loadDocument(documentData, { preserveHistory = false, dirty = false } = {}) {
  state.loadGeneration += 1;
  state.documentRevision += 1;
  const generation = state.loadGeneration;
  closeCameraPreview();
  transform.detach();
  selectionBox.visible = false;
  state.selectedIds.clear();
  state.primaryId = null;
  state.selectedUiId = null;
  state.pivotSelectionKey = "";
  state.pivotCustom = false;
  state.pivotEditing = false;
  state.isolationRoots.clear();
  state.isolatedIds = null;
  state.boxSelectTool = false;
  state.boxSelecting = false;
  selectionMarquee.hidden = true;
  viewport.classList.remove("box-select-mode");
  orbit.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
  for (const object of [...editorRoot.children]) {
    editorRoot.remove(object);
    disposeObject(object);
  }
  state.objects.clear();

  const normalizedObjects = Array.isArray(documentData?.objects) ? documentData.objects.map(normalizeRecord) : [];
  const documentLogic = normalizeLogic(documentData?.logic, uid);
  if (preserveHistory) {
    state.globalVariables = documentLogic.variables.map((variable) => ({ ...variable }));
  } else {
    documentLogic.variables = state.globalVariables.map((variable) => ({ ...variable }));
  }
  state.document = {
    version: 1,
    name: documentData?.name || "Cena Athena",
    settings: {
      background: documentData?.settings?.background || "#07101d",
      gridSize: clampNumber(documentData?.settings?.gridSize, 120),
      snap: clampNumber(documentData?.settings?.snap, 0.25),
      snapEnabled: documentData?.settings?.snapEnabled === true,
      snapMode: ["grid", "surface", "vertex", "object"].includes(documentData?.settings?.snapMode) ? documentData.settings.snapMode : "grid",
      camera: documentData?.settings?.camera || {
        position: { x: 24, y: 20, z: 32 }, target: { x: 0, y: 2, z: 0 },
      },
      runtime: normalizeRuntimeSettings(documentData?.settings?.runtime),
    },
    objects: normalizedObjects,
    ui: (Array.isArray(documentData?.ui) ? documentData.ui : []).map(normalizeUiElement),
    logic: documentLogic,
  };
  if (!state.document.logic.graphs.some((graph) => graph.id === state.selectedLogicGraphId)) {
    state.selectedLogicGraphId = state.document.logic.graphs[0]?.id || null;
  }
  state.selectedLogicNodeId = null;
  state.logicConnecting = null;

  if (!preserveHistory) {
    state.undo.length = 0;
    state.redo.length = 0;
    updateHistoryButtons();
  }

  $("scene-name").value = state.document.name;
  $("snap-toggle").checked = state.document.settings.snapEnabled;
  $("snap-mode").value = state.document.settings.snapMode;
  $("snap-step").value = state.document.settings.snap;
  renderRuntimeSettings();
  updateSnap();
  const background = new THREE.Color(state.document.settings.background);
  scene.background = background;
  scene.fog.color.copy(background);
  const cameraState = state.document.settings.camera;
  camera.position.set(cameraState.position.x, cameraState.position.y, cameraState.position.z);
  orbit.target.set(cameraState.target.x, cameraState.target.y, cameraState.target.z);
  orbit.update();

  renderHierarchy();
  await Promise.all(normalizedObjects.map((record) => createEditorObject(record, generation)));
  if (generation !== state.loadGeneration) return;
  rebuildHierarchy();
  refreshEditorVisibility();
  updateEditorLightingRig();
  renderHierarchy();
  renderUiElements();
  renderUiPreview();
  renderLogicSummary();
  if (state.logicMode) renderLogicEditor();
  renderInspector();
  updateClipboardButtons();
  updateViewportStats();
  updatePivotUi();
  updateIsolationUi();
  markDirty(dirty);
  setStatus(`${state.document.name} carregada`);
}

async function addRecord(record, { select = true, checkpoint = true } = {}) {
  const before = checkpoint ? serializeScene() : null;
  const normalized = normalizeRecord(record);
  while (state.document.objects.some((item) => item.id === normalized.id)) normalized.id = uid(normalized.source.kind);
  state.document.objects.push(normalized);
  renderHierarchy();
  await createEditorObject(normalized);
  if (normalized.parentId && state.objects.has(normalized.parentId)) {
    state.objects.get(normalized.parentId).add(state.objects.get(normalized.id));
    applyRecordTransform(normalized, state.objects.get(normalized.id));
  }
  if (checkpoint) pushHistorySnapshot(before);
  if (select) {
    setSelection(normalized.id);
    focusSelection();
  }
  updateViewportStats();
  return normalized;
}

async function addGroup() {
  await addRecord({
    id: uid("group"),
    name: "Novo grupo",
    source: { kind: "group", asset: "" },
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    color: "#8bd5f7",
  });
  setStatus("Grupo adicionado");
}

async function addCollider(shape) {
  const labels = { box: "Colisor caixa", sphere: "Colisor esfera", capsule: "Colisor cápsula" };
  await addRecord({
    id: uid("collider"),
    name: labels[shape] || "Colisor",
    source: { kind: "collider", collider: shape, asset: "" },
    position: { x: orbit.target.x, y: 1, z: orbit.target.z },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    color: "#68e0b2",
    collider: { trigger: false, cameraBlocker: true },
  });
  setStatus(`${labels[shape]} adicionado`);
}

async function addLight(type) {
  const labels = { ambient: "Luz ambiente", directional: "Luz direcional", point: "Luz pontual" };
  const position = type === "ambient"
    ? orbit.target.clone()
    : orbit.target.clone().add(type === "directional" ? new THREE.Vector3(6, 8, 6) : new THREE.Vector3(0, 4, 0));
  const rotation = new THREE.Euler();
  if (type === "directional") {
    const helper = new THREE.Object3D();
    helper.position.copy(position);
    helper.lookAt(orbit.target);
    rotation.setFromQuaternion(helper.quaternion, "XYZ");
  }
  await addRecord({
    id: uid("light"),
    name: labels[type] || "Luz",
    source: { kind: "light", light: type, asset: "" },
    position: { x: position.x, y: position.y, z: position.z },
    rotation: {
      x: THREE.MathUtils.radToDeg(rotation.x),
      y: THREE.MathUtils.radToDeg(rotation.y),
      z: THREE.MathUtils.radToDeg(rotation.z),
    },
    scale: { x: 1, y: 1, z: 1 },
    color: "#ffc15c",
    light: {
      type,
      color: type === "ambient" ? "#8db9d1" : "#fff1cf",
      intensity: type === "ambient" ? 0.45 : 2,
      distance: 12,
      castShadow: type !== "ambient",
      flicker: false,
      flickerAmount: 0.24,
      flickerSpeed: 7.5,
    },
  });
  updateEditorLightingRig();
  setStatus(`${labels[type]} adicionada`);
}

async function addCamera() {
  const rotation = new THREE.Euler().setFromQuaternion(camera.quaternion, "XYZ");
  const active = !state.document.objects.some((record) => record.source.kind === "camera" && record.camera?.active);
  const record = await addRecord({
    id: uid("camera"),
    name: active ? "Câmera principal" : "Nova câmera",
    source: { kind: "camera", asset: "" },
    position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    rotation: {
      x: THREE.MathUtils.radToDeg(rotation.x),
      y: THREE.MathUtils.radToDeg(rotation.y),
      z: THREE.MathUtils.radToDeg(rotation.z),
    },
    scale: { x: 1, y: 1, z: 1 },
    color: "#57cef5",
    camera: { fov: camera.fov, near: 0.1, far: 500, active, mode: "follow" },
  });
  openCameraPreview(record.id);
  setStatus("Câmera adicionada a partir da visão atual");
}

async function addSpawnPoint() {
  const isDefault = !state.document.objects.some((record) => record.source.kind === "spawn" && record.spawn?.default);
  await addRecord({
    id: uid("spawn"),
    name: isDefault ? "Entrada principal" : "Novo ponto de entrada",
    source: { kind: "spawn", asset: "" },
    position: { x: orbit.target.x, y: 0.08, z: orbit.target.z },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    color: isDefault ? "#ffc15c" : "#57cef5",
    spawn: { default: isDefault },
  });
  setStatus(isDefault ? "Entrada principal adicionada" : "Ponto de entrada adicionado");
}

async function addScenePortal() {
  const targetScene = state.scenes.find((entry) => entry.id !== state.activeSceneId);
  const targetSpawn = targetScene?.spawnPoints?.find((entry) => entry.default) || targetScene?.spawnPoints?.[0];
  await addRecord({
    id: uid("portal"),
    name: "Portal de cena",
    source: { kind: "collider", collider: "box", asset: "" },
    position: { x: orbit.target.x, y: 1.5, z: orbit.target.z },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 0.9, y: 1.5, z: 0.3 },
    color: "#ffad66",
    collider: { trigger: true, cameraBlocker: false },
    portal: {
      enabled: Boolean(targetScene),
      targetSceneId: targetScene?.id || "",
      targetSpawnId: targetSpawn?.id || "",
      activation: "onEnter",
      fadeFrames: 30,
      condition: { enabled: false, variableId: "", operator: "eq", value: false },
    },
  });
  setStatus(targetScene ? "Portal adicionado · escolha a cena e a entrada no inspector" : "Portal adicionado · crie outra cena para definir o destino");
}

async function addCheckpoint() {
  await addRecord({
    id: uid("checkpoint"),
    name: "Checkpoint",
    source: { kind: "collider", collider: "box", asset: "" },
    position: { x: orbit.target.x, y: 1, z: orbit.target.z },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1.25, y: 1, z: 1.25 },
    color: "#62c6ff",
    collider: { trigger: true, cameraBlocker: false },
    checkpoint: { enabled: true, activation: "onEnter", autosave: true },
  });
  setStatus("Checkpoint adicionado · o progresso será salvo ao entrar");
}

async function addAudio() {
  const firstAudio = state.audioFiles[0]?.path || "";
  const mode = firstAudio.toLowerCase().endsWith(".adp") ? "sfx" : "stream";
  await addRecord({
    id: uid("audio"),
    name: "Nova fonte de áudio",
    source: { kind: "audio", asset: firstAudio },
    position: { x: orbit.target.x, y: 1.2, z: orbit.target.z },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    color: "#78d8ba",
    audio: { mode, autoplay: true, loop: true, volume: 80, spatial: mode === "sfx", distance: 14, pan: 0, pitch: 0 },
  });
  setStatus(firstAudio ? "Fonte de áudio adicionada" : "Fonte adicionada · importe WAV, OGG ou ADP");
}

function particleDefaults(preset) {
  if (preset === "smoke") return { preset, color: particlePresetHex(preset), autoplay: true, maxParticles: 5, rate: 3.5, lifetime: 150, speed: 0.018, spread: 0.55, size: 0.24, gravity: -0.00015 };
  if (preset === "sparks") return { preset, color: particlePresetHex(preset), autoplay: true, maxParticles: 8, rate: 10, lifetime: 48, speed: 0.045, spread: 0.2, size: 0.08, gravity: 0.0018 };
  return { preset: "fire", color: particlePresetHex("fire"), autoplay: true, maxParticles: 6, rate: 8, lifetime: 70, speed: 0.035, spread: 0.4, size: 0.16, gravity: -0.0004 };
}

async function addParticle(preset) {
  const labels = { fire: "Emissor de fogo", smoke: "Emissor de fumaça", sparks: "Emissor de faíscas" };
  await addRecord({
    id: uid("particle"),
    name: labels[preset] || "Emissor de partículas",
    source: { kind: "particle", asset: "" },
    position: { x: orbit.target.x, y: 0.3, z: orbit.target.z },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    color: "#ff9c58",
    particle: particleDefaults(preset),
  });
  setStatus(`${labels[preset]} adicionado`);
}

async function addShadow() {
  await addRecord({
    id: uid("shadow"),
    name: "Projetor de sombra",
    source: { kind: "shadow", asset: "" },
    position: { x: orbit.target.x, y: 0.03, z: orbit.target.z },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    color: "#000000",
    shadow: {
      width: 2.5,
      height: 2.5,
      gridX: 6,
      gridZ: 6,
      lightDirection: { x: 0, y: 1, z: 1 },
      bias: -0.02,
      lightOffset: 1,
      color: "#000000",
      opacity: 0.65,
      blend: "darken",
      followPlayer: true,
    },
  });
  setStatus("Projetor adicionado · selecione uma textura PNG, JPG ou BMP");
}

function primitiveLabel(kind) {
  return { cube: "Cubo", sphere: "Esfera", cylinder: "Cilindro", cone: "Cone", plane: "Plano" }[kind] || "Primitiva";
}

async function addPrimitive(kind) {
  const asset = `editor_primitives/${kind}.obj`;
  await addRecord({
    id: uid(kind),
    name: primitiveLabel(kind),
    source: { kind: "primitive", primitive: kind, asset },
    position: { x: orbit.target.x, y: kind === "plane" ? 0 : 1, z: orbit.target.z },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    color: "#8bd5f7",
  });
  setStatus(`${primitiveLabel(kind)} adicionado`);
}

async function addAssetToScene(asset) {
  await addRecord({
    id: uid("model"),
    name: fileName(asset).replace(/\.[^.]+$/, ""),
    source: { kind: "model", asset },
    position: { x: orbit.target.x, y: 0, z: orbit.target.z },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  });
  setStatus(`${fileName(asset)} adicionado`);
}

function selectionClosure() {
  const ids = new Set(state.selectedIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of state.document.objects) {
      if (record.parentId && ids.has(record.parentId) && !ids.has(record.id)) {
        ids.add(record.id);
        changed = true;
      }
    }
  }
  return ids;
}

function copySelection() {
  if (!state.selectedIds.size) return;
  syncAllRecords();
  const closure = selectionClosure();
  const objects = state.document.objects.filter((record) => closure.has(record.id)).map((record) => {
    const copy = deepClone(record);
    if (!record.parentId || !closure.has(record.parentId)) {
      const world = recordWorldTransform(record);
      copy.parentId = null;
      copy.position = world.position;
      copy.rotation = world.rotation;
      copy.scale = world.scale;
    }
    return copy;
  });
  state.clipboard = {
    version: 1,
    copiedAt: new Date().toISOString(),
    objects,
    selectedIds: [...state.selectedIds].filter((id) => closure.has(id)),
  };
  state.pasteCount = 0;
  try {
    localStorage.setItem("athena-visual-editor-clipboard", JSON.stringify(state.clipboard));
  } catch {
    // The in-memory clipboard remains available if local storage is disabled.
  }
  updateClipboardButtons();
  const count = state.selectedIds.size;
  setStatus(`${count} objeto${count === 1 ? " copiado" : "s copiados"}`);
  toast(`${count} objeto${count === 1 ? " copiado" : "s copiados"}. Use Ctrl+V para colar.`);
}

async function pasteClipboard() {
  if (!state.clipboard?.objects?.length) restoreClipboard();
  const clipboard = state.clipboard;
  if (!clipboard?.objects?.length) {
    toast("A área de transferência está vazia.", "error");
    return;
  }

  const before = serializeScene();
  state.pasteCount += 1;
  const offset = state.pasteCount;
  const idMap = new Map(clipboard.objects.map((record) => [record.id, uid(record.source?.kind || "object")]));
  const selectedSourceIds = new Set(clipboard.selectedIds || []);
  const pastedSelectedIds = [];
  const rootIds = [];

  for (const source of clipboard.objects) {
    const record = deepClone(source);
    record.id = idMap.get(source.id);
    record.parentId = source.parentId && idMap.has(source.parentId) ? idMap.get(source.parentId) : null;
    if (!record.parentId) {
      record.position.x += offset;
      record.position.z += offset;
      rootIds.push(record.id);
    }
    if (selectedSourceIds.has(source.id)) {
      record.name = `${source.name} cópia`;
      pastedSelectedIds.push(record.id);
    }
    await addRecord(record, { select: false, checkpoint: false });
  }

  rebuildHierarchy();
  pushHistorySnapshot(before);
  const selection = pastedSelectedIds.length ? pastedSelectedIds : rootIds;
  state.selectedIds = new Set(selection);
  state.primaryId = selection.at(-1) || null;
  setSelection(state.primaryId, { additive: true });
  focusSelection();
  setStatus(`${clipboard.objects.length} objeto${clipboard.objects.length === 1 ? " colado" : "s colados"}`);
}

async function duplicateSelection() {
  if (!state.selectedIds.size) return;
  const before = serializeScene();
  const closure = selectionClosure();
  const originals = state.document.objects.filter((record) => closure.has(record.id));
  const idMap = new Map(originals.map((record) => [record.id, uid(record.source.kind)]));
  const newIds = [];
  for (const original of originals) {
    const duplicate = deepClone(original);
    duplicate.id = idMap.get(original.id);
    duplicate.name = state.selectedIds.has(original.id) ? `${original.name} cópia` : original.name;
    duplicate.parentId = original.parentId && idMap.has(original.parentId) ? idMap.get(original.parentId) : original.parentId;
    duplicate.prefabId = original.prefabId;
    if (!duplicate.parentId || !idMap.has(original.parentId)) {
      duplicate.position.x += 1;
      duplicate.position.z += 1;
    }
    await addRecord(duplicate, { select: false, checkpoint: false });
    if (state.selectedIds.has(original.id)) newIds.push(duplicate.id);
  }
  pushHistorySnapshot(before);
  state.selectedIds = new Set(newIds);
  state.primaryId = newIds.at(-1) || null;
  setSelection(state.primaryId, { additive: true });
  focusSelection();
}

function deleteSelection() {
  if (!state.selectedIds.size) return;
  const before = serializeScene();
  const closure = selectionClosure();
  if (state.previewCameraId && closure.has(state.previewCameraId)) closeCameraPreview();
  const names = selectedRecords().map((item) => item.name);
  transform.detach();
  const topLevel = [...closure].filter((id) => {
    const parentId = recordById(id)?.parentId;
    return !parentId || !closure.has(parentId);
  });
  for (const id of topLevel) {
    const object = state.objects.get(id);
    if (object) {
      object.parent?.remove(object);
      disposeObject(object);
    }
  }
  for (const id of closure) state.objects.delete(id);
  state.document.objects = state.document.objects.filter((item) => !closure.has(item.id));
  state.selectedIds.clear();
  state.primaryId = null;
  selectionBox.visible = false;
  pushHistorySnapshot(before);
  renderHierarchy();
  renderInspector();
  updateClipboardButtons();
  updateViewportStats();
  updateEditorLightingRig();
  setStatus(`${names.length > 1 ? `${names.length} objetos excluídos` : `${names[0]} excluído`}`);
}

async function undo() {
  if (!state.undo.length) return;
  const current = serializeScene();
  const previous = state.undo.pop();
  state.redo.push(current);
  updateHistoryButtons();
  await loadDocument(JSON.parse(previous), { preserveHistory: true, dirty: true });
  setStatus("Alteração desfeita");
}

async function redo() {
  if (!state.redo.length) return;
  const current = serializeScene();
  const next = state.redo.pop();
  state.undo.push(current);
  updateHistoryButtons();
  await loadDocument(JSON.parse(next), { preserveHistory: true, dirty: true });
  setStatus("Alteração refeita");
}

function updatePrimitiveColor(record, object) {
  if (!["primitive", "collider"].includes(record.source.kind) || !object) return;
  object.traverse((child) => {
    if (child.isMesh && child.material?.color) child.material.color.set(record.color);
  });
}

function updateMaterialFromInspector() {
  const record = currentRecord();
  if (!record?.material) return;
  stageFieldHistory();
  record.material.color = $("material-color").value;
  record.material.texture = $("material-texture").value;
  record.material.opacity = THREE.MathUtils.clamp(clampNumber($("material-opacity").value, 1), 0, 1);
  record.material.roughness = THREE.MathUtils.clamp(clampNumber($("material-roughness").value, 0.72), 0, 1);
  record.material.metalness = THREE.MathUtils.clamp(clampNumber($("material-metalness").value, 0), 0, 1);
  record.material.emissive = $("material-emissive").value;
  record.material.emissiveIntensity = Math.max(0, clampNumber($("material-emissive-intensity").value, 0));
  record.material.unlit = $("material-unlit").checked;
  record.material.doubleSided = $("material-double-sided").checked;
  record.material.textureMapping = $("material-texture-mapping").checked;
  record.material.smoothShading = $("material-smooth-shading").checked;
  record.material.accurateClipping = $("material-accurate-clipping").checked;
  record.color = record.material.color;
  applyRecordMaterial(record);
  markDirty();
}

function updateAnimationFromInspector() {
  const record = currentRecord();
  const object = currentObject();
  if (!record?.animation || !object) return;
  stageFieldHistory();
  record.animation.clip = $("animation-clip").value;
  record.animation.autoplay = $("animation-autoplay").checked;
  record.animation.loop = $("animation-loop").checked;
  configureEditorAnimation(record, object);
  markDirty();
}

function updateLightFromInspector() {
  const record = currentRecord();
  if (!record?.light) return;
  stageFieldHistory();
  record.light.type = $("light-type").value;
  record.source.light = record.light.type;
  record.light.color = $("light-color").value;
  record.light.intensity = Math.max(0, clampNumber($("light-intensity").value, 1));
  record.light.distance = Math.max(0.1, clampNumber($("light-distance").value, 12));
  record.light.castShadow = $("light-cast-shadow").checked;
  record.light.flicker = $("light-flicker").checked;
  record.light.flickerAmount = THREE.MathUtils.clamp(clampNumber($("light-flicker-amount").value, 0.24), 0, 1);
  record.light.flickerSpeed = THREE.MathUtils.clamp(clampNumber($("light-flicker-speed").value, 7.5), 0.1, 40);
  rebuildLightVisual(record);
  $("light-distance-row").hidden = record.light.type !== "point";
  markDirty();
}

function applyCampfirePreset() {
  const record = currentRecord();
  if (!record?.light) return;
  const before = serializeScene();
  Object.assign(record.light, {
    type: "point",
    color: "#ff9a45",
    intensity: 2.8,
    distance: 8,
    castShadow: false,
    flicker: true,
    flickerAmount: 0.28,
    flickerSpeed: 7.5,
  });
  record.source.light = "point";
  rebuildLightVisual(record);
  pushHistorySnapshot(before);
  renderInspector();
  setStatus("Preset de fogueira aplicado à luz pontual");
}

function updateCameraFromInspector() {
  const record = currentRecord();
  if (!record?.camera) return;
  stageFieldHistory();
  record.camera.mode = $("camera-mode").value;
  record.camera.fov = THREE.MathUtils.clamp(clampNumber($("camera-fov").value, 52), 15, 120);
  record.camera.near = Math.max(0.01, clampNumber($("camera-near").value, 0.1));
  record.camera.far = Math.max(record.camera.near + 0.1, clampNumber($("camera-far").value, 500));
  rebuildCameraVisual(record);
  markDirty();
}

function updateAudioFromInspector() {
  const record = currentRecord();
  if (!record?.audio) return;
  stageFieldHistory();
  record.source.asset = $("audio-asset").value;
  record.audio.mode = record.source.asset
    ? (record.source.asset.toLowerCase().endsWith(".adp") ? "sfx" : "stream")
    : $("audio-mode").value;
  record.audio.autoplay = $("audio-autoplay").checked;
  record.audio.loop = $("audio-loop").checked;
  record.audio.volume = Math.round(THREE.MathUtils.clamp(clampNumber($("audio-volume").value, 80), 0, 100));
  record.audio.spatial = $("audio-spatial").checked;
  record.audio.distance = THREE.MathUtils.clamp(clampNumber($("audio-distance").value, 14), 0.1, 500);
  record.audio.pan = Math.round(THREE.MathUtils.clamp(clampNumber($("audio-pan").value), -100, 100));
  record.audio.pitch = Math.round(THREE.MathUtils.clamp(clampNumber($("audio-pitch").value), -100, 100));
  rebuildAudioVisual(record);
  markDirty();
}

function updateParticleFromInspector() {
  const record = currentRecord();
  if (!record?.particle) return;
  stageFieldHistory();
  const previousPreset = record.particle.preset;
  const nextPreset = $("particle-preset").value;
  const usedPresetColor = record.particle.color.toLowerCase() === particlePresetHex(previousPreset);
  record.particle.preset = nextPreset;
  record.particle.color = usedPresetColor && nextPreset !== previousPreset
    ? particlePresetHex(nextPreset)
    : $("particle-color").value;
  $("particle-color").value = record.particle.color;
  record.particle.autoplay = $("particle-autoplay").checked;
  record.particle.maxParticles = Math.round(THREE.MathUtils.clamp(clampNumber($("particle-max").value, 6), 1, 8));
  record.particle.rate = THREE.MathUtils.clamp(clampNumber($("particle-rate").value, 8), 0.1, 30);
  record.particle.lifetime = Math.round(THREE.MathUtils.clamp(clampNumber($("particle-lifetime").value, 70), 8, 360));
  record.particle.speed = THREE.MathUtils.clamp(clampNumber($("particle-speed").value, 0.035), 0, 0.25);
  record.particle.spread = THREE.MathUtils.clamp(clampNumber($("particle-spread").value, 0.65), 0, 5);
  record.particle.size = THREE.MathUtils.clamp(clampNumber($("particle-size").value, 0.16), 0.01, 2);
  record.particle.gravity = THREE.MathUtils.clamp(clampNumber($("particle-gravity").value, -0.0004), -0.05, 0.05);
  rebuildParticleVisual(record);
  markDirty();
}

function updateShadowFromInspector() {
  const record = currentRecord();
  if (!record?.shadow) return;
  stageFieldHistory();
  record.source.asset = $("shadow-texture").value;
  record.shadow.width = THREE.MathUtils.clamp(clampNumber($("shadow-width").value, 2.5), 0.1, 100);
  record.shadow.height = THREE.MathUtils.clamp(clampNumber($("shadow-height").value, 2.5), 0.1, 100);
  record.shadow.gridX = Math.round(THREE.MathUtils.clamp(clampNumber($("shadow-grid-x").value, 6), 2, 32));
  record.shadow.gridZ = Math.round(THREE.MathUtils.clamp(clampNumber($("shadow-grid-z").value, 6), 2, 32));
  record.shadow.lightDirection = {
    x: clampNumber($("shadow-light-x").value),
    y: clampNumber($("shadow-light-y").value, 1),
    z: clampNumber($("shadow-light-z").value, 1),
  };
  record.shadow.bias = THREE.MathUtils.clamp(clampNumber($("shadow-bias").value, -0.02), -1, 1);
  record.shadow.lightOffset = THREE.MathUtils.clamp(clampNumber($("shadow-offset").value, 1), -100, 100);
  record.shadow.color = $("shadow-color").value;
  record.shadow.opacity = THREE.MathUtils.clamp(clampNumber($("shadow-opacity").value, 0.65), 0, 1);
  record.shadow.blend = $("shadow-blend").value;
  record.shadow.followPlayer = $("shadow-follow-player").checked;
  rebuildShadowVisual(record);
  applyShadowTexture(record);
  markDirty();
}

function setActiveCamera(id, active) {
  const record = recordById(id);
  if (!record?.camera) return;
  const before = serializeScene();
  for (const candidate of state.document.objects) {
    if (candidate.source.kind !== "camera") continue;
    candidate.camera.active = active && candidate.id === id;
    rebuildCameraVisual(candidate);
  }
  pushHistorySnapshot(before);
  renderHierarchy();
  renderInspector();
  setStatus(active ? `${record.name} definida como câmera principal` : "Câmera principal removida");
}

function rebuildColliderVisual(record) {
  const object = state.objects.get(record.id);
  if (!object || record.source.kind !== "collider") return;
  for (const child of [...object.children]) {
    if (!child.userData.editorContent) continue;
    object.remove(child);
    disposeObject(child);
  }
  const content = createCollider(record);
  content.userData.editorContent = true;
  object.add(content);
  refreshSelectionVisuals();
}

function rebuildSpawnPointVisual(record) {
  const object = state.objects.get(record.id);
  if (!object || record.source.kind !== "spawn") return;
  for (const child of [...object.children]) {
    if (!child.userData.editorContent) continue;
    object.remove(child);
    disposeObject(child);
  }
  const content = createSpawnPointObject(record);
  content.userData.editorContent = true;
  object.add(content);
  refreshSelectionVisuals();
}

function colliderComponentColor(record) {
  if (record.portal?.enabled) return "#ffad66";
  if (record.checkpoint?.enabled) return "#62c6ff";
  return record.collider?.trigger ? "#ffad66" : "#68e0b2";
}

function updatePortalFromInspector({ resetSpawn = false, resetConditionValue = false } = {}) {
  const record = currentRecord();
  if (!record || record.source.kind !== "collider") return;
  stageFieldHistory();
  record.portal ||= {};
  record.portal.enabled = $("portal-enabled").checked;
  record.portal.targetSceneId = $("portal-scene").value;
  if (resetSpawn) {
    const points = projectSpawnPoints(record.portal.targetSceneId);
    record.portal.targetSpawnId = (points.find((point) => point.default) || points[0])?.id || "";
  } else {
    record.portal.targetSpawnId = $("portal-spawn").value;
  }
  record.portal.activation = $("portal-activation").value;
  record.portal.fadeFrames = Math.round(THREE.MathUtils.clamp(clampNumber($("portal-fade").value, 30), 1, 300));
  record.portal.condition ||= {};
  record.portal.condition.enabled = $("portal-condition-enabled").checked;
  record.portal.condition.variableId = $("portal-condition-variable").value;
  record.portal.condition.operator = $("portal-condition-operator").value;
  const conditionVariable = state.globalVariables.find((item) => item.id === record.portal.condition.variableId);
  if (resetConditionValue) {
    record.portal.condition.value = conditionVariable?.initialValue ?? false;
  } else if (conditionVariable?.type === "boolean") {
    record.portal.condition.value = $("portal-condition-value").checked;
  } else if (conditionVariable?.type === "number") {
    record.portal.condition.value = clampNumber($("portal-condition-value").value);
  } else {
    record.portal.condition.value = $("portal-condition-value").value;
  }
  if (record.portal.enabled && !record.collider.trigger) {
    record.collider.trigger = true;
  }
  record.color = colliderComponentColor(record);
  rebuildColliderVisual(record);
  finishFieldHistory();
  markDirty();
  renderInspector();
}

function updateCheckpointFromInspector() {
  const record = currentRecord();
  if (!record || record.source.kind !== "collider") return;
  stageFieldHistory();
  record.checkpoint ||= {};
  record.checkpoint.enabled = $("checkpoint-enabled").checked;
  record.checkpoint.activation = $("checkpoint-activation").value;
  record.checkpoint.autosave = $("checkpoint-autosave").checked;
  if (record.checkpoint.enabled) {
    record.collider.trigger = true;
    record.collider.cameraBlocker = false;
  }
  record.color = colliderComponentColor(record);
  rebuildColliderVisual(record);
  finishFieldHistory();
  markDirty();
  renderInspector();
}

function updateTransformFromInspector() {
  const record = currentRecord();
  const object = currentObject();
  if (!record || !object || isRecordEffectivelyLocked(record)) return;
  stageFieldHistory();
  record.position = {
    x: clampNumber($("position-x").value), y: clampNumber($("position-y").value), z: clampNumber($("position-z").value),
  };
  record.rotation = {
    x: clampNumber($("rotation-x").value), y: clampNumber($("rotation-y").value), z: clampNumber($("rotation-z").value),
  };
  record.scale = {
    x: clampNumber($("scale-x").value, 1), y: clampNumber($("scale-y").value, 1), z: clampNumber($("scale-z").value, 1),
  };
  applyRecordTransform(record, object);
  refreshSelectionVisuals();
  markDirty();
}

function resetTransform() {
  const record = currentRecord();
  const object = currentObject();
  if (!record || !object || isRecordEffectivelyLocked(record)) return;
  const before = serializeScene();
  record.position = { x: 0, y: 0, z: 0 };
  record.rotation = { x: 0, y: 0, z: 0 };
  record.scale = { x: 1, y: 1, z: 1 };
  applyRecordTransform(record, object);
  pushHistorySnapshot(before);
  renderInspector();
  refreshSelectionVisuals();
}

function replaceEditorContent(record, factory) {
  const object = state.objects.get(record.id);
  if (!object) return null;
  for (const child of [...object.children]) {
    if (!child.userData.editorContent) continue;
    object.remove(child);
    disposeObject(child);
  }
  const content = factory(record);
  content.userData.editorContent = true;
  object.add(content);
  object.userData.previewCamera = content.userData.previewCamera || null;
  object.userData.editorLight = content.userData.editorLight || null;
  object.userData.editorParticleRoot = record.source.kind === "particle" ? content : null;
  refreshSelectionVisuals();
  return object;
}

function rebuildLightVisual(record) {
  if (record.source.kind !== "light") return;
  replaceEditorContent(record, createLightObject);
  updateEditorLightingRig();
}

function rebuildCameraVisual(record) {
  if (record.source.kind !== "camera") return;
  replaceEditorContent(record, createCameraObject);
}

function rebuildAudioVisual(record) {
  if (record.source.kind !== "audio") return;
  replaceEditorContent(record, createAudioObject);
}

function rebuildParticleVisual(record) {
  if (record.source.kind !== "particle") return;
  replaceEditorContent(record, createParticleObject);
}

function rebuildShadowVisual(record) {
  if (record.source.kind !== "shadow") return;
  replaceEditorContent(record, createShadowObject);
}

function setBoxSelectTool(active) {
  state.boxSelectTool = active;
  state.boxSelecting = false;
  state.boxSelectStart = null;
  selectionMarquee.hidden = true;
  viewport.classList.toggle("box-select-mode", active);
  $("box-select-button").classList.toggle("active", active);
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("active", !active && button.dataset.mode === state.transformMode);
  });
  orbit.mouseButtons.LEFT = active ? null : THREE.MOUSE.ROTATE;
  if (active) {
    state.pivotEditing = false;
    transform.detach();
    setStatus("Seleção por caixa — arraste na viewport; Ctrl adiciona ou remove");
  } else if (!state.rightHandActive) {
    setSelection(state.primaryId, { additive: true });
  }
  updatePivotUi();
}

function togglePivotEditing() {
  if (!transformSelectionIds().length) {
    toast("Selecione ao menos um objeto visível e desbloqueado.", "error");
    return;
  }
  if (state.boxSelectTool) setBoxSelectTool(false);
  state.pivotCustom = true;
  state.pivotEditing = !state.pivotEditing;
  if (state.pivotEditing && !Number.isFinite(state.pivotPosition.x)) {
    updateSelectionBounds();
    state.pivotPosition.copy(selectionBounds.getCenter(new THREE.Vector3()));
  }
  setSelection(state.primaryId, { additive: true });
  setStatus(state.pivotEditing
    ? "Editando pivô — mova o gizmo e clique em Concluir"
    : "Pivô personalizado ativo para a seleção");
}

function resetPivotToCenter() {
  state.pivotCustom = false;
  state.pivotEditing = false;
  if (updateSelectionBounds()) state.pivotPosition.copy(selectionBounds.getCenter(new THREE.Vector3()));
  setSelection(state.primaryId, { additive: true });
  setStatus("Pivô restaurado ao centro da seleção");
}

function setTransformMode(mode) {
  if (state.boxSelectTool) setBoxSelectTool(false);
  state.pivotEditing = false;
  state.transformMode = mode;
  orbit.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
  orbit.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  transform.setMode(mode);
  if (!state.rightHandActive) setSelection(state.primaryId, { additive: true });
  document.querySelectorAll("[data-mode]").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
  $("box-select-button").classList.remove("active");
  updatePivotUi();
  setStatus({ translate: "Ferramenta mover", rotate: "Ferramenta rotacionar", scale: "Ferramenta escala" }[mode]);
}

function beginRightHand() {
  if (state.rightHandActive) return;
  state.rightHandActive = true;
  transform.detach();
  viewport.classList.add("pan-mode", "panning");
  setStatus("Mão temporária — solte o botão direito para voltar");
}

function endRightHand() {
  if (!state.rightHandActive) return;
  state.rightHandActive = false;
  viewport.classList.remove("pan-mode", "panning");
  setSelection(state.primaryId, { additive: true });
  setStatus(state.boxSelectTool
    ? "Seleção por caixa — arraste na viewport"
    : ({ translate: "Ferramenta mover", rotate: "Ferramenta rotacionar", scale: "Ferramenta escala" }[state.transformMode]));
}

function toggleTransformSpace() {
  state.transformSpace = state.transformSpace === "world" ? "local" : "world";
  transform.setSpace(state.transformSpace);
  $("space-button").textContent = state.transformSpace === "world" ? "Global" : "Local";
}

function updateSnap() {
  const enabled = $("snap-toggle").checked;
  const mode = $("snap-mode").value;
  const value = Math.max(0.01, clampNumber($("snap-step").value, state.document?.settings.snap || 0.25));
  state.snapMode = mode;
  $("snap-step").disabled = mode !== "grid";
  $("snap-step").value = value;
  if (state.document) {
    state.document.settings.snap = value;
    state.document.settings.snapEnabled = enabled;
    state.document.settings.snapMode = mode;
  }
  transform.setTranslationSnap(enabled && mode === "grid" ? value : null);
  transform.setRotationSnap(enabled ? THREE.MathUtils.degToRad(15) : null);
  transform.setScaleSnap(enabled ? 0.1 : null);
  setStatus(enabled
    ? `Snap ativo: ${{ grid: `grade ${value}`, surface: "superfície", vertex: "vértice", object: "centro do objeto" }[mode]}`
    : "Snap desativado");
}

function editorIdFromObject(object) {
  let current = object;
  while (current && current !== editorRoot) {
    if (current.userData.editorId) return current.userData.editorId;
    current = current.parent;
  }
  return null;
}

function closestHitVertex(hit) {
  const position = hit.object.geometry?.getAttribute?.("position");
  if (!position || !hit.face) return hit.point.clone();
  const candidates = [hit.face.a, hit.face.b, hit.face.c]
    .filter((index) => Number.isInteger(index) && index < position.count)
    .map((index) => new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(hit.object.matrixWorld));
  if (!candidates.length) return hit.point.clone();
  candidates.sort((a, b) => a.distanceToSquared(hit.point) - b.distanceToSquared(hit.point));
  return candidates[0];
}

function snapPointFromPointer(event) {
  pointerCoordinates(event);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(editorRoot.children, true);
  for (const hit of hits) {
    if (hit.object.userData.editorVisual) continue;
    const id = editorIdFromObject(hit.object);
    if (!id || state.selectedIds.has(id) || [...state.selectedIds].some((selectedId) => isDescendant(id, selectedId))) continue;
    const record = recordById(id);
    if (!record || !isRecordEffectivelyVisible(record)) continue;
    if (state.snapMode === "vertex") return closestHitVertex(hit);
    if (state.snapMode === "object") {
      const object = state.objects.get(id);
      const bounds = object ? new THREE.Box3().setFromObject(object, true) : null;
      if (bounds && !bounds.isEmpty()) return bounds.getCenter(new THREE.Vector3());
    }
    return hit.point.clone();
  }
  return null;
}

function applyPointerSnap(event) {
  if (!transform.dragging || transform.getMode() !== "translate" || !$("snap-toggle").checked || state.snapMode === "grid") return false;
  const point = snapPointFromPointer(event);
  const target = transform.object;
  if (!point || !target?.parent) return false;
  target.parent.updateMatrixWorld(true);
  target.position.copy(target.parent.worldToLocal(point.clone()));
  target.updateMatrixWorld(true);
  transform.dispatchEvent({ type: "objectChange" });
  setStatus(`Snap em ${{ vertex: "vértice", surface: "superfície", object: "objeto" }[state.snapMode]}: ${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)}`);
  return true;
}

function focusSelection() {
  if (!updateSelectionBounds()) return;
  const sphere = selectionBounds.getBoundingSphere(new THREE.Sphere());
  const direction = camera.position.clone().sub(orbit.target).normalize();
  const distance = Math.max(sphere.radius * 2.8, 3);
  orbit.target.copy(sphere.center);
  camera.position.copy(sphere.center).add(direction.multiplyScalar(distance));
  camera.near = Math.max(0.01, distance / 1000);
  camera.far = Math.max(500, distance * 30);
  camera.updateProjectionMatrix();
  orbit.update();
}

function setView(view) {
  const target = state.selectedIds.size && updateSelectionBounds()
    ? selectionBounds.getCenter(new THREE.Vector3())
    : orbit.target.clone();
  const distance = Math.max(camera.position.distanceTo(orbit.target), 25);
  camera.up.set(0, 1, 0);
  if (view === "top") {
    camera.up.set(0, 0, -1);
    camera.position.copy(target).add(new THREE.Vector3(0, distance, 0.001));
  } else if (view === "front") {
    camera.position.copy(target).add(new THREE.Vector3(0, 0, distance));
  } else if (view === "side") {
    camera.position.copy(target).add(new THREE.Vector3(distance, 0, 0));
  } else {
    camera.position.copy(target).add(new THREE.Vector3(distance * 0.62, distance * 0.48, distance * 0.72));
  }
  orbit.target.copy(target);
  orbit.update();
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  $("viewport").querySelector(".viewport-label").textContent = ({ top: "SUPERIOR", front: "FRONTAL", side: "LATERAL" }[view] || "PERSPECTIVA");
}

const axisDirections = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};
const axisCameraQuaternion = new THREE.Quaternion();
const axisScreenDirection = new THREE.Vector3();

function placeAxisNode(axis, direction) {
  const radius = 38;
  const x = 64 + direction.x * radius;
  const y = 64 - direction.y * radius;
  const positive = document.querySelector(`[data-axis-view="${axis}"]`);
  const negative = document.querySelector(`[data-axis-view="-${axis}"]`);
  positive.style.left = `${x}px`;
  positive.style.top = `${y}px`;
  positive.style.zIndex = direction.z >= 0 ? 4 : 2;
  positive.style.opacity = direction.z >= 0 ? "1" : "0.58";
  negative.style.left = `${128 - x}px`;
  negative.style.top = `${128 - y}px`;
  negative.style.zIndex = direction.z < 0 ? 4 : 2;
  negative.style.opacity = direction.z < 0 ? "0.88" : "0.38";

  const line = $(`axis-line-${axis}`);
  line.setAttribute("x1", 128 - x);
  line.setAttribute("y1", 128 - y);
  line.setAttribute("x2", x);
  line.setAttribute("y2", y);
}

function updateAxisGizmo() {
  axisCameraQuaternion.copy(camera.quaternion).invert();
  for (const [axis, direction] of Object.entries(axisDirections)) {
    axisScreenDirection.copy(direction).applyQuaternion(axisCameraQuaternion);
    placeAxisNode(axis, axisScreenDirection);
  }
}

function setAxisView(axisName) {
  const negative = axisName.startsWith("-");
  const axis = negative ? axisName.slice(1) : axisName;
  const direction = axisDirections[axis].clone().multiplyScalar(negative ? -1 : 1);
  const distance = Math.max(camera.position.distanceTo(orbit.target), 0.5);
  const labels = {
    x: "LATERAL +X", "-x": "LATERAL -X",
    y: "SUPERIOR +Y", "-y": "INFERIOR -Y",
    z: "FRONTAL +Z", "-z": "TRASEIRA -Z",
  };

  camera.up.set(0, 1, 0);
  if (axis === "y") camera.up.set(0, 0, negative ? 1 : -1);
  camera.position.copy(orbit.target).add(direction.multiplyScalar(distance));
  orbit.update();
  document.querySelectorAll("[data-view]").forEach((button) => {
    const activeView = !negative && ({ x: "side", y: "top", z: "front" }[axis]);
    button.classList.toggle("active", button.dataset.view === activeView);
  });
  viewport.querySelector(".viewport-label").textContent = labels[axisName];
  setStatus(`${labels[axisName]} — clique em outro eixo para trocar a visão`);
}

let cameraPreviewRenderer = null;

function ensureCameraPreviewRenderer() {
  if (cameraPreviewRenderer) return cameraPreviewRenderer;
  cameraPreviewRenderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power" });
  cameraPreviewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  cameraPreviewRenderer.outputColorSpace = THREE.SRGBColorSpace;
  cameraPreviewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  cameraPreviewRenderer.toneMappingExposure = renderer.toneMappingExposure;
  cameraPreviewRenderer.shadowMap.enabled = true;
  cameraPreviewRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
  $("camera-preview-canvas").append(cameraPreviewRenderer.domElement);
  return cameraPreviewRenderer;
}

function openCameraPreview(id = state.primaryId) {
  const record = recordById(id);
  if (!record || record.source.kind !== "camera") return;
  try {
    ensureCameraPreviewRenderer();
  } catch (error) {
    toast(`Preview indisponível: ${error.message}`, "error");
    return;
  }
  state.previewCameraId = id;
  $("camera-preview").hidden = false;
  $("camera-preview-name").textContent = record.name;
  setStatus(`Preview aberto: ${record.name}`);
}

function closeCameraPreview() {
  state.previewCameraId = null;
  $("camera-preview").hidden = true;
}

function cameraRecordAndObject(id = state.previewCameraId || state.primaryId) {
  const record = recordById(id);
  const object = state.objects.get(id);
  if (!record || record.source.kind !== "camera" || !object?.userData.previewCamera) return null;
  return { record, object, previewCamera: object.userData.previewCamera };
}

function enterCameraView(id = state.previewCameraId || state.primaryId) {
  const entry = cameraRecordAndObject(id);
  if (!entry) return;
  const position = entry.previewCamera.getWorldPosition(new THREE.Vector3());
  const quaternion = entry.previewCamera.getWorldQuaternion(new THREE.Quaternion());
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
  camera.position.copy(position);
  camera.quaternion.copy(quaternion);
  camera.fov = entry.record.camera.fov;
  camera.near = entry.record.camera.near;
  camera.far = entry.record.camera.far;
  camera.updateProjectionMatrix();
  orbit.target.copy(position).add(forward.multiplyScalar(10));
  orbit.update();
  viewport.querySelector(".viewport-label").textContent = `CÂMERA · ${entry.record.name.toUpperCase()}`;
  setStatus(`Visão da câmera ${entry.record.name}`);
}

function renderCameraPreview() {
  if (!state.previewCameraId || $("camera-preview").hidden || !cameraPreviewRenderer) return;
  const entry = cameraRecordAndObject(state.previewCameraId);
  if (!entry || !isRecordEffectivelyVisible(entry.record)) {
    closeCameraPreview();
    return;
  }
  const container = $("camera-preview-canvas");
  const width = Math.max(1, container.clientWidth);
  const height = Math.max(1, container.clientHeight);
  cameraPreviewRenderer.setSize(width, height, false);
  entry.previewCamera.aspect = 640 / 448;
  entry.previewCamera.fov = entry.record.camera.fov;
  entry.previewCamera.near = entry.record.camera.near;
  entry.previewCamera.far = entry.record.camera.far;
  entry.previewCamera.updateProjectionMatrix();
  entry.previewCamera.updateMatrixWorld(true);

  const hidden = [];
  editorRoot.traverse((object) => {
    if (object.userData.editorVisual && object.visible) {
      hidden.push(object);
      object.visible = false;
    }
  });
  const visibility = [grid.visible, axes.visible, selectionBox.visible, transformHelper.visible];
  grid.visible = false;
  axes.visible = false;
  selectionBox.visible = false;
  transformHelper.visible = false;
  cameraPreviewRenderer.render(scene, entry.previewCamera);
  [grid.visible, axes.visible, selectionBox.visible, transformHelper.visible] = visibility;
  for (const object of hidden) object.visible = true;
}

function renderSceneProject(project = null) {
  if (project) {
    state.scenes = Array.isArray(project.scenes) ? project.scenes : [];
    state.activeSceneId = project.activeSceneId || state.scenes[0]?.id || null;
    state.startupSceneId = project.startupSceneId || state.activeSceneId;
    state.globalVariables = normalizeLogic({ variables: project.variables, graphs: [] }, uid).variables;
  }
  const picker = $("scene-picker");
  picker.replaceChildren();
  for (const entry of state.scenes) {
    picker.append(new Option(`${entry.id === state.startupSceneId ? "★ " : ""}${entry.name}`, entry.id));
  }
  picker.value = state.activeSceneId || "";
  picker.disabled = state.sceneProjectBusy;
  const startupEntry = state.scenes.find((entry) => entry.id === state.startupSceneId);
  picker.title = startupEntry?.name
    ? `Cena inicial: ${startupEntry.name}`
    : "Cena atual";
  $("run-button").title = startupEntry?.name
    ? `Empacotar e testar a cena inicial: ${startupEntry.name}`
    : "Empacotar e testar no PS2";
  $("new-scene-button").disabled = state.sceneProjectBusy;
  $("save-button").disabled = state.sceneProjectBusy;
  $("delete-scene-button").disabled = state.sceneProjectBusy || state.scenes.length <= 1;
  $("duplicate-scene-button").disabled = state.sceneProjectBusy || !state.activeSceneId;
  $("scene-manager-export-button").disabled = state.sceneProjectBusy;
  renderSceneManager();
}

function sceneCountLabel(count, singular, plural = `${singular}s`) {
  const value = Math.max(0, Number(count) || 0);
  return `${value} ${value === 1 ? singular : plural}`;
}

function renderSceneManager() {
  const list = $("scene-manager-list");
  if (!list) return;
  list.replaceChildren();
  const startup = state.scenes.find((entry) => entry.id === state.startupSceneId);
  $("scene-manager-summary").textContent = `${state.scenes.length} cena${state.scenes.length === 1 ? "" : "s"} no projeto · inicial: ${startup?.name || "não definida"}`;

  state.scenes.forEach((entry, index) => {
    const row = document.createElement("article");
    row.className = "scene-manager-item";
    row.classList.toggle("active", entry.id === state.activeSceneId);
    row.classList.toggle("startup", entry.id === state.startupSceneId);
    row.setAttribute("role", "listitem");

    const order = document.createElement("div");
    order.className = "scene-order-actions";
    const up = document.createElement("button");
    up.type = "button";
    up.textContent = "↑";
    up.title = "Mover para cima";
    up.disabled = state.sceneProjectBusy || index === 0;
    up.addEventListener("click", () => moveProjectScene(entry.id, -1));
    const down = document.createElement("button");
    down.type = "button";
    down.textContent = "↓";
    down.title = "Mover para baixo";
    down.disabled = state.sceneProjectBusy || index === state.scenes.length - 1;
    down.addEventListener("click", () => moveProjectScene(entry.id, 1));
    order.append(up, down);

    const info = document.createElement("div");
    info.className = "scene-manager-info";
    const nameRow = document.createElement("div");
    nameRow.className = "scene-manager-name-row";
    const name = document.createElement("input");
    name.className = "scene-manager-name";
    name.value = entry.name;
    name.maxLength = 120;
    name.disabled = state.sceneProjectBusy;
    name.setAttribute("aria-label", `Nome da cena ${entry.name}`);
    name.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        name.blur();
      } else if (event.key === "Escape") {
        name.value = entry.name;
        name.blur();
      }
    });
    name.addEventListener("change", () => renameProjectScene(entry.id, name.value));
    nameRow.append(name);
    if (entry.id === state.activeSceneId) {
      const badge = document.createElement("span");
      badge.className = "scene-manager-badge";
      badge.textContent = "aberta";
      nameRow.append(badge);
    }
    const meta = document.createElement("div");
    meta.className = "scene-manager-meta";
    const updated = new Date(entry.updatedAt);
    const updatedLabel = Number.isNaN(updated.getTime()) ? "data desconhecida" : updated.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
    meta.textContent = [
      sceneCountLabel(entry.objectCount, "objeto"),
      sceneCountLabel(entry.uiCount, "item de UI", "itens de UI"),
      sceneCountLabel(entry.graphCount, "grafo"),
      updatedLabel,
    ].join(" · ");
    info.append(nameRow, meta);

    const startupButton = document.createElement("button");
    startupButton.type = "button";
    startupButton.className = "scene-startup-button";
    startupButton.classList.toggle("is-startup", entry.id === state.startupSceneId);
    startupButton.textContent = entry.id === state.startupSceneId ? "★ Inicial" : "Definir inicial";
    startupButton.disabled = state.sceneProjectBusy || entry.id === state.startupSceneId;
    startupButton.addEventListener("click", () => setStartupProjectScene(entry.id));

    const actions = document.createElement("div");
    actions.className = "scene-manager-row-actions";
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = entry.id === state.activeSceneId ? "Aberta" : "Editar";
    open.disabled = state.sceneProjectBusy || entry.id === state.activeSceneId;
    open.addEventListener("click", async () => {
      if (await switchProjectScene(entry.id)) $("scene-manager-dialog").close();
    });
    const duplicate = document.createElement("button");
    duplicate.type = "button";
    duplicate.textContent = "Duplicar";
    duplicate.disabled = state.sceneProjectBusy;
    duplicate.addEventListener("click", () => createProjectScene({ duplicate: true, duplicateFrom: entry.id }));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "Excluir";
    remove.disabled = state.sceneProjectBusy || state.scenes.length <= 1;
    remove.addEventListener("click", () => deleteProjectScene(entry.id));
    actions.append(open, duplicate, remove);

    row.append(order, info, startupButton, actions);
    list.append(row);
  });
}

async function saveDirtySceneBeforeNavigation() {
  if (!state.dirty) return true;
  const saved = await saveScene({ quiet: true, allowProjectOperation: true });
  if (saved) toast("Alterações salvas antes de trocar de cena.", "success", 2200);
  return saved;
}

async function withSceneProjectUiLock(label, operation) {
  if (state.sceneProjectBusy) return null;
  state.sceneProjectBusy = true;
  setLoading(1, label);
  renderSceneProject();
  try {
    return await operation();
  } finally {
    state.sceneProjectBusy = false;
    setLoading(-1);
    renderSceneProject();
  }
}

async function switchProjectScene(sceneId) {
  if (!sceneId || sceneId === state.activeSceneId) return true;
  return (await withSceneProjectUiLock("Trocando de cena…", async () => {
    if (!await saveDirtySceneBeforeNavigation()) return false;
    try {
      const response = await fetch(`/api/scenes/${encodeURIComponent(sceneId)}/activate`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Falha ao trocar de cena");
      renderSceneProject(result.project);
      await loadDocument(result.scene);
      toast(`${result.scene.name} aberta para edição.`, "success");
      return true;
    } catch (error) {
      toast(error.message, "error");
      return false;
    }
  })) === true;
}

async function createProjectScene({ duplicate = false, duplicateFrom = null } = {}) {
  if (state.sceneProjectBusy) return;
  const currentName = state.document?.name || "Cena";
  const sourceEntry = state.scenes.find((entry) => entry.id === (duplicateFrom || state.activeSceneId));
  const suggested = duplicate ? `${sourceEntry?.name || currentName} — cópia` : "Nova cena";
  const name = window.prompt("Nome da cena:", suggested)?.trim();
  if (!name) return;
  await withSceneProjectUiLock(duplicate ? "Duplicando cena…" : "Criando cena…", async () => {
    if (!await saveDirtySceneBeforeNavigation()) return;
    try {
      const response = await fetch("/api/scenes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, ...(duplicate ? { duplicateFrom: duplicateFrom || state.activeSceneId } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Falha ao criar a cena");
      renderSceneProject(result.project);
      await loadDocument(result.scene);
      toast(duplicate ? "Cena duplicada e ativada." : "Cena criada e ativada.", "success");
    } catch (error) {
      toast(error.message, "error");
    }
  });
}

async function deleteProjectScene(sceneId = state.activeSceneId) {
  if (state.sceneProjectBusy) return;
  const id = typeof sceneId === "string" ? sceneId : state.activeSceneId;
  const entry = state.scenes.find((item) => item.id === id);
  if (!entry || state.scenes.length <= 1) return;
  if (!window.confirm(`Excluir a cena “${entry.name}”? Uma cópia de segurança será arquivada.`)) return;
  await withSceneProjectUiLock("Excluindo cena…", async () => {
    try {
      const deletingActiveScene = entry.id === state.activeSceneId;
      if (deletingActiveScene) await saveQueue;
      const response = await fetch(`/api/scenes/${encodeURIComponent(entry.id)}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Falha ao excluir a cena");
      renderSceneProject(result.project);
      if (deletingActiveScene) await loadDocument(result.scene);
      toast("Cena excluída e cópia de segurança arquivada.", "success");
    } catch (error) {
      toast(error.message, "error");
    }
  });
}

async function setStartupProjectScene(sceneId) {
  if (sceneId === state.startupSceneId || state.sceneProjectBusy) return;
  await withSceneProjectUiLock("Atualizando cena inicial...", async () => {
    try {
      if (!await saveDirtySceneBeforeNavigation()) return;
      const response = await fetch(`/api/scenes/${encodeURIComponent(sceneId)}/startup`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Falha ao definir a cena inicial");
      renderSceneProject(result.project);
      const entry = state.scenes.find((item) => item.id === sceneId);
      toast(`${entry?.name || "Cena"} será aberta ao iniciar o jogo.`, "success");
    } catch (error) {
      toast(error.message, "error");
    }
  });
}

async function renameProjectScene(sceneId, requestedName) {
  if (state.sceneProjectBusy) return;
  const entry = state.scenes.find((item) => item.id === sceneId);
  const name = String(requestedName || "").trim().slice(0, 120);
  if (!entry || !name || name === entry.name) {
    renderSceneManager();
    return;
  }
  await withSceneProjectUiLock("Renomeando cena…", async () => {
    try {
      if (sceneId === state.activeSceneId) {
        state.document.name = name;
        $("scene-name").value = name;
        markDirty();
        if (!await saveScene({ quiet: true, allowProjectOperation: true })) throw new Error("Não foi possível salvar o novo nome");
      } else {
        const response = await fetch(`/api/scenes/${encodeURIComponent(sceneId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Falha ao renomear a cena");
        renderSceneProject(result.project);
      }
      toast("Cena renomeada.", "success", 2200);
    } catch (error) {
      toast(error.message, "error");
    }
  });
}

async function moveProjectScene(sceneId, direction) {
  if (state.sceneProjectBusy) return;
  const index = state.scenes.findIndex((entry) => entry.id === sceneId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= state.scenes.length) return;
  const order = state.scenes.map((entry) => entry.id);
  [order[index], order[target]] = [order[target], order[index]];
  await withSceneProjectUiLock("Reordenando cenas…", async () => {
    try {
      const response = await fetch("/api/scenes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Falha ao reordenar as cenas");
      renderSceneProject(result.project);
    } catch (error) {
      toast(error.message, "error");
    }
  });
}

async function exportSceneProjectFile() {
  if (state.sceneProjectBusy) return;
  await withSceneProjectUiLock("Exportando projeto…", async () => {
    if (!await saveDirtySceneBeforeNavigation()) return;
    try {
      const response = await fetch("/api/project/export", { cache: "no-store" });
      const project = await response.json();
      if (!response.ok) throw new Error(project.error || "Falha ao exportar o projeto");
      const blob = new Blob([`${JSON.stringify(project, null, 2)}\n`], { type: "application/json" });
      const anchor = document.createElement("a");
      anchor.href = URL.createObjectURL(blob);
      anchor.download = "athena-project.json";
      anchor.click();
      URL.revokeObjectURL(anchor.href);
      toast("Projeto completo exportado.", "success");
    } catch (error) {
      toast(error.message, "error");
    }
  });
}

async function performSceneSave({ quiet = false } = {}) {
  if (state.serverOutdated) {
    const message = "Servidor do editor desatualizado. Reinicie scripts/editor.ps1 antes de salvar as novas ferramentas.";
    toast(message, "error", 10000);
    setStatus("Reinicie o servidor do editor");
    return false;
  }
  try {
    if (!state.dirty) return true;
    for (let attempt = 0; attempt < 4; attempt++) {
      syncAllRecords();
      saveCameraToDocument();
      state.document.name = $("scene-name").value.trim() || "Cena Athena";
      state.document.logic.variables = state.globalVariables.map((variable) => ({ ...variable }));
      const revision = state.documentRevision;
      const loadGeneration = state.loadGeneration;
      const sceneId = state.activeSceneId || "";
      const payload = JSON.stringify(state.document);
      const response = await fetch(`/api/scene?sceneId=${encodeURIComponent(sceneId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Falha ao salvar a cena");

      if (state.activeSceneId !== sceneId || state.loadGeneration !== loadGeneration) {
        throw new Error("A cena ativa mudou durante o salvamento; a resposta antiga foi descartada");
      }
      if (state.documentRevision !== revision) {
        setStatus("Novas alterações detectadas; salvando a versão mais recente...");
        continue;
      }

      renderSceneProject(result.project);
      state.document = result.scene;
      markDirty(false);
      setStatus("Cena salva e exportada para Athena");
      if (!quiet) toast("Cena salva. O runtime do PS2 foi atualizado.", "success");
      return true;
    }
    setStatus("A cena continuou mudando durante o salvamento");
    if (!quiet) toast("Ainda há alterações novas. Pare de editar por um instante e salve novamente.", "error", 5000);
    return false;
  } catch (error) {
    toast(error.message, "error", 5000);
    setStatus("Falha ao salvar");
    return false;
  }
}

function saveScene(options = {}) {
  if (state.sceneProjectBusy && options.allowProjectOperation !== true) {
    if (!options.quiet) toast("Aguarde a operação de cenas terminar antes de salvar.", "info", 2600);
    return Promise.resolve(false);
  }
  const queued = saveQueue.then(
    () => performSceneSave(options),
    () => performSceneSave(options),
  );
  saveQueue = queued.catch(() => false);
  return queued;
}

function exportSceneFile() {
  syncAllRecords();
  saveCameraToDocument();
  const blob = new Blob([`${JSON.stringify(state.document, null, 2)}\n`], { type: "application/json" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `${state.document.name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase() || "scene"}.json`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function importFiles(files) {
  const accepted = [...files].filter((file) => /\.(obj|mtl|gltf|glb|bin|png|jpe?g|bmp|ttf|otf|wav|ogg|adp|m2v|mpg|mpeg)$/i.test(file.name));
  if (!accepted.length) {
    toast("Nenhum modelo, material, imagem, fonte, áudio ou vídeo compatível foi selecionado.", "error");
    return;
  }
  setLoading(1, `Importando ${accepted.length} arquivo(s)…`);
  setStatus("Copiando arquivos para o projeto…");
  try {
    const payloadFiles = [];
    for (const file of accepted) {
      payloadFiles.push({
        name: file.name,
        relativePath: file.webkitRelativePath || file.name,
        data: await fileToBase64(file),
      });
    }
    const response = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: payloadFiles }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Falha na importação");
    await refreshAssetCatalog();
    for (let index = 0; index < result.models.length; index += 1) {
      const asset = result.models[index];
      await addRecord({
        id: uid("imported"),
        name: fileName(asset).replace(/\.[^.]+$/, ""),
        source: { kind: "model", asset },
        position: { x: orbit.target.x + index * 1.5, y: 0, z: orbit.target.z },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      }, { select: index === result.models.length - 1, checkpoint: true });
    }
    if (result.models.length) toast(`${result.models.length} modelo(s) importado(s).`, "success");
    else if (accepted.some((file) => /\.(wav|ogg|adp)$/i.test(file.name))) toast("Áudio importado e disponível nas fontes de áudio.", "success");
    else if (accepted.some((file) => /\.(m2v|mpg|mpeg)$/i.test(file.name))) toast("Vídeo MPEG importado e disponível na interface 2D.", "success");
    else if (accepted.some((file) => /\.(ttf|otf)$/i.test(file.name))) toast("Fonte importada e disponível nos textos da interface.", "success");
    else toast("Arquivos auxiliares importados; nenhum OBJ/GLTF/GLB encontrado.");
    setStatus("Importação concluída");
  } catch (error) {
    toast(error.message, "error", 6000);
    setStatus("Falha na importação");
  } finally {
    setLoading(-1);
    $("import-input").value = "";
  }
}

async function runInPcsx2() {
  const button = $("run-button");
  if (!await saveScene({ quiet: true })) return;
  button.classList.add("running");
  button.innerHTML = "<span>◌</span> Preparando…";
  try {
    const response = await fetch("/api/run", { method: "POST" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Não foi possível iniciar o PCSX2");
    toast("Projeto salvo. Empacotando e abrindo o PCSX2…");
    window.clearInterval(state.runPoll);
    state.runPoll = window.setInterval(async () => {
      try {
        const status = await fetch("/api/run/status", { cache: "no-store" }).then((item) => item.json());
        const lastLine = status.log?.at(-1);
        if (lastLine) setStatus(lastLine);
        if (!status.running) {
          window.clearInterval(state.runPoll);
          state.runPoll = null;
          button.classList.remove("running");
          button.innerHTML = "<span>▶</span> Testar no PS2";
          toast(status.ok ? "PCSX2 iniciado." : (lastLine || "Falha ao iniciar o PCSX2."), status.ok ? "success" : "error", 5000);
        }
      } catch {
        // A próxima consulta tentará novamente.
      }
    }, 700);
  } catch (error) {
    button.classList.remove("running");
    button.innerHTML = "<span>▶</span> Testar no PS2";
    toast(error.message, "error", 5000);
  }
}

function pointerCoordinates(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function marqueePoint(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  return {
    x: THREE.MathUtils.clamp(event.clientX - rect.left, 0, rect.width),
    y: THREE.MathUtils.clamp(event.clientY - rect.top, 0, rect.height),
  };
}

function updateMarquee(point) {
  const start = state.boxSelectStart;
  if (!start) return;
  selectionMarquee.style.left = `${Math.min(start.x, point.x)}px`;
  selectionMarquee.style.top = `${Math.min(start.y, point.y)}px`;
  selectionMarquee.style.width = `${Math.abs(point.x - start.x)}px`;
  selectionMarquee.style.height = `${Math.abs(point.y - start.y)}px`;
}

function projectedObjectRect(object, viewportRect) {
  const bounds = new THREE.Box3().setFromObject(object, true);
  if (bounds.isEmpty()) return null;
  const center = bounds.getCenter(new THREE.Vector3()).applyMatrix4(camera.matrixWorldInverse);
  if (center.z >= 0) return null;
  const points = [];
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const point = new THREE.Vector3(x, y, z).project(camera);
        points.push({
          x: (point.x * 0.5 + 0.5) * viewportRect.width,
          y: (-point.y * 0.5 + 0.5) * viewportRect.height,
        });
      }
    }
  }
  return {
    left: Math.min(...points.map((point) => point.x)),
    right: Math.max(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    bottom: Math.max(...points.map((point) => point.y)),
  };
}

function finishBoxSelection(event) {
  const end = marqueePoint(event);
  const start = state.boxSelectStart;
  state.boxSelecting = false;
  state.boxSelectStart = null;
  selectionMarquee.hidden = true;
  orbit.enabled = true;
  if (!start) return;

  const area = {
    left: Math.min(start.x, end.x), right: Math.max(start.x, end.x),
    top: Math.min(start.y, end.y), bottom: Math.max(start.y, end.y),
  };
  const viewportRect = renderer.domElement.getBoundingClientRect();
  const hits = [];
  camera.updateMatrixWorld(true);
  for (const record of state.document.objects) {
    if (!isRecordEffectivelyVisible(record) || isRecordEffectivelyLocked(record)) continue;
    const object = state.objects.get(record.id);
    if (!object) continue;
    const projected = projectedObjectRect(object, viewportRect);
    if (!projected) continue;
    const intersects = projected.right >= area.left && projected.left <= area.right
      && projected.bottom >= area.top && projected.top <= area.bottom;
    if (intersects) hits.push(record.id);
  }

  const additive = event.ctrlKey || event.metaKey || event.shiftKey;
  const toggle = event.ctrlKey || event.metaKey;
  const next = additive ? new Set(state.selectedIds) : new Set();
  for (const id of hits) {
    if (toggle && next.has(id)) next.delete(id);
    else next.add(id);
  }
  state.selectedIds = next;
  state.primaryId = hits.filter((id) => next.has(id)).at(-1) || [...next].at(-1) || null;
  setSelection(state.primaryId, { additive: true });
  setStatus(`${next.size} objeto${next.size === 1 ? " selecionado" : "s selecionados"} pela caixa`);
}

function cancelBoxSelection() {
  state.boxSelecting = false;
  state.boxSelectStart = null;
  selectionMarquee.hidden = true;
  orbit.enabled = true;
}

let pointerStart = null;
renderer.domElement.addEventListener("pointerdown", (event) => {
  if (state.uiMode) return;
  pointerStart = { x: event.clientX, y: event.clientY };
  if (event.button === 2) beginRightHand();
  if (event.button === 0 && state.boxSelectTool) {
    state.boxSelecting = true;
    state.boxSelectStart = marqueePoint(event);
    selectionMarquee.hidden = false;
    updateMarquee(state.boxSelectStart);
    orbit.enabled = false;
    renderer.domElement.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }
});

renderer.domElement.addEventListener("pointerup", (event) => {
  if (state.uiMode) return;
  if (event.button === 2) {
    endRightHand();
    return;
  }
  if (event.button === 0 && state.boxSelecting) {
    renderer.domElement.releasePointerCapture?.(event.pointerId);
    finishBoxSelection(event);
    return;
  }
  if (!pointerStart || transform.dragging) return;
  const movement = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
  if (movement > 4) {
    document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === "perspective"));
    viewport.querySelector(".viewport-label").textContent = "PERSPECTIVA";
    return;
  }
  pointerCoordinates(event);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(editorRoot.children, true);
  let selected = null;
  for (const hit of hits) {
    let current = hit.object;
    while (current && current !== editorRoot) {
      if (current.userData.editorId) {
        selected = current.userData.editorId;
        break;
      }
      current = current.parent;
    }
    const record = selected ? recordById(selected) : null;
    if (record && isRecordEffectivelyVisible(record) && !isRecordEffectivelyLocked(record)) break;
    selected = null;
  }
  setSelection(selected, {
    additive: event.ctrlKey || event.metaKey || event.shiftKey,
    toggle: event.ctrlKey || event.metaKey,
  });
});
renderer.domElement.addEventListener("pointercancel", () => {
  endRightHand();
  cancelBoxSelection();
});
renderer.domElement.addEventListener("contextmenu", (event) => event.preventDefault());

renderer.domElement.addEventListener("pointermove", (event) => {
  if (state.uiMode) return;
  if (state.boxSelecting) {
    updateMarquee(marqueePoint(event));
    return;
  }
  if (applyPointerSnap(event)) return;
  pointerCoordinates(event);
  raycaster.setFromCamera(pointer, camera);
  const point = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(groundPlane, point)) {
    $("cursor-position").textContent = `X ${point.x.toFixed(2)} · Y 0.00 · Z ${point.z.toFixed(2)}`;
  }
});

transform.addEventListener("dragging-changed", (event) => {
  orbit.enabled = !event.value && !state.uiMode;
});

transform.addEventListener("mouseDown", () => {
  if (state.pivotEditing) {
    state.dragSnapshot = null;
    state.multiTransformStart = null;
    return;
  }
  state.dragSnapshot = serializeScene();
  if (transform.object === selectionPivot) {
    selectionPivot.updateMatrixWorld(true);
    const matrices = new Map();
    for (const id of transformSelectionIds()) {
      const object = state.objects.get(id);
      object.updateMatrixWorld(true);
      matrices.set(id, object.matrixWorld.clone());
    }
    state.multiTransformStart = {
      pivot: selectionPivot.matrixWorld.clone(),
      matrices,
    };
  }
});

transform.addEventListener("objectChange", () => {
  if (state.pivotEditing && transform.object === selectionPivot) {
    state.pivotPosition.copy(selectionPivot.position);
    updatePivotUi();
    setStatus(`Pivô: ${selectionPivot.position.x.toFixed(2)}, ${selectionPivot.position.y.toFixed(2)}, ${selectionPivot.position.z.toFixed(2)}`);
    return;
  }
  if (transform.object === selectionPivot && state.multiTransformStart) {
    selectionPivot.updateMatrixWorld(true);
    const delta = selectionPivot.matrixWorld.clone().multiply(state.multiTransformStart.pivot.clone().invert());
    for (const [id, startWorld] of state.multiTransformStart.matrices) {
      const object = state.objects.get(id);
      const record = recordById(id);
      if (!object || !record) continue;
      object.parent.updateMatrixWorld(true);
      const local = object.parent.matrixWorld.clone().invert().multiply(delta).multiply(startWorld);
      local.decompose(object.position, object.quaternion, object.scale);
      object.rotation.setFromQuaternion(object.quaternion, "XYZ");
      syncRecordFromObject(record, object);
    }
    renderInspector();
    refreshSelectionVisuals();
    markDirty();
    return;
  }
  const record = currentRecord();
  const object = currentObject();
  if (!record || !object) return;
  syncRecordFromObject(record, object);
  renderInspector();
  refreshSelectionVisuals();
  markDirty();
});

transform.addEventListener("mouseUp", () => {
  if (state.pivotEditing) {
    state.pivotPosition.copy(selectionPivot.position);
    setStatus("Pivô reposicionado — clique em Concluir para transformar os objetos");
    return;
  }
  pushHistorySnapshot(state.dragSnapshot);
  state.dragSnapshot = null;
  state.multiTransformStart = null;
  if (transform.object === selectionPivot || state.selectedIds.size > 1) {
    if (state.pivotCustom) state.pivotPosition.copy(selectionPivot.position);
    setSelection(state.primaryId, { additive: true });
  }
});

function updateUiFromInspector() {
  const item = currentUiElement();
  if (!item) return;
  item.name = $("ui-name").value.trim() || ({ panel: "Painel", text: "Texto", image: "Imagem", video: "Vídeo" })[item.type] || "Elemento";
  item.x = cleanNumber(THREE.MathUtils.clamp(clampNumber($("ui-x").value), 0, 640));
  item.y = cleanNumber(THREE.MathUtils.clamp(clampNumber($("ui-y").value), 0, 448));
  item.width = cleanNumber(THREE.MathUtils.clamp(clampNumber($("ui-width").value, 1), 1, 640 - item.x));
  item.height = cleanNumber(THREE.MathUtils.clamp(clampNumber($("ui-height").value, 1), 1, 448 - item.y));
  item.text = $("ui-text").value.slice(0, 240);
  item.fontAsset = $("ui-font-asset").value;
  item.fontScale = THREE.MathUtils.clamp(clampNumber($("ui-font-scale").value, 0.55), 0.15, 3);
  item.align = ["left", "center", "right"].includes($("ui-align").value) ? $("ui-align").value : "left";
  item.color = $("ui-color").value;
  item.outline = THREE.MathUtils.clamp(clampNumber($("ui-outline").value), 0, 8);
  item.outlineColor = $("ui-outline-color").value;
  item.dropshadow = item.outline > 0 ? 0 : THREE.MathUtils.clamp(clampNumber($("ui-dropshadow").value), 0, 16);
  item.dropshadowColor = $("ui-dropshadow-color").value;
  item.background = $("ui-background").value;
  item.opacity = THREE.MathUtils.clamp(clampNumber($("ui-opacity").value, 0.82), 0, 1);
  if (["image", "video"].includes(item.type)) {
    item.asset = $("ui-media-asset").value;
    item.opacity = THREE.MathUtils.clamp(clampNumber($("ui-media-opacity").value, 1), 0, 1);
    item.autoplay = $("ui-media-autoplay").checked;
    item.loop = $("ui-media-loop").checked;
  }
  item.visible = $("ui-visible").checked;
  item.runtime = $("ui-runtime").checked;
  renderUiElements();
  renderUiPreview();
  updateViewportStats();
  markDirty();
}

function bindInspector() {
  const transformInputIds = [
    "position-x", "position-y", "position-z",
    "rotation-x", "rotation-y", "rotation-z",
    "scale-x", "scale-y", "scale-z",
  ];
  for (const id of transformInputIds) {
    const input = $(id);
    input.addEventListener("beforeinput", stageFieldHistory);
    input.addEventListener("input", updateTransformFromInspector);
    input.addEventListener("change", finishFieldHistory);
    input.addEventListener("blur", finishFieldHistory);
  }

  $("object-name").addEventListener("beforeinput", stageFieldHistory);
  $("object-name").addEventListener("input", (event) => {
    const record = currentRecord();
    const object = currentObject();
    if (!record) return;
    stageFieldHistory();
    record.name = event.target.value || "Objeto";
    if (object) object.name = record.name;
    renderHierarchy();
    markDirty();
  });
  $("object-name").addEventListener("change", finishFieldHistory);
  $("object-name").addEventListener("blur", finishFieldHistory);

  $("object-color").addEventListener("input", (event) => {
    const record = currentRecord();
    if (!record) return;
    stageFieldHistory();
    record.color = event.target.value;
    updatePrimitiveColor(record, currentObject());
    markDirty();
  });
  $("object-color").addEventListener("change", finishFieldHistory);
  $("object-color").addEventListener("blur", finishFieldHistory);

  for (const [id, property] of [
    ["object-visible", "visible"], ["object-locked", "locked"], ["object-runtime", "runtime"],
    ["object-persistent", "persistent"],
  ]) {
    $(id).addEventListener("change", (event) => {
      const record = currentRecord();
      if (!record) return;
      stageFieldHistory();
      record[property] = event.target.checked;
      if (property === "visible") {
        applyEditorVisibility(record);
        if (record.source.kind === "light") updateEditorLightingRig();
      }
      finishFieldHistory();
      setSelection(record.id);
    });
  }

  $("object-parent").addEventListener("change", (event) => {
    const record = currentRecord();
    if (record) setParent(record.id, event.target.value || null);
  });

  $("collider-shape").addEventListener("change", (event) => {
    const record = currentRecord();
    if (!record || record.source.kind !== "collider") return;
    stageFieldHistory();
    record.source.collider = event.target.value;
    rebuildColliderVisual(record);
    finishFieldHistory();
    markDirty();
    renderInspector();
  });
  $("collider-trigger").addEventListener("change", (event) => {
    const record = currentRecord();
    if (!record || record.source.kind !== "collider") return;
    stageFieldHistory();
    record.collider.trigger = event.target.checked;
    if (!record.collider.trigger && record.portal?.enabled) record.portal.enabled = false;
    if (!record.collider.trigger && record.checkpoint?.enabled) record.checkpoint.enabled = false;
    record.color = colliderComponentColor(record);
    rebuildColliderVisual(record);
    finishFieldHistory();
    markDirty();
    renderInspector();
  });
  $("collider-camera").addEventListener("change", (event) => {
    const record = currentRecord();
    if (!record || record.source.kind !== "collider") return;
    stageFieldHistory();
    record.collider.cameraBlocker = event.target.checked;
    finishFieldHistory();
    markDirty();
  });
  $("portal-enabled").addEventListener("change", () => updatePortalFromInspector());
  $("portal-scene").addEventListener("change", () => updatePortalFromInspector({ resetSpawn: true }));
  for (const id of ["portal-spawn", "portal-activation", "portal-fade"]) {
    $(id).addEventListener("change", () => updatePortalFromInspector());
  }
  $("portal-condition-enabled").addEventListener("change", () => {
    if ($("portal-condition-enabled").checked && !$("portal-condition-variable").value && state.globalVariables.length) {
      $("portal-condition-variable").value = state.globalVariables[0].id;
      updatePortalFromInspector({ resetConditionValue: true });
    } else {
      updatePortalFromInspector();
    }
  });
  $("portal-condition-variable").addEventListener("change", () => updatePortalFromInspector({ resetConditionValue: true }));
  for (const id of ["portal-condition-operator", "portal-condition-value"]) {
    $(id).addEventListener("change", () => updatePortalFromInspector());
  }
  for (const id of ["checkpoint-enabled", "checkpoint-activation", "checkpoint-autosave"]) {
    $(id).addEventListener("change", updateCheckpointFromInspector);
  }
  $("spawn-default").addEventListener("change", (event) => {
    const record = currentRecord();
    if (!record || record.source.kind !== "spawn") return;
    const before = serializeScene();
    if (event.target.checked) {
      for (const candidate of state.document.objects) {
        if (candidate.source.kind !== "spawn") continue;
        candidate.spawn.default = candidate.id === record.id;
        candidate.color = candidate.spawn.default ? "#ffc15c" : "#57cef5";
        rebuildSpawnPointVisual(candidate);
      }
    } else {
      record.spawn.default = false;
      record.color = "#57cef5";
      rebuildSpawnPointVisual(record);
    }
    pushHistorySnapshot(before);
    markDirty();
    renderInspector();
  });
  $("event-action-type").addEventListener("change", updateEventDraftUi);
  $("event-scene").addEventListener("change", () => fillProjectSpawnSelect($("event-spawn"), $("event-scene").value, ""));
  $("event-add-button").addEventListener("click", addTriggerAction);
  $("event-convert-logic-button").addEventListener("click", convertTriggerActionsToLogic);

  for (const id of ["material-color", "material-opacity", "material-roughness", "material-metalness", "material-emissive", "material-emissive-intensity"]) {
    $(id).addEventListener("beforeinput", stageFieldHistory);
    $(id).addEventListener("input", updateMaterialFromInspector);
    $(id).addEventListener("change", finishFieldHistory);
    $(id).addEventListener("blur", finishFieldHistory);
  }
  for (const id of ["material-texture", "material-unlit", "material-double-sided", "material-texture-mapping", "material-smooth-shading", "material-accurate-clipping"]) {
    $(id).addEventListener("change", () => {
      updateMaterialFromInspector();
      finishFieldHistory();
    });
  }

  for (const id of ["animation-clip", "animation-autoplay", "animation-loop"]) {
    $(id).addEventListener("change", () => {
      updateAnimationFromInspector();
      finishFieldHistory();
    });
  }

  for (const id of ["light-color", "light-intensity", "light-distance", "light-flicker-amount", "light-flicker-speed"]) {
    $(id).addEventListener("beforeinput", stageFieldHistory);
    $(id).addEventListener("input", updateLightFromInspector);
    $(id).addEventListener("change", finishFieldHistory);
    $(id).addEventListener("blur", finishFieldHistory);
  }
  for (const id of ["light-type", "light-cast-shadow", "light-flicker"]) {
    $(id).addEventListener("change", () => {
      updateLightFromInspector();
      finishFieldHistory();
      renderInspector();
    });
  }
  $("light-campfire-preset").addEventListener("click", applyCampfirePreset);

  for (const id of ["camera-fov", "camera-near", "camera-far"]) {
    $(id).addEventListener("beforeinput", stageFieldHistory);
    $(id).addEventListener("input", updateCameraFromInspector);
    $(id).addEventListener("change", finishFieldHistory);
    $(id).addEventListener("blur", finishFieldHistory);
  }
  $("camera-mode").addEventListener("change", () => {
    updateCameraFromInspector();
    finishFieldHistory();
    renderInspector();
  });
  $("camera-active").addEventListener("change", (event) => setActiveCamera(state.primaryId, event.target.checked));
  $("camera-preview-button").addEventListener("click", () => openCameraPreview());
  $("camera-use-view-button").addEventListener("click", () => enterCameraView());

  for (const id of ["audio-volume", "audio-distance", "audio-pan", "audio-pitch"]) {
    $(id).addEventListener("beforeinput", stageFieldHistory);
    $(id).addEventListener("input", updateAudioFromInspector);
    $(id).addEventListener("change", () => { finishFieldHistory(); renderInspector(); });
    $(id).addEventListener("blur", finishFieldHistory);
  }
  $("audio-asset").addEventListener("change", () => {
    const asset = $("audio-asset").value.toLowerCase();
    $("audio-mode").value = asset.endsWith(".adp") ? "sfx" : "stream";
    updateAudioFromInspector();
    finishFieldHistory();
    renderInspector();
  });
  for (const id of ["audio-mode", "audio-autoplay", "audio-loop", "audio-spatial"]) {
    $(id).addEventListener("change", () => {
      updateAudioFromInspector();
      finishFieldHistory();
      renderInspector();
    });
  }

  for (const id of ["particle-color", "particle-max", "particle-rate", "particle-lifetime", "particle-speed", "particle-spread", "particle-size", "particle-gravity"]) {
    $(id).addEventListener("beforeinput", stageFieldHistory);
    $(id).addEventListener("input", updateParticleFromInspector);
    $(id).addEventListener("change", finishFieldHistory);
    $(id).addEventListener("blur", finishFieldHistory);
  }
  for (const id of ["particle-preset", "particle-autoplay"]) {
    $(id).addEventListener("change", () => {
      updateParticleFromInspector();
      finishFieldHistory();
      renderInspector();
    });
  }

  for (const id of ["shadow-width", "shadow-height", "shadow-grid-x", "shadow-grid-z", "shadow-light-x", "shadow-light-y", "shadow-light-z", "shadow-bias", "shadow-offset", "shadow-opacity"]) {
    $(id).addEventListener("beforeinput", stageFieldHistory);
    $(id).addEventListener("input", updateShadowFromInspector);
    $(id).addEventListener("change", finishFieldHistory);
    $(id).addEventListener("blur", finishFieldHistory);
  }
  for (const id of ["shadow-texture", "shadow-color", "shadow-blend", "shadow-follow-player"]) {
    $(id).addEventListener("change", () => {
      updateShadowFromInspector();
      finishFieldHistory();
    });
  }

  const uiFieldIds = [
    "ui-name", "ui-x", "ui-y", "ui-width", "ui-height", "ui-text",
    "ui-font-scale", "ui-align", "ui-color", "ui-outline", "ui-outline-color", "ui-dropshadow", "ui-dropshadow-color",
    "ui-background", "ui-opacity", "ui-media-opacity",
  ];
  for (const id of uiFieldIds) {
    $(id).addEventListener("beforeinput", stageFieldHistory);
    $(id).addEventListener("input", updateUiFromInspector);
    $(id).addEventListener("change", finishFieldHistory);
    $(id).addEventListener("blur", finishFieldHistory);
  }
  for (const id of ["ui-visible", "ui-runtime", "ui-font-asset", "ui-media-asset", "ui-media-autoplay", "ui-media-loop"]) {
    $(id).addEventListener("change", () => {
      stageFieldHistory();
      updateUiFromInspector();
      finishFieldHistory();
      renderUiInspector();
    });
  }
}

function bindUi() {
  document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => setTransformMode(button.dataset.mode)));
  document.querySelectorAll("[data-primitive]").forEach((button) => button.addEventListener("click", () => addPrimitive(button.dataset.primitive)));
  document.querySelectorAll("[data-collider]").forEach((button) => button.addEventListener("click", () => addCollider(button.dataset.collider)));
  document.querySelectorAll("[data-light]").forEach((button) => button.addEventListener("click", () => addLight(button.dataset.light)));
  document.querySelectorAll("[data-particle]").forEach((button) => button.addEventListener("click", () => addParticle(button.dataset.particle)));
  $("add-shadow-button").addEventListener("click", addShadow);
  $("add-spawn-button").addEventListener("click", addSpawnPoint);
  $("add-portal-button").addEventListener("click", addScenePortal);
  $("add-checkpoint-button").addEventListener("click", addCheckpoint);
  document.querySelectorAll("[data-ui-type]").forEach((button) => button.addEventListener("click", () => addUiElement(button.dataset.uiType)));
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  document.querySelectorAll("[data-axis-view]").forEach((button) => button.addEventListener("click", () => setAxisView(button.dataset.axisView)));

  $("space-button").addEventListener("click", toggleTransformSpace);
  $("box-select-button").addEventListener("click", () => setBoxSelectTool(!state.boxSelectTool));
  $("pivot-button").addEventListener("click", togglePivotEditing);
  $("pivot-reset-button").addEventListener("click", resetPivotToCenter);
  $("isolate-selection-button").addEventListener("click", () => toggleIsolation());
  for (const id of ["scene-background", "runtime-vsync", "runtime-performance", "runtime-arena-bounds", "player-spawn-x", "player-spawn-y", "player-spawn-z", "player-radius", "player-height", "player-walk-speed", "player-run-speed", "player-jump-speed", "player-gravity"]) {
    $(id).addEventListener("beforeinput", stageFieldHistory);
    $(id).addEventListener("input", updateRuntimeSettings);
    $(id).addEventListener("change", finishFieldHistory);
    $(id).addEventListener("blur", finishFieldHistory);
  }
  for (const id of ["snap-toggle", "snap-mode"]) {
    $(id).addEventListener("change", () => {
      const before = serializeScene();
      updateSnap();
      pushHistorySnapshot(before);
    });
  }
  $("snap-step").addEventListener("change", () => {
    const before = serializeScene();
    updateSnap();
    pushHistorySnapshot(before);
  });
  $("grid-button").addEventListener("click", () => {
    grid.visible = !grid.visible;
    axes.visible = grid.visible;
    $("grid-button").classList.toggle("active", grid.visible);
  });
  $("collider-visibility-button").addEventListener("click", () => {
    state.collidersVisible = !state.collidersVisible;
    refreshEditorVisibility();
    $("collider-visibility-button").classList.toggle("active", state.collidersVisible);
  });
  $("ui-mode-button").addEventListener("click", () => setUiMode(!state.uiMode));
  $("open-ui-editor-button").addEventListener("click", () => setUiMode(!state.uiMode));
  $("logic-mode-button").addEventListener("click", () => setLogicMode(!state.logicMode));
  $("open-logic-editor-button").addEventListener("click", () => setLogicMode(!state.logicMode));
  $("logic-close-button").addEventListener("click", () => setLogicMode(false));
  $("logic-new-graph-button").addEventListener("click", addLogicGraph);
  $("logic-duplicate-graph-button").addEventListener("click", duplicateLogicGraph);
  $("logic-delete-graph-button").addEventListener("click", deleteLogicGraph);
  $("logic-validate-button").addEventListener("click", validateVisualScripting);
  $("logic-graph-select").addEventListener("change", (event) => {
    state.selectedLogicGraphId = event.target.value || null;
    state.selectedLogicNodeId = null;
    state.logicConnecting = null;
    renderLogicEditor();
  });
  $("logic-graph-enabled").addEventListener("change", (event) => {
    const graph = currentLogicGraph();
    if (graph) logicCommit(() => { graph.enabled = event.target.checked; }, event.target.checked ? "Fluxo ativado" : "Fluxo desativado");
  });
  $("logic-cancel-connection-button").addEventListener("click", () => startLogicConnection(state.logicConnecting?.nodeId, state.logicConnecting?.port));
  $("logic-canvas").addEventListener("pointerdown", (event) => {
    if (event.target !== $("logic-canvas") && event.target !== $("logic-nodes") && event.target !== $("logic-links")) return;
    state.selectedLogicNodeId = null;
    renderLogicNodes();
    renderLogicProperties();
  });
  $("focus-button").addEventListener("click", focusSelection);
  $("save-button").addEventListener("click", () => saveScene());
  $("export-button").addEventListener("click", exportSceneFile);
  $("run-button").addEventListener("click", runInPcsx2);
  $("undo-button").addEventListener("click", undo);
  $("redo-button").addEventListener("click", redo);
  $("copy-button").addEventListener("click", copySelection);
  $("paste-button").addEventListener("click", pasteClipboard);
  $("duplicate-button").addEventListener("click", duplicateSelection);
  $("multi-duplicate-button").addEventListener("click", duplicateSelection);
  $("delete-button").addEventListener("click", deleteSelection);
  $("multi-delete-button").addEventListener("click", deleteSelection);
  $("ui-duplicate-button").addEventListener("click", duplicateUiElement);
  $("ui-delete-button").addEventListener("click", deleteUiElement);
  $("prefab-button").addEventListener("click", saveSelectionAsPrefab);
  $("multi-prefab-button").addEventListener("click", saveSelectionAsPrefab);
  $("create-prefab-button").addEventListener("click", saveSelectionAsPrefab);
  $("add-group-button").addEventListener("click", addGroup);
  $("add-camera-button").addEventListener("click", addCamera);
  $("add-audio-button").addEventListener("click", addAudio);
  $("camera-preview-close-button").addEventListener("click", closeCameraPreview);
  $("camera-enter-view-button").addEventListener("click", () => enterCameraView());
  $("confirm-prefab-button").addEventListener("click", (event) => {
    event.preventDefault();
    const name = $("prefab-name-input").value.trim();
    if (!name) return;
    $("prefab-dialog").close();
    saveSelectionAsPrefab(name);
  });
  $("reset-transform-button").addEventListener("click", resetTransform);
  $("hierarchy-search").addEventListener("input", renderHierarchy);
  $("asset-search").addEventListener("input", renderAssets);
  $("import-button").addEventListener("click", () => $("import-input").click());
  $("empty-import-button").addEventListener("click", () => $("import-input").click());
  $("import-input").addEventListener("change", (event) => importFiles(event.target.files));
  $("open-scene-button").addEventListener("click", () => $("open-scene-input").click());
  $("scene-picker").addEventListener("change", (event) => switchProjectScene(event.target.value));
  $("scene-manager-button").addEventListener("click", () => {
    renderSceneManager();
    $("scene-manager-dialog").showModal();
  });
  $("scene-manager-close-button").addEventListener("click", () => $("scene-manager-dialog").close());
  $("scene-manager-done-button").addEventListener("click", () => $("scene-manager-dialog").close());
  $("scene-manager-new-button").addEventListener("click", () => createProjectScene());
  $("scene-manager-duplicate-button").addEventListener("click", () => createProjectScene({ duplicate: true }));
  $("scene-manager-export-button").addEventListener("click", exportSceneProjectFile);
  $("duplicate-scene-button").addEventListener("click", () => createProjectScene({ duplicate: true }));
  $("delete-scene-button").addEventListener("click", deleteProjectScene);
  $("scene-root-row").addEventListener("dragover", (event) => {
    if (!event.dataTransfer.types.includes("text/athena-object")) return;
    event.preventDefault();
    $("scene-root-row").classList.add("drag-over");
  });
  $("scene-root-row").addEventListener("dragleave", () => $("scene-root-row").classList.remove("drag-over"));
  $("scene-root-row").addEventListener("drop", (event) => {
    $("scene-root-row").classList.remove("drag-over");
    const id = event.dataTransfer.getData("text/athena-object");
    if (id) {
      event.preventDefault();
      setParent(id, null);
    }
  });
  $("open-scene-input").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const before = serializeScene();
      await loadDocument(JSON.parse(await file.text()), { preserveHistory: true, dirty: true });
      state.undo.push(before);
      state.redo.length = 0;
      updateHistoryButtons();
      toast("Cena aberta. Salve para torná-la a cena ativa.", "success");
    } catch (error) {
      toast(`Cena inválida: ${error.message}`, "error");
    }
    event.target.value = "";
  });
  $("new-scene-button").addEventListener("click", () => createProjectScene());
  $("scene-name").addEventListener("beforeinput", stageFieldHistory);
  $("scene-name").addEventListener("input", (event) => {
    stageFieldHistory();
    if (state.document) state.document.name = event.target.value;
    markDirty();
  });
  $("scene-name").addEventListener("change", finishFieldHistory);
  $("scene-name").addEventListener("blur", finishFieldHistory);

  let dragDepth = 0;
  window.addEventListener("dragenter", (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    dragDepth += 1;
    $("drop-zone").hidden = false;
  });
  window.addEventListener("dragover", (event) => event.preventDefault());
  window.addEventListener("dragleave", (event) => {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) $("drop-zone").hidden = true;
  });
  window.addEventListener("drop", (event) => {
    event.preventDefault();
    dragDepth = 0;
    $("drop-zone").hidden = true;
    if (event.dataTransfer?.files.length) importFiles(event.dataTransfer.files);
  });

  window.addEventListener("keydown", (event) => {
    const editing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "");
    if (event.ctrlKey && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveScene();
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
      return;
    }
    if (editing) return;
    if (event.ctrlKey && event.key.toLowerCase() === "c") {
      event.preventDefault();
      copySelection();
    } else if (event.ctrlKey && event.key.toLowerCase() === "v") {
      event.preventDefault();
      pasteClipboard();
    } else if (event.ctrlKey && event.key.toLowerCase() === "d") {
      event.preventDefault();
      duplicateSelection();
    } else if ((event.key === "Delete" || event.key === "Backspace") && state.logicMode) {
      event.preventDefault();
      if (state.selectedLogicNodeId) deleteLogicNode(state.selectedLogicNodeId);
    } else if ((event.key === "Delete" || event.key === "Backspace") && state.uiMode) {
      event.preventDefault();
      deleteUiElement();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelection();
    } else if (state.logicMode && event.key === "Escape") setLogicMode(false);
    else if (state.uiMode && event.key === "Escape") setUiMode(false);
    else if (event.key.toLowerCase() === "w") setTransformMode("translate");
    else if (event.key.toLowerCase() === "e") setTransformMode("rotate");
    else if (event.key.toLowerCase() === "r") setTransformMode("scale");
    else if (event.key.toLowerCase() === "b") setBoxSelectTool(!state.boxSelectTool);
    else if (event.key === "/" || event.code === "NumpadDivide") {
      event.preventDefault();
      toggleIsolation();
    }
    else if (event.altKey && event.key.toLowerCase() === "h") {
      event.preventDefault();
      showAllObjects();
    }
    else if (event.key.toLowerCase() === "h") hideSelectedObjects();
    else if (event.key.toLowerCase() === "f") focusSelection();
    else if (event.key === "Escape") {
      if (state.boxSelectTool) setBoxSelectTool(false);
      else if (state.pivotEditing) togglePivotEditing();
      else if (state.isolatedIds) setIsolation(null);
      else setSelection(null);
    }
  });

  window.addEventListener("pointerup", (event) => {
    if (event.button === 2) endRightHand();
  });
  window.addEventListener("blur", () => {
    endRightHand();
    cancelBoxSelection();
  });

  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

function resize() {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
}

new ResizeObserver(resize).observe(viewport);

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  editorElapsedTime += delta;
  orbit.update(delta);
  for (const record of state.document?.objects || []) {
    if (record.source.kind !== "light" || record.light.type !== "point") continue;
    const light = state.objects.get(record.id)?.userData.editorLight;
    if (!light) continue;
    if (!record.light.flicker) {
      light.intensity = record.light.intensity;
      continue;
    }
    let seed = 0;
    for (let index = 0; index < record.id.length; index++) seed = (seed + record.id.charCodeAt(index) * (index + 1)) % 997;
    const time = editorElapsedTime * record.light.flickerSpeed;
    const wave = Math.sin(time * 1.11 + seed) * 0.52
      + Math.sin(time * 2.73 + seed * 0.37) * 0.31
      + Math.sin(time * 5.17 + seed * 0.13) * 0.17;
    light.intensity = record.light.intensity * Math.max(0.1, 1 + wave * record.light.flickerAmount);
  }
  for (const record of state.document?.objects || []) {
    if (record.source.kind !== "particle") continue;
    updateParticlePreviewObject(record, state.objects.get(record.id)?.userData.editorParticleRoot, delta);
  }
  for (const object of state.objects.values()) object.userData.animationMixer?.update(delta);
  if (selectionBox.visible) updateSelectionBounds();
  updateAxisGizmo();
  renderer.render(scene, camera);
  renderCameraPreview();
}

async function boot() {
  restoreLayoutState();
  setupPanelAccordions();
  bindInspector();
  bindUi();
  restoreClipboard();
  resize();
  animate();
  setLoading(1, "Abrindo cena…");
  try {
    const projectResponse = await fetch("/api/scenes", { cache: "no-store" });
    const project = await projectResponse.json();
    if (!projectResponse.ok) throw new Error(project.error || "Falha ao abrir o projeto de cenas");
    renderSceneProject(project);
    const [sceneResponse, capabilitiesResponse] = await Promise.all([
      fetch(`/api/scene?sceneId=${encodeURIComponent(state.activeSceneId || "")}`, { cache: "no-store" }),
      fetch("/api/capabilities", { cache: "no-store" }),
      refreshAssetCatalog(),
      refreshPrefabs(),
    ]);
    if (capabilitiesResponse.ok) {
      const capabilities = await capabilitiesResponse.json();
      state.serverSchemaVersion = Number(capabilities.editorSchemaVersion) || 0;
    }
    state.serverOutdated = state.serverSchemaVersion < 16;
    const data = await sceneResponse.json();
    if (!sceneResponse.ok) throw new Error(data.error || "Falha ao abrir a cena");
    await loadDocument(data);
    if (state.serverOutdated) {
      toast("Servidor desatualizado detectado. Reinicie scripts/editor.ps1 para usar visual scripting e os componentes atuais.", "error", 12000);
      setStatus("Servidor desatualizado — reinicie o editor");
    } else {
      toast("Editor pronto. Selecione um objeto para começar.", "success", 2800);
    }
  } catch (error) {
    toast(error.message, "error", 7000);
    setStatus("Não foi possível abrir a cena");
  } finally {
    setLoading(-1);
  }
}

boot();
