import vm from "node:vm";
import { convertObjToRuntimeObj, generateAthenaScene, normalizeScene, worldTransforms } from "../editor/server.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function approximately(actual, expected, epsilon = 0.0001) {
  return Math.abs(actual - expected) <= epsilon;
}

const convertedQuad = convertObjToRuntimeObj(`
mtllib missing.mtl
o Quad
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
vt 0 0
vt 1 0
vt 1 1
vt 0 1
vn 0 0 1
usemtl Missing
f 1/1/1 2/2/1 3/3/1 4/4/1
`, "quad.obj");
assert(convertedQuad.triangles === 2, "Runtime OBJ conversion must triangulate quads");
assert((convertedQuad.source.match(/^f\s+/gm) || []).length === 2, "Converted OBJ must write triangle faces");
assert((convertedQuad.source.match(/^v\s+/gm) || []).length === 6, "Converted OBJ must de-index triangle vertices");
assert(!/^mtllib\s+/m.test(convertedQuad.source) && !/^usemtl\s+/m.test(convertedQuad.source),
  "Converted OBJ must not depend on external material files");

const scene = normalizeScene({
  name: "Collision export test",
  settings: {
    background: "#112233",
    runtime: {
      vsync: false,
      showPerformance: true,
      legacyArenaBounds: false,
      player: {
        spawn: { x: 4, y: 0.2, z: 7 }, radius: 0.55, height: 2,
        walkSpeed: 0.11, runSpeed: 0.22, jumpSpeed: 0.31, gravity: 0.012,
      },
    },
  },
  objects: [
    {
      id: "parent",
      name: "Parent",
      source: { kind: "group" },
      position: { x: 10, y: 0, z: 5 },
      rotation: { x: 0, y: 90, z: 0 },
      scale: { x: 2, y: 1, z: 3 },
    },
    {
      id: "child-box",
      name: "Nested box",
      source: { kind: "collider", collider: "box" },
      parentId: "parent",
      position: { x: 1, y: 2, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 0.5, y: 2, z: 1 },
      collider: { trigger: true, cameraBlocker: false },
      portal: { enabled: true, targetSceneId: "temple", targetSpawnId: "temple-gate", activation: "onInteract", fadeFrames: 24 },
      checkpoint: { enabled: true, activation: "onInteract", autosave: true },
      events: {
        onEnter: [
          { id: "welcome", type: "message", text: "Bem-vindo às ruínas", duration: 150 },
          { id: "hide-cube", type: "visibility", targetId: "lit-cube", mode: "hide" },
          { id: "save-progress", type: "save" },
        ],
        onExit: [
          { id: "stop-fire", type: "audio", targetId: "fire-audio", mode: "stop" },
        ],
        onInteract: [
          { id: "teleport", type: "teleport", position: { x: 3, y: 0.08, z: 9 } },
          { id: "burst", type: "particle", targetId: "fire-particles", mode: "burst" },
          { id: "play-video", type: "video", targetId: "intro-video", mode: "play" },
          { id: "enter-temple", type: "scene", sceneId: "temple", spawnId: "temple-gate", fadeFrames: 24 },
          { id: "load-progress", type: "load" },
        ],
      },
    },
    {
      id: "main-entry",
      name: "Entrada principal",
      source: { kind: "spawn" },
      position: { x: 3, y: 0.2, z: 7 },
      rotation: { x: 0, y: 180, z: 0 },
      spawn: { default: true },
    },
    {
      id: "disabled",
      name: "Disabled collider",
      source: { kind: "collider", collider: "sphere" },
      runtime: false,
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 99, y: 99, z: 99 },
    },
    {
      id: "lit-cube",
      name: "Lit cube",
      source: { kind: "primitive", primitive: "cube", asset: "editor_primitives/cube.obj" },
      position: { x: 2, y: 3, z: 4 },
      scale: { x: 2, y: 2, z: 2 },
      material: {
        color: "#804020", texture: "Textures/frost_atlas.png", opacity: 0.8,
        roughness: 0.25, metalness: 0.7, emissive: "#102030", emissiveIntensity: 1.5,
        unlit: false, doubleSided: false, textureMapping: false, smoothShading: false, accurateClipping: true,
      },
    },
    {
      id: "animated-model",
      name: "Animated model",
      source: { kind: "model", asset: "imported/animated.glb" },
      animation: { clip: "Idle", autoplay: true, loop: false },
    },
    {
      id: "player-shadow",
      name: "Player shadow",
      source: { kind: "shadow", asset: "Textures/shadow.png" },
      position: { x: 2, y: 0.03, z: 4 },
      shadow: {
        width: 3, height: 2, gridX: 8, gridZ: 7,
        lightDirection: { x: 0, y: 1, z: 1 }, bias: -0.03, lightOffset: 1.2,
        color: "#102030", opacity: 0.6, blend: "alpha", followPlayer: true,
      },
    },
    {
      id: "campfire",
      name: "Campfire light",
      source: { kind: "light", light: "point" },
      position: { x: 2, y: 4, z: 4 },
      light: {
        type: "point", color: "#ff8844", intensity: 2.8, distance: 8,
        flicker: true, flickerAmount: 0.28, flickerSpeed: 7.5,
      },
    },
    {
      id: "fixed-camera",
      name: "Fixed camera",
      source: { kind: "camera" },
      position: { x: 8, y: 6, z: 8 },
      rotation: { x: -20, y: 45, z: 0 },
      camera: { fov: 55, near: 0.2, far: 250, active: true, mode: "fixed" },
    },
    {
      id: "fire-audio",
      name: "Fire audio",
      source: { kind: "audio", asset: "sounds/fire.adp" },
      position: { x: 2, y: 1, z: 4 },
      audio: { mode: "sfx", autoplay: true, loop: true, volume: 72, spatial: true, distance: 9, pan: 0, pitch: -4 },
    },
    {
      id: "music",
      name: "Music",
      source: { kind: "audio", asset: "sounds/ruins.ogg" },
      audio: { mode: "stream", autoplay: true, loop: true, volume: 65 },
    },
    {
      id: "second-music",
      name: "Second music",
      source: { kind: "audio", asset: "sounds/unused.wav" },
      audio: { mode: "stream", autoplay: true },
    },
    {
      id: "fire-particles",
      name: "Fire particles",
      source: { kind: "particle" },
      position: { x: 2, y: 1, z: 4 },
      particle: { preset: "fire", color: "#33cc88", autoplay: true, maxParticles: 8, rate: 8, lifetime: 70, speed: 0.035, spread: 0.4, size: 0.16, gravity: -0.0004 },
    },
    {
      id: "smoke-particles",
      name: "Smoke particles",
      source: { kind: "particle" },
      particle: { preset: "smoke", autoplay: true, maxParticles: 8 },
    },
  ],
  ui: [
    { id: "hud-panel", name: "HUD panel", type: "panel", x: 20, y: 360, width: 300, height: 56, background: "#102030", opacity: 0.75 },
    { id: "hud-text", name: "HUD text", type: "text", x: 32, y: 374, width: 270, height: 24, text: "Objetivo atualizado", fontScale: 0.5, color: "#f0d080", align: "center" },
    { id: "hud-image", name: "HUD image", type: "image", x: 10, y: 10, width: 64, height: 64, asset: "Textures/icon.png", opacity: 0.5 },
    { id: "intro-video", name: "Intro video", type: "video", x: 0, y: 0, width: 640, height: 448, asset: "videos/intro.mpg", autoplay: false, loop: false },
    { id: "custom-font", name: "Custom font", type: "text", text: "Fonte", fontAsset: "fonts/game.ttf", outline: 2, outlineColor: "#123456", dropshadow: 3 },
    { id: "editor-only", name: "Editor only", type: "text", runtime: false, text: "Não exportar" },
  ],
});

