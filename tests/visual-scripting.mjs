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
import { builtinPrefabs } from "../editor/builtin-prefabs.mjs";
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
const saveGame = createLogicNode("actionSaveGame", id, { x: 1450, y: 20 });
const loadGame = createLogicNode("actionLoadGame", id, { x: 1450, y: 180 });
const changeScene = createLogicNode("actionScene", id, { x: 1690, y: 20 });
changeScene.config = { sceneId: "temple", spawnId: "temple-gate", fadeFrames: 24 };
graph.nodes.push(start, setVariable, condition, message, delay, secondMessage, saveGame, changeScene);
graph.links.push(
  { id: id("link"), from: start.id, fromPort: "next", to: setVariable.id },
  { id: id("link"), from: setVariable.id, fromPort: "next", to: condition.id },
  { id: id("link"), from: condition.id, fromPort: "true", to: message.id },
  { id: id("link"), from: message.id, fromPort: "next", to: delay.id },
  { id: id("link"), from: delay.id, fromPort: "next", to: secondMessage.id },
  { id: id("link"), from: secondMessage.id, fromPort: "next", to: saveGame.id },
  { id: id("link"), from: saveGame.id, fromPort: "next", to: changeScene.id },
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

const gameplayGraph = createLogicGraph("Interação de gameplay", id, false);
const gameplayEvent = createLogicNode("eventGameplay", id, { x: 10, y: 340 });
gameplayEvent.config = { componentId: "trigger-interactable", event: "interacted" };
const damagePlayer = createLogicNode("actionDamage", id, { x: 250, y: 340 });
damagePlayer.config = { targetId: "__player__", amount: 12 };
const healPlayer = createLogicNode("actionHeal", id, { x: 490, y: 340 });
healPlayer.config = { targetId: "__player__", amount: 3 };
const animatePlayer = createLogicNode("actionCharacterState", id, { x: 730, y: 340 });
animatePlayer.config = { targetId: "__player__", state: "attack", durationFrames: 30 };
const respawnPlayer = createLogicNode("actionRespawn", id, { x: 970, y: 340 });
respawnPlayer.config = { fadeFrames: 18 };
gameplayGraph.nodes.push(gameplayEvent, damagePlayer, healPlayer, animatePlayer, respawnPlayer);
gameplayGraph.links.push(
  { id: id("link"), from: gameplayEvent.id, fromPort: "next", to: damagePlayer.id },
  { id: id("link"), from: damagePlayer.id, fromPort: "next", to: healPlayer.id },
  { id: id("link"), from: healPlayer.id, fromPort: "next", to: animatePlayer.id },
  { id: id("link"), from: animatePlayer.id, fromPort: "next", to: respawnPlayer.id },
);

const normalized = normalizeLogic({ variables: [variable, jumpVariable], graphs: [graph, jumpGraph, gameplayGraph] }, id);
assert.equal(validateLogic(normalized).length, 0, "valid graph should not report issues");
assert.equal(normalized.graphs[0].nodes.length, 8);
assert.deepEqual(loadGame.config, {}, "load nodes must not accept arbitrary file paths or code");

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
assert.deepEqual(actions.find((entry) => entry.type === "actionSaveGame")?.config, {});
runtime.playerJump();
assert.equal(sharedVariables[jumpVariable.id], 1, "a real jump event must increment the shared counter");
assert.deepEqual(actions.find((entry) => entry.type === "actionDisplayVariable")?.config, {
  variableId: jumpVariable.id, prefix: "Pulos: ", duration: 120,
});
runtime.gameplay("trigger-interactable", "interacted", { triggerId: "trigger" });
assert.deepEqual(actions.find((entry) => entry.type === "actionDamage")?.config, { targetId: "__player__", amount: 12 });
assert.deepEqual(actions.find((entry) => entry.type === "actionHeal")?.config, { targetId: "__player__", amount: 3 });
assert.deepEqual(actions.find((entry) => entry.type === "actionCharacterState")?.config, {
  targetId: "__player__", state: "attack", durationFrames: 30,
});
assert.deepEqual(actions.find((entry) => entry.type === "actionRespawn")?.config, { fadeFrames: 18 });
const nextSceneRuntime = sandbox.VisualScriptingRuntime.create({ variables: normalized.variables, graphs: [] }, {
  readVariable(variableId, initialValue) { return sharedVariables[variableId] ?? initialValue; },
});
assert.equal(nextSceneRuntime.getVariable(variable.id), true, "a new scene runtime must reuse the shared variable value");
assert.equal(nextSceneRuntime.getVariable(jumpVariable.id), 1, "the jump counter must survive a scene runtime replacement");

const scene = normalizeScene({
  name: "Logic export",
  settings: { runtime: { legacyArenaBounds: false, player: {
    modelAsset: "imported/hero.gltf",
    character: { enabled: true, states: { idle: "Idle", walk: "Walk", attack: "Attack" } },
    health: { enabled: true, maximum: 120, initial: 90 },
  } } },
  objects: [
    { id: "group", name: "Grupo", source: { kind: "group" } },
    {
      id: "model", name: "Modelo", parentId: "group", persistent: true, source: { kind: "model", asset: "imported/enemy.gltf" },
      character: { enabled: true, initialState: "idle", hurtFrames: 18, states: { idle: "Idle", hurt: "Hit", death: "Death" } },
      gameplay: { health: { enabled: true, maximum: 40, initial: 25, persistent: true } },
    },
    {
      id: "trigger", name: "Trigger", source: { kind: "collider", collider: "box" }, collider: { trigger: true },
      portal: {
        enabled: true, targetSceneId: "temple", targetSpawnId: "temple-gate", activation: "onEnter", fadeFrames: 24,
        condition: { enabled: true, variableId: variable.id, operator: "eq", value: true },
      },
      checkpoint: { enabled: true, activation: "onInteract", autosave: true },
      gameplay: {
        damage: { enabled: true, targetId: "__player__", amount: 8, activation: "onEnter", cooldownFrames: 20 },
        collectible: { enabled: true, variableId: variable.id, amount: 1, activation: "onInteract", visualTargetId: "group", message: "Coletado" },
        interactable: { enabled: true, prompt: "Usar", once: true },
        deathZone: { enabled: true, fadeFrames: 16 },
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
assert.deepEqual({ ...generatedSandbox.EDITOR_CHECKPOINTS[0] }, {
  triggerId: "trigger", activation: "onInteract", autosave: true,
});
assert.equal(generatedSandbox.EDITOR_SETTINGS.player.health.maximum, 120);
assert.equal(generatedSandbox.EDITOR_SETTINGS.player.modelAsset, "imported/hero.gltf");
assert.equal(generatedSandbox.EDITOR_SETTINGS.player.character.states.attack, "Attack");
assert.equal(generatedSandbox.EDITOR_SCENE[0].character.states.death, "Death");
assert.equal(generatedSandbox.EDITOR_GAMEPLAY_COMPONENTS.length, 5);
assert.deepEqual(Array.from(generatedSandbox.EDITOR_GAMEPLAY_COMPONENTS.find((item) => item.type === "collectible").visualTargetIds), ["model"]);
assert.equal(generatedSandbox.EDITOR_GAMEPLAY_COMPONENTS.find((item) => item.type === "health").persistent, true);

assert(builtinPrefabs.length >= 8, "the editor must ship a useful built-in prefab library");
const coinPrefab = builtinPrefabs.find((prefab) => prefab.id === "builtin-coin");
assert.equal(coinPrefab.variables[0].name, "Moedas");
assert.equal(coinPrefab.objects.find((object) => object.id === "coin-trigger").gameplay.collectible.visualTargetId, "coin-root");
assert(builtinPrefabs.find((prefab) => prefab.id === "builtin-spikes").requirements.playerHealth,
  "hazard prefabs must declare their player health requirement");

console.log("Visual scripting test passed.");
