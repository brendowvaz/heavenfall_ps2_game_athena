import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {
  createLogicGraph,
  createLogicNode,
  createLogicVariable,
  normalizeLogic,
  validateLogic,
} from "../editor/visual-scripting.js";
import { generateAthenaScene, normalizeScene } from "../editor/server.mjs";

let sequence = 0;
const id = (prefix) => `${prefix}-${++sequence}`;
const variable = createLogicVariable("Porta aberta", "boolean", id);
const jumpVariable = createLogicVariable("Pulos", "number", id);
const graph = createLogicGraph("Porta", id, false);
const start = createLogicNode("eventStart", id, { x: 10, y: 20 });
const setVariable = createLogicNode("actionSetVariable", id, { x: 250, y: 20 });
setVariable.config = { variableId: variable.id, operation: "set", value: true };
const condition = createLogicNode("conditionVariable", id, { x: 490, y: 20 });
condition.config = { variableId: variable.id, operator: "eq", value: true };
const message = createLogicNode("actionMessage", id, { x: 730, y: 20 });
message.config = { text: "Porta aberta", duration: 90 };
const delay = createLogicNode("flowDelay", id, { x: 970, y: 20 });
delay.config = { frames: 2 };
const secondMessage = createLogicNode("actionMessage", id, { x: 1210, y: 20 });
secondMessage.config = { text: "Depois", duration: 30 };
const changeScene = createLogicNode("actionScene", id, { x: 1450, y: 20 });
changeScene.config = { sceneId: "temple", spawnId: "temple-gate", fadeFrames: 24 };
graph.nodes.push(start, setVariable, condition, message, delay, secondMessage, changeScene);
graph.links.push(
  { id: id("link"), from: start.id, fromPort: "next", to: setVariable.id },
  { id: id("link"), from: setVariable.id, fromPort: "next", to: condition.id },
  { id: id("link"), from: condition.id, fromPort: "true", to: message.id },
  { id: id("link"), from: message.id, fromPort: "next", to: delay.id },
  { id: id("link"), from: delay.id, fromPort: "next", to: secondMessage.id },
  { id: id("link"), from: secondMessage.id, fromPort: "next", to: changeScene.id },
);

const jumpGraph = createLogicGraph("Contador de pulos", id, false);
const jumpEvent = createLogicNode("eventPlayerJump", id, { x: 10, y: 180 });
const incrementJump = createLogicNode("actionSetVariable", id, { x: 250, y: 180 });
incrementJump.config = { variableId: jumpVariable.id, operation: "add", value: 1 };
const displayJump = createLogicNode("actionDisplayVariable", id, { x: 490, y: 180 });
displayJump.config = { variableId: jumpVariable.id, prefix: "Pulos: ", duration: 120 };
jumpGraph.nodes.push(jumpEvent, incrementJump, displayJump);
jumpGraph.links.push(
  { id: id("link"), from: jumpEvent.id, fromPort: "next", to: incrementJump.id },
  { id: id("link"), from: incrementJump.id, fromPort: "next", to: displayJump.id },
);

const normalized = normalizeLogic({ variables: [variable, jumpVariable], graphs: [graph, jumpGraph] }, id);
assert.equal(validateLogic(normalized).length, 0, "valid graph should not report issues");
assert.equal(normalized.graphs[0].nodes.length, 7);

const sandbox = { console, globalThis: null };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(new URL("../assets/visual-scripting-runtime.js", import.meta.url), "utf8"), sandbox);
const actions = [];
const sharedVariables = {};
const runtime = sandbox.VisualScriptingRuntime.create(normalized, {
  execute(type, config) { actions.push({ type, config }); },
  buttonPressed() { return false; },
  readVariable(variableId, initialValue) {
    if (!(variableId in sharedVariables)) sharedVariables[variableId] = initialValue;
    return sharedVariables[variableId];
  },
  writeVariable(variableId, value) {
    sharedVariables[variableId] = value;
    return value;
  },
});
runtime.start();
assert.equal(runtime.getVariable(variable.id), true);
assert.equal(sharedVariables[variable.id], true, "variable actions must update the project-wide store");
assert.deepEqual(actions.filter((entry) => entry.type === "actionMessage").map((entry) => entry.config.text), ["Porta aberta"]);
runtime.step();
assert.equal(actions.length, 1, "delay must wait for the configured frame count");
runtime.step();
assert.deepEqual(actions.filter((entry) => entry.type === "actionMessage").map((entry) => entry.config.text), ["Porta aberta", "Depois"]);
assert.deepEqual(actions.find((entry) => entry.type === "actionScene")?.config, {
  sceneId: "temple", spawnId: "temple-gate", fadeFrames: 24,
});
runtime.playerJump();
assert.equal(sharedVariables[jumpVariable.id], 1, "a real jump event must increment the shared counter");
assert.deepEqual(actions.find((entry) => entry.type === "actionDisplayVariable")?.config, {
  variableId: jumpVariable.id, prefix: "Pulos: ", duration: 120,
});
const nextSceneRuntime = sandbox.VisualScriptingRuntime.create({ variables: normalized.variables, graphs: [] }, {
  readVariable(variableId, initialValue) { return sharedVariables[variableId] ?? initialValue; },
});
assert.equal(nextSceneRuntime.getVariable(variable.id), true, "a new scene runtime must reuse the shared variable value");
assert.equal(nextSceneRuntime.getVariable(jumpVariable.id), 1, "the jump counter must survive a scene runtime replacement");

const scene = normalizeScene({
  name: "Logic export",
  settings: { runtime: { legacyArenaBounds: false } },
  objects: [
    { id: "group", name: "Grupo", source: { kind: "group" } },
    { id: "model", name: "Modelo", parentId: "group", persistent: true, source: { kind: "model", asset: "scene_0.obj" } },
    {
      id: "trigger", name: "Trigger", source: { kind: "collider", collider: "box" }, collider: { trigger: true },
      portal: {
        enabled: true, targetSceneId: "temple", targetSpawnId: "temple-gate", activation: "onEnter", fadeFrames: 24,
        condition: { enabled: true, variableId: variable.id, operator: "eq", value: true },
      },
    },
  ],
  logic: {
    variables: [variable],
    graphs: [{
      id: "graph-export", name: "Export", enabled: true,
      nodes: [
        { id: "event", type: "eventTrigger", x: 0, y: 0, config: { triggerId: "trigger", phase: "onEnter" } },
        { id: "visibility", type: "actionVisibility", x: 240, y: 0, config: { targetId: "group", mode: "hide" } },
      ],
      links: [{ id: "export-link", from: "event", fromPort: "next", to: "visibility" }],
    }],
  },
});
const generatedSandbox = {};
vm.runInNewContext(generateAthenaScene(scene), generatedSandbox);
assert.equal(generatedSandbox.EDITOR_LOGIC.graphs.length, 1);
assert.deepEqual(Array.from(generatedSandbox.EDITOR_LOGIC.graphs[0].nodes[1].config.targetIds), ["model"]);
assert.equal(generatedSandbox.EDITOR_SCENE[0].persistent, true);
assert.equal(generatedSandbox.EDITOR_PORTALS[0].condition.variableId, variable.id);

console.log("Visual scripting test passed.");
