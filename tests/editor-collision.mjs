import vm from "node:vm";
import { generateAthenaScene, normalizeScene, worldTransforms } from "../editor/server.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function approximately(actual, expected, epsilon = 0.0001) {
  return Math.abs(actual - expected) <= epsilon;
}

const scene = normalizeScene({
  name: "Collision export test",
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
      events: {
        onEnter: [
          { id: "welcome", type: "message", text: "Bem-vindo às ruínas", duration: 150 },
          { id: "hide-cube", type: "visibility", targetId: "lit-cube", mode: "hide" },
        ],
        onExit: [
          { id: "stop-fire", type: "audio", targetId: "fire-audio", mode: "stop" },
        ],
        onInteract: [
          { id: "teleport", type: "teleport", position: { x: 3, y: 0.08, z: 9 } },
          { id: "burst", type: "particle", targetId: "fire-particles", mode: "burst" },
        ],
      },
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

assert(sandbox.EDITOR_SCENE.length === 1, "Runtime models must be exported independently from colliders");
assert(sandbox.EDITOR_SCENE[0].boundsRadius > 0, "OBJ spatial bounds must be exported for local lighting");
assert(Number.isFinite(sandbox.EDITOR_SCENE[0].boundsCenter.x), "OBJ spatial center must be finite");
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
assert(sandbox.EDITOR_UI.length === 2, "Only visible runtime UI elements must enter the runtime contract");
assert(sandbox.EDITOR_UI[0].background.a === 96, "Panel opacity must become Athena's 0-128 alpha range");
assert(sandbox.EDITOR_UI[1].text === "Objetivo atualizado" && sandbox.EDITOR_UI[1].align === "center",
  "Text content and alignment must survive UI export");

console.log("Editor collision export test passed.");
