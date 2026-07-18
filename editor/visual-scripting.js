const identifierPattern = /[^a-zA-Z0-9_-]/g;

export const LOGIC_LIMITS = Object.freeze({
  graphs: 32,
  nodesPerGraph: 128,
  linksPerGraph: 256,
  variables: 64,
});

export const LOGIC_NODE_DEFINITIONS = Object.freeze({
  eventStart: { category: "event", label: "Ao iniciar", inputs: [], outputs: ["next"] },
  eventTrigger: { category: "event", label: "Trigger", inputs: [], outputs: ["next"] },
  eventInput: { category: "event", label: "Botão pressionado", inputs: [], outputs: ["next"] },
  eventTimer: { category: "event", label: "Temporizador", inputs: [], outputs: ["next"] },
  eventPlayerJump: { category: "event", label: "Jogador pulou", inputs: [], outputs: ["next"] },
  eventGameplay: { category: "event", label: "Evento de gameplay", inputs: [], outputs: ["next"] },
  conditionVariable: { category: "condition", label: "Comparar variável", inputs: ["in"], outputs: ["true", "false"] },
  actionMessage: { category: "action", label: "Mostrar mensagem", inputs: ["in"], outputs: ["next"] },
  actionDisplayVariable: { category: "action", label: "Mostrar variável", inputs: ["in"], outputs: ["next"] },
  actionVisibility: { category: "action", label: "Alterar visibilidade", inputs: ["in"], outputs: ["next"] },
  actionTeleport: { category: "action", label: "Teletransportar", inputs: ["in"], outputs: ["next"] },
  actionAudio: { category: "action", label: "Controlar áudio", inputs: ["in"], outputs: ["next"] },
  actionParticle: { category: "action", label: "Controlar partículas", inputs: ["in"], outputs: ["next"] },
  actionVideo: { category: "action", label: "Controlar vídeo", inputs: ["in"], outputs: ["next"] },
  actionSaveGame: { category: "action", label: "Salvar jogo", inputs: ["in"], outputs: ["next"] },
  actionLoadGame: { category: "action", label: "Carregar jogo", inputs: ["in"], outputs: ["next"] },
  actionDamage: { category: "action", label: "Aplicar dano", inputs: ["in"], outputs: ["next"] },
  actionHeal: { category: "action", label: "Restaurar vida", inputs: ["in"], outputs: ["next"] },
  actionRespawn: { category: "action", label: "Renascer", inputs: ["in"], outputs: ["next"] },
  actionScene: { category: "action", label: "Trocar de cena", inputs: ["in"], outputs: [] },
  actionSetVariable: { category: "variable", label: "Alterar variável", inputs: ["in"], outputs: ["next"] },
  flowDelay: { category: "flow", label: "Esperar", inputs: ["in"], outputs: ["next"] },
});