const transforms = worldTransforms(scene);
const child = transforms.get("child-box");
assert(approximately(child.position.x, 10) && approximately(child.position.y, 2) && approximately(child.position.z, 3),
  "Nested collider position must be exported in world coordinates");
assert(approximately(child.rotation.y, Math.PI / 2), "Editor degrees must become runtime radians");
assert(approximately(child.scale.x, 1) && approximately(child.scale.y, 2) && approximately(child.scale.z, 3),
  "Parent and child collider scales must be combined");

const sandbox = {};
vm.runInNewContext(generateAthenaScene(scene), sandbox);
assert(sandbox.EDITOR_COLLISION_VERSION === 2, "Generated scene must declare collision contract version 2");
assert(sandbox.EDITOR_COLLIDERS.length === 1, "Disabled colliders must not enter the runtime export");

const exported = sandbox.EDITOR_COLLIDERS[0];
assert(exported.shape === "box", "Collider shape must survive export");
assert(exported.rotationOrder === "XYZ", "Collider rotation order must be explicit");
assert(exported.scaleMeaning === "halfExtents", "Box scale semantics must be explicit");
assert(exported.trigger === true && exported.cameraBlocker === false,
  "Trigger and camera flags must survive export independently");
assert(sandbox.EDITOR_EVENTS.length === 1, "Trigger components must enter the runtime event contract");
assert(sandbox.EDITOR_EVENTS[0].onEnter[0].text === "Bem-vindo às ruínas",
  "Message actions must survive export");
