import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const assetsRoot = path.join(projectRoot, "assets");
const threeRoot = path.join(projectRoot, "node_modules", "three");
const sceneFile = path.join(__dirname, "scene.json");
const prefabsRoot = path.join(__dirname, "prefabs");
const generatedSceneFile = path.join(assetsRoot, "scene.generated.js");
const host = "127.0.0.1";
const port = Number(process.env.ATHENA_EDITOR_PORT || 4173);

const modelExtensions = new Set([".obj", ".gltf", ".glb"]);
const importExtensions = new Set([
  ".obj", ".mtl", ".gltf", ".glb", ".bin",
  ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tga",
]);
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".obj": "text/plain; charset=utf-8",
  ".mtl": "text/plain; charset=utf-8",
  ".gltf": "model/gltf+json",
  ".glb": "model/gltf-binary",
  ".bin": "application/octet-stream",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

let runState = {
  running: false,
  phase: "idle",
  ok: true,
  log: [],
};

function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function sendText(response, statusCode, value) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(value),
  });
  response.end(value);
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function serveFile(request, response, root, requestedPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestedPath);
  } catch {
    sendText(response, 400, "Invalid path");
    return;
  }

  const filePath = path.resolve(root, decoded.replace(/^[/\\]+/, ""));
  if (!isInside(root, filePath)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Not a file");
    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Content-Length": info.size,
      "Cache-Control": extension === ".js" || extension === ".css" ? "no-cache" : "public, max-age=60",
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(filePath).pipe(response);
  } catch {
    sendText(response, 404, "Not found");
  }
}

