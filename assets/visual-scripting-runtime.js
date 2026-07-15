// Runtime seguro para os grafos gerados pelo Athena Visual Editor.
// Mantém a execução interpretada e limitada; nenhum texto do editor vira código.
(function (root) {
    const MAX_STEPS_PER_EVENT = 128;

    function copyPrimitive(value) {
        if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;
        return false;
    }

    function compare(left, operator, right) {
        if (operator === "neq") return left !== right;
        if (operator === "gt") return Number(left) > Number(right);
        if (operator === "gte") return Number(left) >= Number(right);
        if (operator === "lt") return Number(left) < Number(right);
        if (operator === "lte") return Number(left) <= Number(right);
        return left === right;
    }

    function create(definition, handlers) {
        const source = definition || {};
        const callbacks = handlers || {};
        const variables = {};
        const variableTypes = {};
        const graphs = [];
        const timers = [];
        const delayed = [];
        let frame = 0;
        let started = false;

        const sourceVariables = source.variables || [];
        for (let variableIndex = 0; variableIndex < sourceVariables.length; variableIndex++) {
            const variable = sourceVariables[variableIndex];
            variables[variable.id] = copyPrimitive(variable.initialValue);
            variableTypes[variable.id] = variable.type || typeof variable.initialValue;
        }

        const sourceGraphs = source.graphs || [];
        for (let graphIndex = 0; graphIndex < sourceGraphs.length; graphIndex++) {
            const sourceGraph = sourceGraphs[graphIndex];
            if (sourceGraph.enabled === false) continue;
            const graph = { source: sourceGraph, nodes: {}, links: {} };
            const nodes = sourceGraph.nodes || [];
            for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
                const node = nodes[nodeIndex];
                graph.nodes[node.id] = node;
                if (node.type === "eventTimer") {
                    timers.push({
                        graph: graph,
                        node: node,
                        nextFrame: Math.max(1, Number(node.config && node.config.intervalFrames) || 60),
                        finished: false
                    });
                }
            }
            const links = sourceGraph.links || [];
            for (let linkIndex = 0; linkIndex < links.length; linkIndex++) {
                const link = links[linkIndex];
                const key = link.from + ":" + (link.fromPort || "next");
                if (!graph.links[key]) graph.links[key] = [];
                graph.links[key].push(link.to);
            }
            graphs.push(graph);
        }

        function linkedNodes(graph, nodeId, port) {
            return graph.links[nodeId + ":" + port] || [];
        }

        function enqueueLinked(queue, graph, nodeId, port, payload) {
            const targets = linkedNodes(graph, nodeId, port);
            for (let index = 0; index < targets.length; index++) {
                queue.push({ graph: graph, nodeId: targets[index], payload: payload });
            }
        }

        function setVariable(config) {
            if (!config || variables[config.variableId] === undefined) return;
            const id = config.variableId;
            const operation = config.operation || "set";
            if (operation === "toggle") {
                variables[id] = !Boolean(variables[id]);
                return;
            }
            if (operation === "add" || operation === "subtract") {
                const delta = Number(config.value) || 0;
                const current = Number(variables[id]) || 0;
                variables[id] = operation === "add" ? current + delta : current - delta;
                return;
            }
            if (variableTypes[id] === "number") variables[id] = Number(config.value) || 0;
            else if (variableTypes[id] === "string") variables[id] = String(config.value === undefined ? "" : config.value);
            else variables[id] = Boolean(config.value);
        }

        function executeFrom(graph, sourceNode, port, payload) {
            const queue = [];
            enqueueLinked(queue, graph, sourceNode.id, port || "next", payload);
            let steps = 0;
            while (queue.length && steps < MAX_STEPS_PER_EVENT) {
                const entry = queue.shift();
                const node = entry.graph.nodes[entry.nodeId];
                if (!node) continue;
                steps++;
                const config = node.config || {};
                if (node.type === "conditionVariable") {
                    const result = compare(variables[config.variableId], config.operator || "eq", config.value);
                    enqueueLinked(queue, entry.graph, node.id, result ? "true" : "false", entry.payload);
                    continue;
                }
                if (node.type === "actionSetVariable") {
                    setVariable(config);
                    enqueueLinked(queue, entry.graph, node.id, "next", entry.payload);
                    continue;
                }
                if (node.type === "flowDelay") {
                    const waitFrames = Math.max(1, Number(config.frames) || 1);
                    const targets = linkedNodes(entry.graph, node.id, "next");
                    for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
                        delayed.push({
                            dueFrame: frame + waitFrames,
                            graph: entry.graph,
                            nodeId: targets[targetIndex],
                            payload: entry.payload
                        });
                    }
                    continue;
                }
                if (node.type.indexOf("action") === 0 && typeof callbacks.execute === "function") {
                    callbacks.execute(node.type, config, entry.payload, variables);
                }
                enqueueLinked(queue, entry.graph, node.id, "next", entry.payload);
            }
            if (queue.length && typeof callbacks.log === "function") {
                callbacks.log("Visual scripting interrompido após " + MAX_STEPS_PER_EVENT + " passos; verifique ciclos no grafo.");
            }
        }

        function emitEvent(type, payload) {
            for (let graphIndex = 0; graphIndex < graphs.length; graphIndex++) {
                const graph = graphs[graphIndex];
                const nodes = graph.source.nodes || [];
                for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
                    const node = nodes[nodeIndex];
                    const config = node.config || {};
                    let matches = false;
                    if (type === "start") matches = node.type === "eventStart";
                    else if (type === "trigger") {
                        matches = node.type === "eventTrigger"
                            && config.triggerId === payload.triggerId
                            && config.phase === payload.phase;
                    }
                    if (matches) executeFrom(graph, node, "next", payload);
                }
            }
        }

        function start() {
            if (started) return;
            started = true;
            emitEvent("start", {});
        }

        function step() {
            if (!started) return;
            frame++;
            for (let graphIndex = 0; graphIndex < graphs.length; graphIndex++) {
                const graph = graphs[graphIndex];
                const nodes = graph.source.nodes || [];
                for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
                    const node = nodes[nodeIndex];
                    if (node.type !== "eventInput") continue;
                    const button = node.config && node.config.button;
                    if (typeof callbacks.buttonPressed === "function" && callbacks.buttonPressed(button)) {
                        executeFrom(graph, node, "next", { button: button });
                    }
                }
            }
            for (let timerIndex = 0; timerIndex < timers.length; timerIndex++) {
                const timer = timers[timerIndex];
                if (timer.finished || frame < timer.nextFrame) continue;
                executeFrom(timer.graph, timer.node, "next", { frame: frame });
                const config = timer.node.config || {};
                if (config.repeat === false) timer.finished = true;
                else timer.nextFrame += Math.max(1, Number(config.intervalFrames) || 60);
            }
            for (let delayedIndex = delayed.length - 1; delayedIndex >= 0; delayedIndex--) {
                const entry = delayed[delayedIndex];
                if (entry.dueFrame > frame) continue;
                delayed.splice(delayedIndex, 1);
                const synthetic = { id: "delayed-" + delayedIndex };
                entry.graph.links[synthetic.id + ":next"] = [entry.nodeId];
                executeFrom(entry.graph, synthetic, "next", entry.payload);
                delete entry.graph.links[synthetic.id + ":next"];
            }
        }

        function trigger(triggerId, phase) {
            if (!started) return;
            emitEvent("trigger", { triggerId: triggerId, phase: phase });
        }

        function getVariable(id) {
            return variables[id];
        }

        return { start: start, step: step, trigger: trigger, getVariable: getVariable };
    }

    root.VisualScriptingRuntime = { create: create };
})(globalThis);