assert(sandbox.EDITOR_EVENTS[0].onEnter[1].targetIds[0] === "lit-cube",
  "Visibility targets must resolve to runtime object ids");
assert(sandbox.EDITOR_EVENTS[0].onInteract[0].position.z === 9,
  "Teleport actions must survive export");
assert(sandbox.EDITOR_EVENTS[0].onExit[0].type === "audio" && sandbox.EDITOR_EVENTS[0].onExit[0].targetId === "fire-audio",
  "Audio control actions must survive export");
assert(sandbox.EDITOR_EVENTS[0].onInteract[1].type === "particle" && sandbox.EDITOR_EVENTS[0].onInteract[1].mode === "burst",
  "Particle control actions must survive export");
assert(sandbox.EDITOR_EVENTS[0].onInteract[2].type === "video" && sandbox.EDITOR_EVENTS[0].onInteract[2].targetId === "intro-video",
  "Video control actions must survive export");
assert(sandbox.EDITOR_EVENTS[0].onInteract[3].type === "scene"
  && sandbox.EDITOR_EVENTS[0].onInteract[3].sceneId === "temple"
  && sandbox.EDITOR_EVENTS[0].onInteract[3].spawnId === "temple-gate",
"Scene actions must preserve their destination and spawn point");
assert(sandbox.EDITOR_EVENTS[0].onEnter.some((action) => action.type === "save")
  && sandbox.EDITOR_EVENTS[0].onInteract.some((action) => action.type === "load"),
"Trigger save/load actions must survive normalization and runtime export");
assert(sandbox.EDITOR_SPAWN_POINTS.length === 1
  && sandbox.EDITOR_SPAWN_POINTS[0].id === "main-entry"
  && approximately(Math.abs(sandbox.EDITOR_SPAWN_POINTS[0].yaw), Math.PI),
"Spawn points must export world position, rotation and default state");
assert(sandbox.EDITOR_PORTALS.length === 1
  && sandbox.EDITOR_PORTALS[0].triggerId === "child-box"
  && sandbox.EDITOR_PORTALS[0].targetSceneId === "temple"
  && sandbox.EDITOR_PORTALS[0].activation === "onInteract",
"Enabled portals must export as trigger-linked scene transitions");
assert(sandbox.EDITOR_CHECKPOINTS.length === 1
  && sandbox.EDITOR_CHECKPOINTS[0].triggerId === "child-box"
  && sandbox.EDITOR_CHECKPOINTS[0].activation === "onInteract"
  && sandbox.EDITOR_CHECKPOINTS[0].autosave === true,
"Enabled checkpoints must export as safe trigger-linked save operations");

assert(sandbox.EDITOR_SETTINGS.vsync === false && sandbox.EDITOR_SETTINGS.showPerformance === true
  && sandbox.EDITOR_SETTINGS.legacyArenaBounds === false && sandbox.EDITOR_SETTINGS.player.spawn.x === 4,
  "Runtime and player settings must survive export");
assert(sandbox.EDITOR_SETTINGS.background.r === 17 && sandbox.EDITOR_SETTINGS.background.g === 34,
  "Runtime background must use Athena's color contract");