async function readJsonBody(request, maxBytes = 256 * 1024 * 1024) {
  const chunks = [];
  let received = 0;
  for await (const chunk of request) {
    received += chunk.length;
    if (received > maxBytes) throw new Error("Payload too large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(text || "{}");
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function vector(value, fallback) {
  return {
    x: finite(value?.x, fallback.x),
    y: finite(value?.y, fallback.y),
    z: finite(value?.z, fallback.z),
  };
}

function safeAssetPath(value) {
  if (typeof value !== "string") return "";
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").includes("..")) return "";
  return normalized;
}

function normalizeScene(input) {
  const objects = Array.isArray(input?.objects) ? input.objects : [];
  const scene = {
    version: 1,
    name: String(input?.name || "Cena Athena").slice(0, 120),
    settings: {
      background: String(input?.settings?.background || "#07101d").slice(0, 16),
      gridSize: Math.max(10, finite(input?.settings?.gridSize, 120)),
      snap: Math.max(0, finite(input?.settings?.snap, 0.25)),
      camera: {
        position: vector(input?.settings?.camera?.position, { x: 24, y: 20, z: 32 }),
        target: vector(input?.settings?.camera?.target, { x: 0, y: 2, z: 0 }),
      },
    },
    objects: objects.slice(0, 2000).map((item, index) => {
      const allowedKinds = new Set(["model", "primitive", "group", "collider"]);
      const kind = allowedKinds.has(item?.source?.kind) ? item.source.kind : "model";
      const asset = safeAssetPath(item?.source?.asset || item?.asset);
      const primitive = ["cube", "sphere", "cylinder", "cone", "plane"].includes(item?.source?.primitive)
        ? item.source.primitive
        : "cube";
      return {
        id: String(item?.id || `object-${Date.now()}-${index}`).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 96),
        name: String(item?.name || `Objeto ${index + 1}`).slice(0, 120),
        source: {
          kind,
          asset,
          ...(kind === "primitive" ? { primitive } : {}),
          ...(kind === "collider" ? {
            collider: ["box", "sphere", "capsule"].includes(item?.source?.collider) ? item.source.collider : "box",
          } : {}),
        },
        parentId: typeof item?.parentId === "string" && item.parentId ? item.parentId : null,
        position: vector(item?.position, { x: 0, y: 0, z: 0 }),
        rotation: vector(item?.rotation, { x: 0, y: 0, z: 0 }),
        scale: vector(item?.scale, { x: 1, y: 1, z: 1 }),
        color: /^#[0-9a-f]{6}$/i.test(item?.color || "") ? item.color : "#8bd5f7",
        visible: item?.visible !== false,
        locked: item?.locked === true,
        runtime: item?.runtime !== false,
        collider: kind === "collider" ? {
          trigger: item?.collider?.trigger === true,
          cameraBlocker: item?.collider?.cameraBlocker !== false,
        } : undefined,
        prefabId: typeof item?.prefabId === "string" ? item.prefabId.slice(0, 96) : undefined,
      };
    }),
  };

  const byId = new Map(scene.objects.map((item) => [item.id, item]));
  for (const item of scene.objects) {
    if (!item.parentId || !byId.has(item.parentId) || item.parentId === item.id) {
      item.parentId = null;
      continue;
    }
    const visited = new Set([item.id]);
    let parentId = item.parentId;
    let cyclic = false;
    while (parentId) {
      if (visited.has(parentId)) {
        cyclic = true;
        break;
      }
      visited.add(parentId);
      parentId = byId.get(parentId)?.parentId || null;
    }
    if (cyclic) item.parentId = null;
  }
  return scene;
}

function degreesToRadians(degrees) {
  return degrees * Math.PI / 180;
}

function worldTransforms(scene) {
  const nodes = new Map();
  for (const item of scene.objects) {
    const node = new THREE.Object3D();
    node.position.set(item.position.x, item.position.y, item.position.z);
    node.rotation.set(
      degreesToRadians(item.rotation.x),
      degreesToRadians(item.rotation.y),
      degreesToRadians(item.rotation.z),
    );
    node.scale.set(item.scale.x, item.scale.y, item.scale.z);
    nodes.set(item.id, node);
  }
  for (const item of scene.objects) {
    const node = nodes.get(item.id);
    const parent = item.parentId ? nodes.get(item.parentId) : null;
    if (parent) parent.add(node);
  }
  for (const item of scene.objects) {
    if (!item.parentId) nodes.get(item.id).updateMatrixWorld(true);
  }
  const output = new Map();
  for (const item of scene.objects) {
    const node = nodes.get(item.id);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    node.matrixWorld.decompose(position, quaternion, scale);
    const rotation = new THREE.Euler().setFromQuaternion(quaternion, "XYZ");
    output.set(item.id, {
      position: { x: position.x, y: position.y, z: position.z },
      rotation: { x: rotation.x, y: rotation.y, z: rotation.z },
      scale: { x: scale.x, y: scale.y, z: scale.z },
    });
  }
  return output;
}

function generateAthenaScene(scene) {
  const transforms = worldTransforms(scene);
  const objects = scene.objects
    .filter((item) => item.runtime && item.visible && item.source.asset && ["model", "primitive"].includes(item.source.kind))
    .map((item) => {
      const transform = transforms.get(item.id);
      return {
      id: item.id,
      name: item.name,
      asset: item.source.asset,
      position: transform.position,
      rotation: transform.rotation,
      scale: transform.scale,
      };
    });

  const colliders = scene.objects
    .filter((item) => item.runtime && item.visible && item.source.kind === "collider")
    .map((item) => {
      const transform = transforms.get(item.id);
      return {
        id: item.id,
        name: item.name,
        shape: item.source.collider,
        contractVersion: 2,
        rotationOrder: "XYZ",
        scaleMeaning: item.source.collider === "box" ? "halfExtents" : "localRadii",
        position: transform.position,
        rotation: transform.rotation,
        scale: {
          x: Math.abs(transform.scale.x),
          y: Math.abs(transform.scale.y),
          z: Math.abs(transform.scale.z),
        },
        trigger: item.collider?.trigger === true,
        cameraBlocker: item.collider?.cameraBlocker !== false,
      };
    });

  return [
    "// Generated by Athena Visual Editor. Do not edit by hand.",
    `// Scene: ${scene.name}`,
    "globalThis.EDITOR_COLLISION_VERSION = 2;",
    `globalThis.EDITOR_SCENE = ${JSON.stringify(objects, null, 2)};`,
    `globalThis.EDITOR_COLLIDERS = ${JSON.stringify(colliders, null, 2)};`,
    "",
  ].join("\n");
}

async function listPrefabs() {
  await mkdir(prefabsRoot, { recursive: true });
  const files = (await readdir(prefabsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
  const prefabs = [];
  for (const file of files) {
    try {
      const prefab = JSON.parse(await readFile(path.join(prefabsRoot, file.name), "utf8"));
      prefabs.push(prefab);
    } catch {
      // Ignore malformed prefab files so one bad file cannot hide the library.
    }
  }
  return prefabs.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function savePrefab(payload) {
  const name = String(payload?.name || "Prefab").trim().slice(0, 120) || "Prefab";
  const id = sanitizeSegment(payload?.id || `${name}-${Date.now().toString(36)}`).replace(/\.[^.]+$/, "");
  const normalized = normalizeScene({ name, objects: payload?.objects || [] });
  const prefab = {
    version: 1,
    id,
    name,
    createdAt: new Date().toISOString(),
    objects: normalized.objects,
  };
  await mkdir(prefabsRoot, { recursive: true });
  const destination = path.join(prefabsRoot, `${id}.json`);
  await writeFile(destination, `${JSON.stringify(prefab, null, 2)}\n`, "utf8");
  return prefab;
}

async function writeScene(scene) {
  await mkdir(assetsRoot, { recursive: true });
  const sceneTemp = `${sceneFile}.tmp`;
  const generatedTemp = `${generatedSceneFile}.tmp`;
  await writeFile(sceneTemp, `${JSON.stringify(scene, null, 2)}\n`, "utf8");
  await writeFile(generatedTemp, generateAthenaScene(scene), "utf8");
  await rename(sceneTemp, sceneFile);
  await rename(generatedTemp, generatedSceneFile);
}

async function walkAssets(directory = assetsRoot, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      output.push(...await walkAssets(absolute, relative));
    } else {
      const info = await stat(absolute);
      output.push({
        path: relative.replaceAll("\\", "/"),
        name: entry.name,
        extension: path.extname(entry.name).toLowerCase(),
        size: info.size,
      });
    }
  }
  return output.sort((a, b) => a.path.localeCompare(b.path));
}

function sanitizeSegment(value) {
  return String(value || "file")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "file";
}

function sanitizeRelativePath(value) {
  const parts = String(value || "file").replaceAll("\\", "/").split("/");
  return parts.filter((part) => part && part !== "." && part !== "..").map(sanitizeSegment).join("/");
}

async function importFiles(payload) {
  if (!Array.isArray(payload?.files) || payload.files.length === 0) {
    throw new Error("No files supplied");
  }

  const firstModel = payload.files.find((item) => modelExtensions.has(path.extname(item.name || "").toLowerCase()));
  const baseName = path.basename(firstModel?.name || "modelo", path.extname(firstModel?.name || ""));
  const folder = `${sanitizeSegment(baseName)}-${Date.now().toString(36)}`;
  const destinationRoot = path.join(assetsRoot, "imported", folder);
  await mkdir(destinationRoot, { recursive: true });

  const imported = [];
  for (const file of payload.files.slice(0, 256)) {
    const relative = sanitizeRelativePath(file.relativePath || file.name);
    const extension = path.extname(relative).toLowerCase();
    if (!relative || !importExtensions.has(extension)) continue;
    const destination = path.resolve(destinationRoot, relative);
    if (!isInside(destinationRoot, destination)) continue;
    await mkdir(path.dirname(destination), { recursive: true });
    const buffer = Buffer.from(String(file.data || ""), "base64");
    await writeFile(destination, buffer);
    imported.push(`imported/${folder}/${relative}`.replaceAll("\\", "/"));
  }

  return {
    files: imported,
    models: imported.filter((file) => modelExtensions.has(path.extname(file).toLowerCase())),
  };
}

function appendRunLog(text) {
  const lines = String(text).split(/\r?\n/).filter(Boolean);
  runState.log.push(...lines);
  runState.log = runState.log.slice(-80);
}

function startBuildAndRun() {
  if (runState.running) return false;
  runState = { running: true, phase: "build", ok: true, log: ["Empacotando projeto..."] };
  const buildScript = path.join(projectRoot, "scripts", "build.ps1");
  const runScript = path.join(projectRoot, "scripts", "run-pcsx2.ps1");
  const build = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", buildScript], {
    cwd: projectRoot,
    windowsHide: true,
  });
  build.stdout.on("data", appendRunLog);
  build.stderr.on("data", appendRunLog);
  build.on("close", (code) => {
    if (code !== 0) {
      runState.running = false;
      runState.phase = "error";
      runState.ok = false;
      appendRunLog(`Build terminou com código ${code}.`);
      return;
    }
    runState.phase = "launch";
    appendRunLog("Abrindo PCSX2...");
    const runner = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", runScript], {
      cwd: projectRoot,
      windowsHide: true,
      detached: true,
    });
    runner.stdout.on("data", appendRunLog);
    runner.stderr.on("data", appendRunLog);
    runner.on("close", (runCode) => {
      runState.running = false;
      runState.phase = runCode === 0 ? "done" : "error";
      runState.ok = runCode === 0;
      appendRunLog(runCode === 0 ? "PCSX2 iniciado." : `Falha ao iniciar PCSX2 (${runCode}).`);
    });
  });
  return true;
}

