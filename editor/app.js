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

const state = {
  document: null,
  objects: new Map(),
  assets: [],
  selectedId: null,
  dirty: false,
  loading: 0,
  loadGeneration: 0,
  undo: [],
  redo: [],
  transformMode: "translate",
  transformSpace: "world",
  dragSnapshot: null,
  fieldSnapshot: null,
  runPoll: null,
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

const selectionBox = new THREE.BoxHelper(undefined, 0x6de0ff);
selectionBox.material.depthTest = false;
selectionBox.material.transparent = true;
selectionBox.material.opacity = 0.9;
selectionBox.renderOrder = 999;
selectionBox.visible = false;
scene.add(selectionBox);

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
  const kind = record.source?.kind === "primitive" ? "primitive" : "model";
  return {
    id: record.id || uid(kind),
    name: record.name || (kind === "primitive" ? "Primitiva" : fileName(record.source?.asset)),
    source: {
      kind,
      asset: record.source?.asset || "",
      ...(kind === "primitive" ? { primitive: record.source?.primitive || "cube" } : {}),
    },
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
  object.visible = record.visible;
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

  setLoading(1, `Carregando ${record.name}…`);
  try {
    const content = record.source.kind === "primitive" ? createPrimitive(record) : await loadModel(record.source.asset);
    if (generation !== state.loadGeneration || !state.objects.has(record.id)) {
      disposeObject(content);
      return group;
    }
    content.userData.editorContent = true;
    group.add(content);
    group.userData.stats = prepareModel(content);
  } catch (error) {
    console.error(error);
    group.add(createErrorPlaceholder(record));
    group.userData.error = error.message;
    toast(`${record.name}: ${error.message}`, "error", 5200);
  } finally {
    setLoading(-1);
  }

  updateViewportStats();
  if (state.selectedId === record.id) refreshSelectionVisuals();
  return group;
}

function currentRecord() {
  return state.document?.objects.find((item) => item.id === state.selectedId) || null;
}

function currentObject() {
  return state.objects.get(state.selectedId) || null;
}

function setSelection(id) {
  state.selectedId = id && state.objects.has(id) ? id : null;
  transform.detach();
  selectionBox.visible = false;
  const record = currentRecord();
  const object = currentObject();
  if (record && object) {
    if (!record.locked && record.visible) transform.attach(object);
    if (record.visible) {
      selectionBox.setFromObject(object);
      selectionBox.visible = true;
    }
  }
  renderHierarchy();
  renderInspector();
}

function refreshSelectionVisuals() {
  const record = currentRecord();
  const object = currentObject();
  if (!record || !object) return;
  if (record.visible) {
    selectionBox.setFromObject(object);
    selectionBox.visible = true;
  } else {
    selectionBox.visible = false;
  }
}

function renderHierarchy() {
  const query = $("hierarchy-search").value.trim().toLocaleLowerCase("pt-BR");
  objectList.replaceChildren();
  const records = state.document?.objects || [];
  for (const record of records) {
    if (query && !record.name.toLocaleLowerCase("pt-BR").includes(query)) continue;
    const row = document.createElement("div");
    row.className = `object-row${record.id === state.selectedId ? " selected" : ""}${record.visible ? "" : " hidden-object"}`;
    row.dataset.id = record.id;
    row.setAttribute("role", "treeitem");
    row.innerHTML = `
      <span class="object-icon">${record.source.kind === "primitive" ? "◆" : "◇"}</span>
      <span class="object-name"></span>
      <button class="visibility-button" title="${record.visible ? "Ocultar" : "Mostrar"}">${record.visible ? "◉" : "○"}</button>
      <button class="lock-button" title="${record.locked ? "Desbloquear" : "Bloquear"}">${record.locked ? "▣" : "□"}</button>
    `;
    row.querySelector(".object-name").textContent = record.name;
    row.addEventListener("click", () => setSelection(record.id));
    row.querySelector(".visibility-button").addEventListener("click", (event) => {
      event.stopPropagation();
      const before = serializeScene();
      record.visible = !record.visible;
      const object = state.objects.get(record.id);
      if (object) object.visible = record.visible;
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

function setVectorInputs(prefix, vector) {
  $(`${prefix}-x`).value = cleanNumber(vector.x);
  $(`${prefix}-y`).value = cleanNumber(vector.y);
  $(`${prefix}-z`).value = cleanNumber(vector.z);
}

function renderInspector() {
  const record = currentRecord();
  const object = currentObject();
  inspector.hidden = !record;
  inspectorEmpty.hidden = Boolean(record);
  if (!record) return;

  $("object-name").value = record.name;
  $("object-type-icon").textContent = record.source.kind === "primitive" ? "◆" : "◇";
  setVectorInputs("position", record.position);
  setVectorInputs("rotation", record.rotation);
  setVectorInputs("scale", record.scale);
  $("object-color").value = record.color;
  $("object-visible").checked = record.visible;
  $("object-locked").checked = record.locked;
  $("object-runtime").checked = record.runtime;
  $("source-kind").textContent = record.source.kind === "primitive" ? `Primitiva · ${record.source.primitive}` : "Modelo 3D";
  $("source-asset").textContent = record.source.asset || "—";
  $("source-id").textContent = record.id;
  const stats = object?.userData.stats;
  $("source-stats").textContent = stats ? `${stats.vertices.toLocaleString("pt-BR")} vértices · ${stats.triangles.toLocaleString("pt-BR")} tris` : "Carregando…";

  const transformInputs = inspector.querySelectorAll('.vector-inputs input, #reset-transform-button');
  for (const input of transformInputs) input.disabled = record.locked;
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

async function loadDocument(documentData, { preserveHistory = false, dirty = false } = {}) {
  state.loadGeneration += 1;
  const generation = state.loadGeneration;
  transform.detach();
  selectionBox.visible = false;
  state.selectedId = null;
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
  renderHierarchy();
  renderInspector();
  updateViewportStats();
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
  if (checkpoint) pushHistorySnapshot(before);
  if (select) {
    setSelection(normalized.id);
    focusSelection();
  }
  updateViewportStats();
  return normalized;
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

async function duplicateSelection() {
  const record = currentRecord();
  if (!record) return;
  const duplicate = deepClone(record);
  duplicate.id = uid(record.source.kind);
  duplicate.name = `${record.name} cópia`;
  duplicate.position.x += 1;
  duplicate.position.z += 1;
  await addRecord(duplicate);
}

function deleteSelection() {
  const record = currentRecord();
  const object = currentObject();
  if (!record || !object) return;
  const before = serializeScene();
  transform.detach();
  editorRoot.remove(object);
  disposeObject(object);
  state.objects.delete(record.id);
  state.document.objects = state.document.objects.filter((item) => item.id !== record.id);
  state.selectedId = null;
  selectionBox.visible = false;
  pushHistorySnapshot(before);
  renderHierarchy();
  renderInspector();
  updateViewportStats();
  setStatus(`${record.name} excluído`);
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
  if (record.source.kind !== "primitive" || !object) return;
  object.traverse((child) => {
    if (child.isMesh && child.material?.color) child.material.color.set(record.color);
  });
}

function updateTransformFromInspector() {
  const record = currentRecord();
  const object = currentObject();
  if (!record || !object || record.locked) return;
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
  if (!record || !object || record.locked) return;
  const before = serializeScene();
  record.position = { x: 0, y: 0, z: 0 };
  record.rotation = { x: 0, y: 0, z: 0 };
  record.scale = { x: 1, y: 1, z: 1 };
  applyRecordTransform(record, object);
  pushHistorySnapshot(before);
  renderInspector();
  refreshSelectionVisuals();
}

function setTransformMode(mode) {
  state.transformMode = mode;
  transform.setMode(mode);
  document.querySelectorAll("[data-mode]").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
  setStatus({ translate: "Ferramenta mover", rotate: "Ferramenta rotacionar", scale: "Ferramenta escala" }[mode]);
}

function toggleTransformSpace() {
  state.transformSpace = state.transformSpace === "world" ? "local" : "world";
  transform.setSpace(state.transformSpace);
  $("space-button").textContent = state.transformSpace === "world" ? "Global" : "Local";
}

function updateSnap() {
  const enabled = $("snap-toggle").checked;
  const value = state.document?.settings.snap || 0.25;
  transform.setTranslationSnap(enabled ? value : null);
  transform.setRotationSnap(enabled ? THREE.MathUtils.degToRad(15) : null);
  transform.setScaleSnap(enabled ? 0.1 : null);
}

function focusSelection() {
  const object = currentObject();
  if (!object) return;
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const sphere = box.getBoundingSphere(new THREE.Sphere());
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
  const target = currentObject()
    ? new THREE.Box3().setFromObject(currentObject()).getCenter(new THREE.Vector3())
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

let pointerStart = null;
renderer.domElement.addEventListener("pointerdown", (event) => {
  pointerStart = { x: event.clientX, y: event.clientY };
});

renderer.domElement.addEventListener("pointerup", (event) => {
  if (!pointerStart || transform.dragging) return;
  if (Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 4) return;
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
    if (selected) break;
  }
  setSelection(selected);
});

renderer.domElement.addEventListener("pointermove", (event) => {
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
  state.dragSnapshot = serializeScene();
});

transform.addEventListener("objectChange", () => {
  const record = currentRecord();
  const object = currentObject();
  if (!record || !object) return;
  syncRecordFromObject(record, object);
  renderInspector();
  refreshSelectionVisuals();
  markDirty();
});

transform.addEventListener("mouseUp", () => {
  pushHistorySnapshot(state.dragSnapshot);
  state.dragSnapshot = null;
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
      if (property === "visible" && currentObject()) currentObject().visible = record.visible;
      finishFieldHistory();
      setSelection(record.id);
    });
  }
}

function bindUi() {
  document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => setTransformMode(button.dataset.mode)));
  document.querySelectorAll("[data-primitive]").forEach((button) => button.addEventListener("click", () => addPrimitive(button.dataset.primitive)));
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));

  $("space-button").addEventListener("click", toggleTransformSpace);
  $("snap-toggle").addEventListener("change", updateSnap);
  $("grid-button").addEventListener("click", () => {
    grid.visible = !grid.visible;
    axes.visible = grid.visible;
    $("grid-button").classList.toggle("active", grid.visible);
  });
  $("focus-button").addEventListener("click", focusSelection);
  $("save-button").addEventListener("click", () => saveScene());
  $("export-button").addEventListener("click", exportSceneFile);
  $("run-button").addEventListener("click", runInPcsx2);
  $("undo-button").addEventListener("click", undo);
  $("redo-button").addEventListener("click", redo);
  $("duplicate-button").addEventListener("click", duplicateSelection);
  $("delete-button").addEventListener("click", deleteSelection);
  $("reset-transform-button").addEventListener("click", resetTransform);
  $("hierarchy-search").addEventListener("input", renderHierarchy);
  $("asset-search").addEventListener("input", renderAssets);
  $("import-button").addEventListener("click", () => $("import-input").click());
  $("empty-import-button").addEventListener("click", () => $("import-input").click());
  $("import-input").addEventListener("change", (event) => importFiles(event.target.files));
  $("open-scene-button").addEventListener("click", () => $("open-scene-input").click());
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
    if (event.ctrlKey && event.key.toLowerCase() === "d") {
      event.preventDefault();
      duplicateSelection();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelection();
    } else if (event.key.toLowerCase() === "w") setTransformMode("translate");
    else if (event.key.toLowerCase() === "e") setTransformMode("rotate");
    else if (event.key.toLowerCase() === "r") setTransformMode("scale");
    else if (event.key.toLowerCase() === "f") focusSelection();
    else if (event.key === "Escape") setSelection(null);
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
  if (selectionBox.visible && currentObject()) selectionBox.update();
  renderer.render(scene, camera);
}

async function boot() {
  bindInspector();
  bindUi();
  resize();
  animate();
  setLoading(1, "Abrindo cena…");
  try {
    const [sceneResponse] = await Promise.all([
      fetch("/api/scene", { cache: "no-store" }),
      refreshAssetCatalog(),
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
