const transform = (position = {}, rotation = {}, scale = {}) => ({
  position: { x: position.x || 0, y: position.y || 0, z: position.z || 0 },
  rotation: { x: rotation.x || 0, y: rotation.y || 0, z: rotation.z || 0 },
  scale: { x: scale.x ?? 1, y: scale.y ?? 1, z: scale.z ?? 1 },
});

const primitive = (id, name, primitiveName, options = {}) => ({
  id,
  name,
  source: { kind: "primitive", primitive: primitiveName, asset: `editor_primitives/${primitiveName}.obj` },
  parentId: options.parentId || null,
  ...transform(options.position, options.rotation, options.scale),
  material: {
    color: options.color || "#ffffff",
    emissive: options.emissive || "#000000",
    emissiveIntensity: options.emissiveIntensity || 0,
    roughness: options.roughness ?? 0.72,
    metalness: options.metalness ?? 0,
  },
  ...(options.gameplay ? { gameplay: options.gameplay } : {}),
  ...(options.persistent ? { persistent: true } : {}),
});

const collider = (id, name, shape, options = {}) => ({
  id,
  name,
  source: { kind: "collider", collider: shape, asset: "" },
  parentId: options.parentId || null,
  ...transform(options.position, options.rotation, options.scale),
  color: options.color || "#72e6aa",
  collider: { trigger: options.trigger !== false, cameraBlocker: options.cameraBlocker === true },
  ...(options.gameplay ? { gameplay: options.gameplay } : {}),
  ...(options.checkpoint ? { checkpoint: options.checkpoint } : {}),
});

const group = (id, name, options = {}) => ({
  id,
  name,
  source: { kind: "group", asset: "" },
  parentId: options.parentId || null,
  ...transform(options.position, options.rotation, options.scale),
});