async function handleApi(request, response, url) {
  if (url.pathname === "/api/scene" && request.method === "GET") {
    try {
      const scene = normalizeScene(JSON.parse(await readFile(sceneFile, "utf8")));
      sendJson(response, 200, scene);
    } catch (error) {
      sendJson(response, 500, { error: `Não foi possível abrir a cena: ${error.message}` });
    }
    return true;
  }

  if (url.pathname === "/api/scene" && request.method === "PUT") {
    try {
      const scene = normalizeScene(await readJsonBody(request, 16 * 1024 * 1024));
      await writeScene(scene);
      sendJson(response, 200, { ok: true, scene, generated: "assets/scene.generated.js" });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/assets" && request.method === "GET") {
    try {
      const files = await walkAssets();
      sendJson(response, 200, {
        files,
        models: files.filter((file) => modelExtensions.has(file.extension)),
      });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/prefabs" && request.method === "GET") {
    try {
      sendJson(response, 200, { prefabs: await listPrefabs() });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/prefabs" && request.method === "POST") {
    try {
      const prefab = await savePrefab(await readJsonBody(request, 16 * 1024 * 1024));
      sendJson(response, 201, { ok: true, prefab });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return true;
  }

  if (url.pathname.startsWith("/api/prefabs/") && request.method === "DELETE") {
    try {
      const id = sanitizeSegment(decodeURIComponent(url.pathname.slice("/api/prefabs/".length))).replace(/\.[^.]+$/, "");
      const destination = path.join(prefabsRoot, `${id}.json`);
      if (!isInside(prefabsRoot, destination)) throw new Error("Invalid prefab id");
      await unlink(destination);
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/import" && request.method === "POST") {
    try {
      const result = await importFiles(await readJsonBody(request));
      sendJson(response, 201, result);
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/run" && request.method === "POST") {
    if (!startBuildAndRun()) {
      sendJson(response, 409, { error: "Build ou PCSX2 já está em execução.", state: runState });
    } else {
      sendJson(response, 202, { ok: true, state: runState });
    }
    return true;
  }

  if (url.pathname === "/api/run/status" && request.method === "GET") {
    sendJson(response, 200, runState);
    return true;
  }

  return false;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);
    if (url.pathname.startsWith("/api/")) {
      if (!await handleApi(request, response, url)) sendJson(response, 404, { error: "API not found" });
      return;
    }
    if (url.pathname === "/") {
      response.writeHead(302, { Location: "/editor/" });
      response.end();
      return;
    }
    if (url.pathname === "/editor" || url.pathname === "/editor/") {
      await serveFile(request, response, __dirname, "index.html");
      return;
    }
    if (url.pathname.startsWith("/editor/")) {
      await serveFile(request, response, __dirname, url.pathname.slice("/editor/".length));
      return;
    }
    if (url.pathname.startsWith("/assets/")) {
      await serveFile(request, response, assetsRoot, url.pathname.slice("/assets/".length));
      return;
    }
    if (url.pathname.startsWith("/vendor/three/")) {
      await serveFile(request, response, threeRoot, url.pathname.slice("/vendor/three/".length));
      return;
    }
    sendText(response, 404, "Not found");
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
});

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  server.listen(port, host, () => {
    console.log(`Athena Visual Editor: http://${host}:${port}/editor/`);
    console.log("Pressione Ctrl+C para encerrar.");
  });
}

export { normalizeScene, worldTransforms, generateAthenaScene };
