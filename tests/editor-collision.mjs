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
    },
    {
      id: "disabled",
      name: "Disabled collider",
      source: { kind: "collider", collider: "sphere" },
      runtime: false,
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 99, y: 99, z: 99 },
    },
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

console.log("Editor collision export test passed.");
