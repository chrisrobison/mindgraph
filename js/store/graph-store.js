import { EVENTS } from "../core/event-constants.js";
import {
  createEdge,
  createNode,
  findNodeById,
  normalizeGraphDocument,
  updateNode as patchGraphNode,
  validateGraphDocument
} from "../core/graph-document.js";
import { seedDocument } from "../core/seed-data.js";
import { clone } from "../core/utils.js";
import { publish, subscribe } from "../core/pan.js";

class GraphStore {
  #document = null;
  #selectedNodeId = null;

  constructor() {
    subscribe(EVENTS.GRAPH_NODE_UPDATED, ({ payload }) => {
      if (payload?.origin === "graph-store") return;
      const { nodeId, patch } = payload ?? {};
      if (nodeId && patch && this.#document) {
        this.updateNode(nodeId, patch, { emit: false });
      }
    });

    subscribe(EVENTS.GRAPH_EDGE_CREATED, ({ payload }) => {
      if (payload?.origin === "graph-store") return;
      const edge = payload?.edge;
      if (edge && this.#document) {
        this.addEdge(edge, { emit: false });
      }
    });

    subscribe(EVENTS.GRAPH_NODE_SELECTED, ({ payload }) => {
      this.#selectedNodeId = payload?.nodeId ?? null;
    });

    subscribe(EVENTS.GRAPH_SELECTION_CLEARED, () => {
      this.#selectedNodeId = null;
    });
  }

  load(documentLike) {
    const normalized = normalizeGraphDocument(documentLike);
    const validation = validateGraphDocument(normalized);

    if (!validation.valid) {
      throw new Error(`Invalid graph document: ${validation.errors.join(", ")}`);
    }

    this.#document = normalized;
    publish(EVENTS.GRAPH_DOCUMENT_LOADED, { document: this.getDocument() });
    return this.getDocument();
  }

  loadSeededGraph() {
    return this.load(seedDocument);
  }

  save() {
    const snapshot = this.getDocument();
    publish(EVENTS.GRAPH_DOCUMENT_SAVED, { document: snapshot });
    return snapshot;
  }

  getDocument() {
    return this.#document ? clone(this.#document) : null;
  }

  getNodes() {
    return this.#document ? clone(this.#document.nodes ?? []) : [];
  }

  getEdges() {
    return this.#document ? clone(this.#document.edges ?? []) : [];
  }

  getNode(nodeId) {
    if (!this.#document) return null;
    const node = findNodeById(this.#document, nodeId);
    return node ? clone(node) : null;
  }

  getSelectedNodeId() {
    return this.#selectedNodeId;
  }

  setSelectedNode(nodeId) {
    if (!nodeId) {
      this.#selectedNodeId = null;
      publish(EVENTS.GRAPH_SELECTION_CLEARED, { origin: "graph-store" });
      return null;
    }

    const node = this.getNode(nodeId);
    if (!node) return null;

    this.#selectedNodeId = nodeId;
    publish(EVENTS.GRAPH_NODE_SELECTED, { nodeId, origin: "graph-store" });
    return node;
  }

  updateNodePosition(nodeId, position, options = {}) {
    const nextPosition = {
      x: Number(position?.x ?? 0),
      y: Number(position?.y ?? 0)
    };

    return this.updateNode(nodeId, { position: nextPosition }, options);
  }

  updateNode(nodeId, patch, { emit = true } = {}) {
    if (!this.#document || !nodeId || !patch) return null;

    const existing = findNodeById(this.#document, nodeId);
    if (!existing) return null;

    const normalizedPatch = { ...patch };
    if (normalizedPatch.position) {
      normalizedPatch.position = {
        x: Number(normalizedPatch.position.x ?? existing.position?.x ?? 0),
        y: Number(normalizedPatch.position.y ?? existing.position?.y ?? 0)
      };
    }

    this.#document = patchGraphNode(this.#document, nodeId, normalizedPatch);
    const node = this.getNode(nodeId);

    if (emit) {
      publish(EVENTS.GRAPH_NODE_UPDATED, {
        nodeId,
        patch: normalizedPatch,
        node,
        origin: "graph-store"
      });
    }

    return node;
  }

  patchNode(nodeId, patch) {
    return this.updateNode(nodeId, patch);
  }

  addNode(nodeLike = {}, { emit = true } = {}) {
    if (!this.#document) return null;

    const node = createNode(nodeLike);
    this.#document.nodes = [...(this.#document.nodes ?? []), node];

    if (emit) {
      publish(EVENTS.GRAPH_NODE_UPDATED, {
        nodeId: node.id,
        patch: node,
        operation: "added",
        node: clone(node),
        origin: "graph-store"
      });
    }

    return clone(node);
  }

  removeNode(nodeId) {
    if (!this.#document) return null;

    const node = findNodeById(this.#document, nodeId);
    if (!node) return null;

    this.#document.nodes = (this.#document.nodes ?? []).filter((entry) => entry.id !== nodeId);
    this.#document.edges = (this.#document.edges ?? []).filter(
      (edge) => edge.source !== nodeId && edge.target !== nodeId
    );

    if (this.#selectedNodeId === nodeId) {
      this.#selectedNodeId = null;
      publish(EVENTS.GRAPH_SELECTION_CLEARED, { origin: "graph-store" });
    }

    publish(EVENTS.GRAPH_NODE_UPDATED, {
      nodeId,
      operation: "removed",
      origin: "graph-store"
    });

    return clone(node);
  }

  addEdge(edgeLike = {}, { emit = true } = {}) {
    if (!this.#document) return null;

    const edge = createEdge(edgeLike);
    const sourceExists = Boolean(findNodeById(this.#document, edge.source));
    const targetExists = Boolean(findNodeById(this.#document, edge.target));
    if (!sourceExists || !targetExists) return null;

    const duplicate = (this.#document.edges ?? []).some((entry) => entry.id === edge.id);
    if (duplicate) return null;

    this.#document.edges = [...(this.#document.edges ?? []), edge];

    if (emit) {
      publish(EVENTS.GRAPH_EDGE_CREATED, {
        edge: clone(edge),
        origin: "graph-store"
      });
    }

    return clone(edge);
  }
}

export const graphStore = new GraphStore();
