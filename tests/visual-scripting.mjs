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
graph.nodes.push(start, setVariable, condition, message, delay, secondMessage);
graph.links.push(
  { id: id("link"), from: start.id, fromPort: "next", to: setVariable.id },
  { id: id("link"), from: setVariable.id, fromPort: "next", to: condition.id },
  { id: id("link"), from: condition.id, fromPort: "true", to: message.id },
  { id: id("link"), from: message.id, fromPort: "next", to: delay.id },
  { id: id("link"), from: delay.id, fromPort: "next", to: secondMessage.id },
);

const normalized = normalizeLogic({ variables: [variable], graphs: [graph] }, id);
assert.equal(validateLogic(normalized).length, 0, "valid graph should not report issues");
assert.equal(normalized.graphs[0].nodes.length, 6);

const sandbox = { console, globalThis: null };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(new URL("../assets/visual-scripting-runtime.js", import.meta.url), "utf8"), sandbox);
const actions = [];
const runtime = sandbox.VisualScriptingRuntime.create(normalized, {
  execute(type, config) { actions.push({ type, config }); },
  buttonPressed() { return false; },
});
runtime.start();
assert.equal(runtime.getVariable(variable.id), true);
assert.deepEqual(actions.map((entry) => entry.config.text), ["Porta aberta"]);
runtime.step();
assert.equal(actions.length, 1, "delay must wait for the configured frame count");
runtime.step();
assert.deepEqual(actions.map((entry) => entry.config.text), ["Porta aberta", "Depois"]);

const scene = normalizeScene({
  name: "Logic export",
  settings: { runtime: { legacyArenaBounds: false } },
  objects: [
    { id: "group", name: "Grupo", source: { kind: "group" } },
    { id: "model", name: "Modelo", parentId: "group", source: { kind: "model", asset: "scene_0.obj" } },
    { id: "trigger", name: "Trigger", source: { kind: "collider", collider: "box" }, collider: { trigger: true } },
  ],
  logic: {
    variables: [],
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

console.log("Visual scripting test passed.");