assert(sandbox.EDITOR_SCENE.length === 2, "Runtime models must be exported independently from colliders");
assert(sandbox.EDITOR_SCENE[0].boundsRadius > 0, "OBJ spatial bounds must be exported for local lighting");
assert(Number.isFinite(sandbox.EDITOR_SCENE[0].boundsCenter.x), "OBJ spatial center must be finite");
assert(approximately(sandbox.EDITOR_SCENE[0].material.color.r, 128 / 255)
  && sandbox.EDITOR_SCENE[0].material.texture === "Textures/frost_atlas.png"
  && sandbox.EDITOR_SCENE[0].material.doubleSided === false
  && sandbox.EDITOR_SCENE[0].material.textureMapping === false
  && sandbox.EDITOR_SCENE[0].material.smoothShading === false
  && sandbox.EDITOR_SCENE[0].material.accurateClipping === true,
  "Official material properties and texture overrides must survive export");
assert(sandbox.EDITOR_SCENE[1].animation.clip === "Idle" && sandbox.EDITOR_SCENE[1].animation.loop === false,
  "GLTF/GLB animation settings must survive export");
assert(sandbox.EDITOR_POINT_LIGHTS.length === 1, "Point light must enter the simulated runtime contract");
assert(sandbox.EDITOR_POINT_LIGHTS[0].runtimeMode === "simulated-per-object" && sandbox.EDITOR_POINT_LIGHTS[0].flicker === true,
  "Point-light simulation and flicker settings must survive export");
assert(sandbox.EDITOR_LIGHTS.length === 0, "Point light must not leak into the global-light contract");
assert(sandbox.EDITOR_CAMERA.mode === "fixed" && sandbox.EDITOR_CAMERA.target,
  "Active camera mode and facing target must survive export");
assert(sandbox.EDITOR_AUDIO.length === 2, "Runtime export must keep SFX and only the first global stream");
assert(sandbox.EDITOR_AUDIO[0].spatial === true && sandbox.EDITOR_AUDIO[0].distance === 9,
  "Spatial audio settings must survive export");
assert(sandbox.EDITOR_PARTICLES.length === 2, "Particle emitters must enter the runtime contract");
assert(sandbox.EDITOR_PARTICLES[0].asset === "editor_particles/fire.obj",
  "Particle presets must resolve to a real runtime mesh");
assert(approximately(sandbox.EDITOR_PARTICLES[0].color.r, 0.2)
  && approximately(sandbox.EDITOR_PARTICLES[0].color.g, 0.8)
  && approximately(sandbox.EDITOR_PARTICLES[0].color.b, 136 / 255),
  "Particle colors must survive export as Athena material values");
assert(sandbox.EDITOR_PARTICLES.reduce((total, item) => total + item.maxParticles, 0) === 12,
  "Particle export must enforce the global PS2 budget");
assert(sandbox.EDITOR_SHADOWS.length === 1 && sandbox.EDITOR_SHADOWS[0].gridX === 8
  && sandbox.EDITOR_SHADOWS[0].blend === "alpha" && sandbox.EDITOR_SHADOWS[0].followPlayer === true,
  "Official Shadows.Projector settings must survive export");
assert(sandbox.EDITOR_UI.length === 5, "Only visible runtime UI elements must enter the runtime contract");
assert(sandbox.EDITOR_UI[0].background.a === 96, "Panel opacity must become Athena's 0-128 alpha range");
assert(sandbox.EDITOR_UI[1].text === "Objetivo atualizado" && sandbox.EDITOR_UI[1].align === "center",
  "Text content and alignment must survive UI export");
assert(sandbox.EDITOR_UI[2].type === "image" && sandbox.EDITOR_UI[2].asset === "Textures/icon.png",
  "UI images must survive export");
assert(sandbox.EDITOR_UI[3].type === "video" && sandbox.EDITOR_UI[3].asset === "videos/intro.mpg",
  "MPEG UI video settings must survive export");
assert(sandbox.EDITOR_UI[4].fontAsset === "fonts/game.ttf" && sandbox.EDITOR_UI[4].outline === 2
  && sandbox.EDITOR_UI[4].dropshadow === 0,
  "Custom fonts must export and mutually exclusive font effects must be normalized");

console.log("Editor collision export test passed.");