export const builtinPrefabs = [
  {
    version: 2,
    id: "builtin-coin",
    name: "Moeda",
    category: "collectibles",
    description: "Moeda dourada com contador global, coleta automática e estado persistente.",
    icon: "+",
    builtin: true,
    variables: [{ id: "builtin-coins", key: "coins", name: "Moedas", type: "number", initialValue: 0 }],
    objects: [
      group("coin-root", "Moeda"),
      primitive("coin-visual", "Visual da moeda", "cylinder", {
        parentId: "coin-root", position: { y: 0.78 }, scale: { x: 0.42, y: 0.08, z: 0.42 },
        color: "#ffd166", emissive: "#7a4b00", emissiveIntensity: 0.45, metalness: 0.65, roughness: 0.28,
      }),
      collider("coin-trigger", "Coletar moeda", "sphere", {
        parentId: "coin-root", position: { y: 0.78 }, scale: { x: 0.68, y: 0.68, z: 0.68 }, color: "#ffd166",
        gameplay: { collectible: {
          enabled: true, variableId: "builtin-coins", amount: 1, activation: "onEnter",
          visualTargetId: "coin-root", message: "Moeda coletada.", autosave: false,
        } },
      }),
    ],
  },
  {
    version: 2,
    id: "builtin-key",
    name: "Chave",
    category: "collectibles",
    description: "Chave reutilizável em condições de portal e grafos de lógica.",
    icon: "⌘",
    builtin: true,
    variables: [{ id: "builtin-keys", key: "keys", name: "Chaves", type: "number", initialValue: 0 }],
    objects: [
      group("key-root", "Chave"),
      primitive("key-handle", "Cabo da chave", "cylinder", {
        parentId: "key-root", position: { y: 0.88 }, rotation: { z: 90 }, scale: { x: 0.3, y: 0.08, z: 0.3 },
        color: "#f4c96b", metalness: 0.8, roughness: 0.22,
      }),
      primitive("key-shaft", "Haste da chave", "cube", {
        parentId: "key-root", position: { x: 0.58, y: 0.88 }, scale: { x: 0.68, y: 0.09, z: 0.09 },
        color: "#f4c96b", metalness: 0.8, roughness: 0.22,
      }),
      primitive("key-tooth", "Dente da chave", "cube", {
        parentId: "key-root", position: { x: 1.1, y: 0.72 }, scale: { x: 0.12, y: 0.25, z: 0.09 },
        color: "#f4c96b", metalness: 0.8, roughness: 0.22,
      }),
      collider("key-trigger", "Coletar chave", "sphere", {
        parentId: "key-root", position: { x: 0.45, y: 0.82 }, scale: { x: 0.95, y: 0.62, z: 0.62 }, color: "#ffd166",
        gameplay: { collectible: {
          enabled: true, variableId: "builtin-keys", amount: 1, activation: "onEnter",
          visualTargetId: "key-root", message: "Chave encontrada.", autosave: true,
        } },
      }),
    ],
  },
  {
    version: 2,
    id: "builtin-chest",
    name: "Baú interagível",
    category: "interaction",
    description: "Baú com área de interação. O evento Interagido pode entregar qualquer recompensa no Visual Scripting.",
    icon: "▣",
    builtin: true,
    objects: [
      group("chest-root", "Baú interagível"),
      primitive("chest-base", "Base do baú", "cube", {
        parentId: "chest-root", position: { y: 0.45 }, scale: { x: 0.9, y: 0.45, z: 0.62 },
        color: "#6b3e22", roughness: 0.78,
      }),
      primitive("chest-lid", "Tampa do baú", "cube", {
        parentId: "chest-root", position: { y: 0.92 }, scale: { x: 0.94, y: 0.18, z: 0.66 },
        color: "#8c552e", roughness: 0.7,
      }),
      primitive("chest-lock", "Fecho do baú", "cube", {
        parentId: "chest-root", position: { y: 0.72, z: -0.66 }, scale: { x: 0.16, y: 0.24, z: 0.08 },
        color: "#d4aa55", metalness: 0.75, roughness: 0.3,
      }),
      collider("chest-trigger", "Interagir com baú", "box", {
        parentId: "chest-root", position: { y: 0.65, z: -0.45 }, scale: { x: 1.25, y: 0.9, z: 1.15 },
        gameplay: { interactable: { enabled: true, prompt: "Pressione Triangulo para abrir o bau", once: true } },
      }),
    ],
  },
  {
    version: 2,
    id: "builtin-door",
    name: "Porta interagível",
    category: "interaction",
    description: "Porta com prompt e evento Interagido para ligar a troca de cena ou uma animação no Visual Scripting.",
    icon: "▯",
    builtin: true,
    objects: [
      group("door-root", "Porta interagível"),
      primitive("door-frame-left", "Batente esquerdo", "cube", {
        parentId: "door-root", position: { x: -1.2, y: 1.6 }, scale: { x: 0.22, y: 1.6, z: 0.28 }, color: "#3b4650",
      }),
      primitive("door-frame-right", "Batente direito", "cube", {
        parentId: "door-root", position: { x: 1.2, y: 1.6 }, scale: { x: 0.22, y: 1.6, z: 0.28 }, color: "#3b4650",
      }),
      primitive("door-frame-top", "Batente superior", "cube", {
        parentId: "door-root", position: { y: 3.2 }, scale: { x: 1.42, y: 0.2, z: 0.28 }, color: "#3b4650",
      }),
      primitive("door-panel", "Folha da porta", "cube", {
        parentId: "door-root", position: { y: 1.48 }, scale: { x: 1.0, y: 1.48, z: 0.16 }, color: "#69442d", persistent: true,
      }),
      collider("door-interaction", "Interagir com porta", "box", {
        parentId: "door-root", position: { y: 1.45, z: -0.65 }, scale: { x: 1.35, y: 1.5, z: 0.8 },
        gameplay: { interactable: { enabled: true, prompt: "Pressione Triangulo para usar a porta", once: false } },
      }),
    ],
  },
  {
    version: 2,
    id: "builtin-spikes",
    name: "Espinhos",
    category: "hazards",
    description: "Armadilha visual com dano ao jogador e tempo de recarga seguro.",
    icon: "▲",
    builtin: true,
    requirements: { playerHealth: true },
    objects: [
      group("spikes-root", "Espinhos"),
      primitive("spike-left", "Espinho esquerdo", "cone", {
        parentId: "spikes-root", position: { x: -0.65, y: 0.55 }, scale: { x: 0.45, y: 0.7, z: 0.45 }, color: "#8c939b", metalness: 0.45,
      }),
      primitive("spike-center", "Espinho central", "cone", {
        parentId: "spikes-root", position: { y: 0.72 }, scale: { x: 0.52, y: 0.9, z: 0.52 }, color: "#a8afb6", metalness: 0.45,
      }),
      primitive("spike-right", "Espinho direito", "cone", {
        parentId: "spikes-root", position: { x: 0.65, y: 0.55 }, scale: { x: 0.45, y: 0.7, z: 0.45 }, color: "#8c939b", metalness: 0.45,
      }),
      collider("spikes-trigger", "Dano dos espinhos", "box", {
        parentId: "spikes-root", position: { y: 0.55 }, scale: { x: 1.25, y: 0.7, z: 0.75 }, color: "#ff647c",
        gameplay: { damage: { enabled: true, targetId: "__player__", amount: 20, activation: "onEnter", cooldownFrames: 45 } },
      }),
    ],
  },
  {
    version: 2,
    id: "builtin-death-zone",
    name: "Área de queda",
    category: "hazards",
    description: "Volume de morte que devolve o jogador ao checkpoint pelo ciclo seguro de cenas.",
    icon: "×",
    builtin: true,
    requirements: { playerHealth: true },
    objects: [
      collider("death-zone", "Área de queda", "box", {
        position: { y: -1 }, scale: { x: 4, y: 0.35, z: 4 }, color: "#ff647c",
        gameplay: { deathZone: { enabled: true, fadeFrames: 24 } },
      }),
    ],
  },
  {
    version: 2,
    id: "builtin-checkpoint",
    name: "Checkpoint",
    category: "progression",
    description: "Checkpoint automático com gravação verificada no Memory Card.",
    icon: "◆",
    builtin: true,
    objects: [
      collider("checkpoint", "Checkpoint", "box", {
        position: { y: 1 }, scale: { x: 1.25, y: 1, z: 1.25 }, color: "#62c6ff",
        checkpoint: { enabled: true, activation: "onEnter", autosave: true },
      }),
    ],
  },
  {
    version: 2,
    id: "builtin-training-dummy",
    name: "Alvo de treino",
    category: "combat",
    description: "Objeto destrutível com Vida persistente, pronto para receber dano por grafos ou triggers.",
    icon: "◎",
    builtin: true,
    objects: [
      primitive("training-dummy", "Alvo de treino", "cylinder", {
        position: { y: 1.15 }, scale: { x: 0.62, y: 1.15, z: 0.62 }, color: "#a86f3f", roughness: 0.86, persistent: true,
        gameplay: { health: {
          enabled: true, maximum: 50, initial: 50, invulnerabilityFrames: 10, hideOnDeath: true, persistent: true,
        } },
      }),
    ],
  },
];
