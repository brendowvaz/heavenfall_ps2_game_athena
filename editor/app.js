import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

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
  prefabs: [],
  selectedIds: new Set(),
  primaryId: null,
  dirty: false,
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
};

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
scene.add(transform.getHelper());

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

function normalizeRecord(record = {}) {
  const kind = ["model", "primitive", "group", "collider"].includes(record.source?.kind)
    ? record.source.kind
    : "model";
  return {
    id: record.id || uid(kind),
    name: record.name || (kind === "primitive" ? "Primitiva" : fileName(record.source?.asset)),
    source: {
      kind,
      asset: record.source?.asset || "",
      ...(kind === "primitive" ? { primitive: record.source?.primitive || "cube" } : {}),
      ...(kind === "collider" ? { collider: ["box", "sphere", "capsule"].includes(record.source?.collider) ? record.source.collider : "box" } : {}),
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
    ...(kind === "collider" ? {
      collider: {
        trigger: record.collider?.trigger === true,
        cameraBlocker: record.collider?.cameraBlocker !== false,
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
    color: record.color,
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
    return result.scene;
  }
  throw new Error(`Formato não suportado: ${extension || "desconhecido"}`);
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

  const icons = { group: "▱", collider: "▣", primitive: "◆", model: "◇" };
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

function renderInspector() {
  const record = currentRecord();
  const object = currentObject();
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
  $("object-type-icon").textContent = ({ group: "▱", collider: "▣", primitive: "◆", model: "◇" })[record.source.kind] || "◇";
  setVectorInputs("position", record.position);
  setVectorInputs("rotation", record.rotation);
  setVectorInputs("scale", record.scale);
  $("object-color").value = record.color;
  $("object-visible").checked = record.visible;
  $("object-locked").checked = record.locked;
  $("object-runtime").checked = record.runtime;
  $("source-kind").textContent = record.source.kind === "primitive"
    ? `Primitiva · ${record.source.primitive}`
    : record.source.kind === "collider"
      ? `Colisor · ${record.source.collider}`
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
  $("collider-section").hidden = !colliderMode;
  if (colliderMode) {
    $("collider-shape").value = record.source.collider;
    $("collider-trigger").checked = record.collider?.trigger === true;
    $("collider-camera").checked = record.collider?.cameraBlocker !== false;
  }

  const transformInputs = inspector.querySelectorAll('.vector-inputs input, #reset-transform-button');
  for (const input of transformInputs) input.disabled = isRecordEffectivelyLocked(record);
}

function updateViewportStats() {
  let triangles = 0;
  for (const object of state.objects.values()) triangles += object.userData.stats?.triangles || 0;
  const count = state.document?.objects.length || 0;
  $("viewport-stats").textContent = `${count} objeto${count === 1 ? "" : "s"} · ${Math.round(triangles).toLocaleString("pt-BR")} triângulos`;
}

async function refreshAssetCatalog() {
  try {
    const response = await fetch("/api/assets", { cache: "no-store" });
    if (!response.ok) throw new Error("Falha ao listar assets");
    const data = await response.json();
    state.assets = data.models || [];
    renderAssets();
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
  const generation = state.loadGeneration;
  transform.detach();
  selectionBox.visible = false;
  state.selectedIds.clear();
  state.primaryId = null;
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
    },
    objects: normalizedObjects,
  };

  if (!preserveHistory) {
    state.undo.length = 0;
    state.redo.length = 0;
    updateHistoryButtons();
  }

  $("scene-name").value = state.document.name;
  $("snap-toggle").checked = state.document.settings.snapEnabled;
  $("snap-mode").value = state.document.settings.snapMode;
  $("snap-step").value = state.document.settings.snap;
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
  renderHierarchy();
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

async function saveScene({ quiet = false } = {}) {
  try {
    syncAllRecords();
    saveCameraToDocument();
    state.document.name = $("scene-name").value.trim() || "Cena Athena";
    const response = await fetch("/api/scene", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.document),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Falha ao salvar a cena");
    state.document = result.scene;
    markDirty(false);
    setStatus("Cena salva e exportada para Athena");
    if (!quiet) toast("Cena salva. O runtime do PS2 foi atualizado.", "success");
    return true;
  } catch (error) {
    toast(error.message, "error", 5000);
    setStatus("Falha ao salvar");
    return false;
  }
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
  const accepted = [...files].filter((file) => /\.(obj|mtl|gltf|glb|bin|png|jpe?g|webp|bmp|tga)$/i.test(file.name));
  if (!accepted.length) {
    toast("Nenhum arquivo 3D compatível foi selecionado.", "error");
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
  orbit.enabled = !event.value;
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
  ]) {
    $(id).addEventListener("change", (event) => {
      const record = currentRecord();
      if (!record) return;
      stageFieldHistory();
      record[property] = event.target.checked;
      if (property === "visible") applyEditorVisibility(record);
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
    record.color = record.collider.trigger ? "#ffad66" : "#68e0b2";
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
}

function bindUi() {
  document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => setTransformMode(button.dataset.mode)));
  document.querySelectorAll("[data-primitive]").forEach((button) => button.addEventListener("click", () => addPrimitive(button.dataset.primitive)));
  document.querySelectorAll("[data-collider]").forEach((button) => button.addEventListener("click", () => addCollider(button.dataset.collider)));
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  document.querySelectorAll("[data-axis-view]").forEach((button) => button.addEventListener("click", () => setAxisView(button.dataset.axisView)));

  $("space-button").addEventListener("click", toggleTransformSpace);
  $("box-select-button").addEventListener("click", () => setBoxSelectTool(!state.boxSelectTool));
  $("pivot-button").addEventListener("click", togglePivotEditing);
  $("pivot-reset-button").addEventListener("click", resetPivotToCenter);
  $("isolate-selection-button").addEventListener("click", () => toggleIsolation());
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
  $("prefab-button").addEventListener("click", saveSelectionAsPrefab);
  $("multi-prefab-button").addEventListener("click", saveSelectionAsPrefab);
  $("create-prefab-button").addEventListener("click", saveSelectionAsPrefab);
  $("add-group-button").addEventListener("click", addGroup);
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
  $("new-scene-button").addEventListener("click", async () => {
    if (state.dirty && !window.confirm("Descartar as alterações não salvas e criar uma cena vazia?")) return;
    await loadDocument({
      name: "Nova cena",
      settings: { background: "#07101d", gridSize: 120, snap: 0.25 },
      objects: [],
    }, { dirty: true });
  });
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
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelection();
    } else if (event.key.toLowerCase() === "w") setTransformMode("translate");
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
  orbit.update(delta);
  if (selectionBox.visible) updateSelectionBounds();
  updateAxisGizmo();
  renderer.render(scene, camera);
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
    const [sceneResponse] = await Promise.all([
      fetch("/api/scene", { cache: "no-store" }),
      refreshAssetCatalog(),
      refreshPrefabs(),
    ]);
    const data = await sceneResponse.json();
    if (!sceneResponse.ok) throw new Error(data.error || "Falha ao abrir a cena");
    await loadDocument(data);
    toast("Editor pronto. Selecione um objeto para começar.", "success", 2800);
  } catch (error) {
    toast(error.message, "error", 7000);
    setStatus("Não foi possível abrir a cena");
  } finally {
    setLoading(-1);
  }
}

boot();