export const LOGIC_BUTTONS = Object.freeze([
  "CROSS", "CIRCLE", "SQUARE", "TRIANGLE",
  "UP", "DOWN", "LEFT", "RIGHT",
  "L1", "R1", "L2", "R2", "L3", "R3", "START", "SELECT",
]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safeId(value, fallback) {
  return String(value || fallback).replace(identifierPattern, "-").slice(0, 96) || fallback;
}

function safeText(value, fallback, limit) {
  return String(value === undefined || value === null ? fallback : value).slice(0, limit);
}

function primitive(value) {
  if (["string", "number", "boolean"].includes(typeof value)) return value;
  return false;
}

function vector(value, fallback) {
  return {
    x: finite(value?.x, fallback.x),
    y: finite(value?.y, fallback.y),
    z: finite(value?.z, fallback.z),
  };
}

function normalizeNodeConfig(type, config = {}) {
  switch (type) {
    case "eventTrigger":
      return {
        triggerId: safeId(config.triggerId, ""),
        phase: ["onEnter", "onExit", "onInteract"].includes(config.phase) ? config.phase : "onEnter",
      };
    case "eventInput":
      return { button: LOGIC_BUTTONS.includes(config.button) ? config.button : "TRIANGLE" };
    case "eventTimer":
      return {
        intervalFrames: Math.round(Math.max(1, Math.min(216000, finite(config.intervalFrames, 60)))),
        repeat: config.repeat !== false,
      };
    case "eventGameplay":
      return {
        componentId: safeId(config.componentId, ""),
        event: ["damaged", "healed", "death", "collected", "interacted", "entered", "activated", "respawn"].includes(config.event)
          ? config.event
          : "interacted",
      };
    case "conditionVariable":
      return {
        variableId: safeId(config.variableId, ""),
        operator: ["eq", "neq", "gt", "gte", "lt", "lte"].includes(config.operator) ? config.operator : "eq",
        value: primitive(config.value),
      };
    case "actionMessage":
      return {
        text: safeText(config.text, "Uma passagem foi encontrada.", 160),
        duration: Math.round(Math.max(1, Math.min(3600, finite(config.duration, 180)))),
      };
    case "actionDisplayVariable":
      return {
        variableId: safeId(config.variableId, ""),
        prefix: safeText(config.prefix, "Valor: ", 80),
        duration: Math.round(Math.max(1, Math.min(3600, finite(config.duration, 180)))),
      };
    case "actionVisibility":
      return {
        targetId: safeId(config.targetId, ""),
        mode: ["toggle", "show", "hide"].includes(config.mode) ? config.mode : "toggle",
      };
    case "actionTeleport":
      return { position: vector(config.position, { x: 0, y: 0.08, z: 18 }) };
    case "actionAudio":
      return {
        targetId: safeId(config.targetId, ""),
        mode: ["play", "stop"].includes(config.mode) ? config.mode : "play",
      };
    case "actionParticle":
      return {
        targetId: safeId(config.targetId, ""),
        mode: ["start", "stop", "burst"].includes(config.mode) ? config.mode : "burst",
      };
    case "actionVideo":
      return {
        targetId: safeId(config.targetId, ""),
        mode: ["play", "pause", "stop"].includes(config.mode) ? config.mode : "play",
      };
    case "actionDamage":
    case "actionHeal":
      return {
        targetId: safeId(config.targetId, "__player__"),
        amount: Math.max(0, Math.min(999999, finite(config.amount, 10))),
      };
    case "actionRespawn":
      return { fadeFrames: Math.round(Math.max(1, Math.min(300, finite(config.fadeFrames, 24)))) };
    case "actionScene":
      return {
        sceneId: safeId(config.sceneId, ""),
        spawnId: safeId(config.spawnId, ""),
        fadeFrames: Math.round(Math.max(1, Math.min(300, finite(config.fadeFrames, 30)))),
      };
    case "actionSetVariable":
      return {
        variableId: safeId(config.variableId, ""),
        operation: ["set", "add", "subtract", "toggle"].includes(config.operation) ? config.operation : "set",
        value: primitive(config.value),
      };
    case "flowDelay":
      return { frames: Math.round(Math.max(1, Math.min(216000, finite(config.frames, 60)))) };
    default:
      return {};
  }
}

function defaultConfig(type) {
  return normalizeNodeConfig(type, {});
}

export function createLogicNode(type, idFactory, position = {}) {
  const safeType = LOGIC_NODE_DEFINITIONS[type] ? type : "actionMessage";
  return {
    id: safeId(idFactory?.("node"), `node-${Date.now().toString(36)}`),
    type: safeType,
    x: Math.max(0, Math.min(4000, finite(position.x, 120))),
    y: Math.max(0, Math.min(3000, finite(position.y, 120))),
    config: defaultConfig(safeType),
  };
}

export function createLogicGraph(name, idFactory, withStart = true) {
  const graph = {
    id: safeId(idFactory?.("graph"), `graph-${Date.now().toString(36)}`),
    name: safeText(name, "Novo fluxo", 120),
    enabled: true,
    nodes: [],
    links: [],
  };
  if (withStart) graph.nodes.push(createLogicNode("eventStart", idFactory, { x: 90, y: 120 }));
  return graph;
}

export function createLogicVariable(name, type, idFactory) {
  const safeType = ["boolean", "number", "string"].includes(type) ? type : "boolean";
  return {
    id: safeId(idFactory?.("variable"), `variable-${Date.now().toString(36)}`),
    name: safeText(name, "Nova variável", 80),
    type: safeType,
    initialValue: safeType === "number" ? 0 : safeType === "string" ? "" : false,
  };
}

export function normalizeLogic(input = {}, idFactory) {
  const variables = [];
  const variableIds = new Set();
  for (let index = 0; index < Math.min(LOGIC_LIMITS.variables, Array.isArray(input?.variables) ? input.variables.length : 0); index++) {
    const source = input.variables[index] || {};
    let id = safeId(source.id, `variable-${index}`);
    if (variableIds.has(id)) id = safeId(idFactory?.("variable"), `variable-${index}-${variableIds.size}`);
    variableIds.add(id);
    const type = ["boolean", "number", "string"].includes(source.type) ? source.type : "boolean";
    variables.push({
      id,
      name: safeText(source.name, `Variável ${index + 1}`, 80),
      type,
      initialValue: type === "number"
        ? finite(source.initialValue, 0)
        : type === "string" ? safeText(source.initialValue, "", 160) : source.initialValue === true,
    });
  }

  const graphs = [];
  const graphIds = new Set();
  const sourceGraphs = Array.isArray(input?.graphs) ? input.graphs : [];
  for (let graphIndex = 0; graphIndex < Math.min(LOGIC_LIMITS.graphs, sourceGraphs.length); graphIndex++) {
    const sourceGraph = sourceGraphs[graphIndex] || {};
    let graphId = safeId(sourceGraph.id, `graph-${graphIndex}`);
    if (graphIds.has(graphId)) graphId = safeId(idFactory?.("graph"), `graph-${graphIndex}-${graphIds.size}`);
    graphIds.add(graphId);
    const nodes = [];
    const nodeIds = new Set();
    const sourceNodes = Array.isArray(sourceGraph.nodes) ? sourceGraph.nodes : [];
    for (let nodeIndex = 0; nodeIndex < Math.min(LOGIC_LIMITS.nodesPerGraph, sourceNodes.length); nodeIndex++) {
      const sourceNode = sourceNodes[nodeIndex] || {};
      const type = LOGIC_NODE_DEFINITIONS[sourceNode.type] ? sourceNode.type : "actionMessage";
      let nodeId = safeId(sourceNode.id, `node-${nodeIndex}`);
      if (nodeIds.has(nodeId)) nodeId = safeId(idFactory?.("node"), `node-${nodeIndex}-${nodeIds.size}`);
      nodeIds.add(nodeId);
      nodes.push({
        id: nodeId,
        type,
        x: Math.max(0, Math.min(4000, finite(sourceNode.x, 100 + nodeIndex * 32))),
        y: Math.max(0, Math.min(3000, finite(sourceNode.y, 100 + nodeIndex * 32))),
        config: normalizeNodeConfig(type, sourceNode.config),
      });
    }

    const links = [];
    const linkKeys = new Set();
    const linkIds = new Set();
    const sourceLinks = Array.isArray(sourceGraph.links) ? sourceGraph.links : [];
    for (let linkIndex = 0; linkIndex < Math.min(LOGIC_LIMITS.linksPerGraph, sourceLinks.length); linkIndex++) {
      const sourceLink = sourceLinks[linkIndex] || {};
      const from = safeId(sourceLink.from, "");
      const to = safeId(sourceLink.to, "");
      if (!nodeIds.has(from) || !nodeIds.has(to)) continue;
      const fromNode = nodes.find((node) => node.id === from);
      const outputs = LOGIC_NODE_DEFINITIONS[fromNode.type].outputs;
      const fromPort = outputs.includes(sourceLink.fromPort) ? sourceLink.fromPort : outputs[0];
      if (!fromPort || !LOGIC_NODE_DEFINITIONS[nodes.find((node) => node.id === to).type].inputs.length) continue;
      const key = `${from}:${fromPort}:${to}`;
      if (linkKeys.has(key)) continue;
      linkKeys.add(key);
      let linkId = safeId(sourceLink.id, `link-${linkIndex}`);
      if (linkIds.has(linkId)) linkId = safeId(idFactory?.("link"), `link-${linkIndex}-${linkIds.size}`);
      linkIds.add(linkId);
      links.push({
        id: linkId,
        from,
        fromPort,
        to,
      });
    }
    graphs.push({
      id: graphId,
      name: safeText(sourceGraph.name, `Fluxo ${graphIndex + 1}`, 120),
      enabled: sourceGraph.enabled !== false,
      nodes,
      links,
    });
  }
  return { version: 1, variables, graphs };
}

export function validateLogic(logic = {}) {
  const issues = [];
  const variables = new Set((logic.variables || []).map((variable) => variable.id));
  for (const graph of logic.graphs || []) {
    if (!(graph.nodes || []).some((node) => LOGIC_NODE_DEFINITIONS[node.type]?.category === "event")) {
      issues.push(`${graph.name}: não possui um nó de evento.`);
    }
    const incoming = new Set();
    const outgoing = new Set();
    for (const link of graph.links || []) {
      outgoing.add(link.from);
      incoming.add(link.to);
    }
    for (const node of graph.nodes || []) {
      const config = node.config || {};
      if (LOGIC_NODE_DEFINITIONS[node.type]?.inputs.length && !incoming.has(node.id)) {
        issues.push(`${graph.name}: “${LOGIC_NODE_DEFINITIONS[node.type].label}” está desconectado.`);
      }
      if (LOGIC_NODE_DEFINITIONS[node.type]?.category === "event" && !outgoing.has(node.id)) {
        issues.push(`${graph.name}: “${LOGIC_NODE_DEFINITIONS[node.type].label}” não está ligado a uma ação.`);
      }
      if (["conditionVariable", "actionSetVariable", "actionDisplayVariable"].includes(node.type) && !variables.has(config.variableId)) {
        issues.push(`${graph.name}: um nó referencia uma variável inexistente.`);
      }
      if (node.type === "eventTrigger" && !config.triggerId) issues.push(`${graph.name}: um evento de trigger está sem alvo.`);
      if (node.type === "eventGameplay" && !config.componentId) issues.push(`${graph.name}: evento de gameplay sem componente.`);
      if (["actionVisibility", "actionAudio", "actionParticle", "actionVideo"].includes(node.type) && !config.targetId) {
        issues.push(`${graph.name}: “${LOGIC_NODE_DEFINITIONS[node.type].label}” está sem alvo.`);
      }
      if (["actionDamage", "actionHeal"].includes(node.type) && !config.targetId) {
        issues.push(`${graph.name}: acao de Vida sem alvo.`);
      }
      if (node.type === "actionScene" && !config.sceneId) {
        issues.push(`${graph.name}: “${LOGIC_NODE_DEFINITIONS[node.type].label}” está sem cena de destino.`);
      }
    }
  }
  return issues;
}
