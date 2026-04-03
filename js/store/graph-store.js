import { HISTORY_LIMITS } from "../core/constants.js";
import { EVENTS } from "../core/event-constants.js";
import {
  createEdge,
  createNode,
  findEdgeById,
  findNodeById,
  normalizeGraphDocument,
  updateNode as patchGraphNode,
  validateGraphDocument
} from "../core/graph-document.js";
import { seedDocument } from "../core/seed-data.js";
import { clone } from "../core/utils.js";
import { publish, subscribe } from "../core/pan.js";

const unique = (items) => [...new Set((Array.isArray(items) ? items : []).filter(Boolean))];

class GraphStore {
  #document = null;
  #selectedNodeIds = [];
  #selectedEdgeId = null;
  #undoStack = [];
  #redoStack = [];

  constructor() {
    subscribe(EVENTS.GRAPH_DOCUMENT_LOAD_REQUESTED, ({ payload }) => {
      if (!payload?.document) return;
      this.load(payload.document, { reason: payload?.reason ?? "request" });
    });

    subscribe(EVENTS.GRAPH_DOCUMENT_SAVE_REQUESTED, () => {
      this.save();
    });

    subscribe(EVENTS.GRAPH_DOCUMENT_UNDO_REQUESTED, () => {
      this.undo();
    });

    subscribe(EVENTS.GRAPH_DOCUMENT_REDO_REQUESTED, () => {
      this.redo();
    });

    subscribe(EVENTS.GRAPH_NODE_SELECT_REQUESTED, ({ payload }) => {
      this.setSelectedNode(payload?.nodeId, {
        additive: Boolean(payload?.additive),
        toggle: Boolean(payload?.toggle)
      });
    });

    subscribe(EVENTS.GRAPH_SELECTION_CLEAR_REQUESTED, () => {
      this.clearSelection();
    });

    subscribe(EVENTS.GRAPH_SELECTION_SET_REQUESTED, ({ payload }) => {
      this.setSelection(unique(payload?.nodeIds));
    });

    subscribe(EVENTS.GRAPH_NODE_UPDATE_REQUESTED, ({ payload }) => {
      if (!payload?.nodeId || !payload?.patch) return;
      this.updateNode(payload.nodeId, payload.patch);
    });

    subscribe(EVENTS.GRAPH_NODE_MOVE_REQUESTED, ({ payload }) => {
      if (!payload?.nodeId || !payload?.position) return;
      this.updateNodePosition(payload.nodeId, payload.position);
    });

    subscribe(EVENTS.GRAPH_NODE_CREATE_REQUESTED, ({ payload }) => {
      const created = this.addNode(payload?.node ?? payload ?? {});
      if (created && payload?.selectAfterCreate) {
        this.setSelection([created.id]);
      }
    });

    subscribe(EVENTS.GRAPH_NODE_DELETE_REQUESTED, ({ payload }) => {
      const ids = unique(payload?.nodeIds ?? [payload?.nodeId]);
      ids.forEach((nodeId) => this.removeNode(nodeId));
    });

    subscribe(EVENTS.GRAPH_EDGE_CREATE_REQUESTED, ({ payload }) => {
      if (!payload) return;
      this.addEdge(payload.edge ?? payload, { selectAfterCreate: Boolean(payload?.selectAfterCreate) });
    });

    subscribe(EVENTS.GRAPH_EDGE_SELECT_REQUESTED, ({ payload }) => {
      this.setSelectedEdge(payload?.edgeId ?? null);
    });

    subscribe(EVENTS.GRAPH_EDGE_SELECTION_CLEAR_REQUESTED, () => {
      this.clearSelectedEdge();
    });

    subscribe(EVENTS.GRAPH_EDGE_UPDATE_REQUESTED, ({ payload }) => {
      if (!payload?.edgeId || !payload?.patch) return;
      this.updateEdge(payload.edgeId, payload.patch);
    });

    subscribe(EVENTS.GRAPH_EDGE_DELETE_REQUESTED, ({ payload }) => {
      if (!payload?.edgeId) return;
      this.removeEdge(payload.edgeId);
    });

    subscribe(EVENTS.GRAPH_VIEWPORT_UPDATE_REQUESTED, ({ payload }) => {
      this.updateViewport(payload);
    });
  }

  load(documentLike, { fromHistory = false, reason = "load" } = {}) {
    const normalized = normalizeGraphDocument(documentLike);
    const validation = validateGraphDocument(normalized);

    if (!validation.valid) {
      throw new Error(`Invalid graph document: ${validation.errors.join(", ")}`);
    }

    if (!fromHistory && this.#document) {
      this.#pushUndo(this.#document);
      this.#redoStack = [];
      this.#emitHistoryState();
    }

    this.#document = normalized;
    this.#syncSelectionFromDocument();
    this.#persistSelectionToDocument();
    this.#emitHistoryState();

    const snapshot = this.getDocument();
    publish(EVENTS.GRAPH_VIEWPORT_CHANGED, {
      ...(snapshot?.viewport ?? { x: 0, y: 0, zoom: 1 }),
      origin: "graph-store"
    });
    publish(EVENTS.GRAPH_DOCUMENT_LOADED, { document: snapshot, reason, origin: "graph-store" });
    publish(EVENTS.GRAPH_DOCUMENT_CHANGED, { document: snapshot, reason, origin: "graph-store" });
    this.#emitSelectionState();

    return snapshot;
  }

  loadSeededGraph() {
    return this.load(seedDocument, { reason: "seed" });
  }

  save() {
    const snapshot = this.getDocument();
    publish(EVENTS.GRAPH_DOCUMENT_SAVED, { document: snapshot, origin: "graph-store" });
    return snapshot;
  }

  undo() {
    if (!this.canUndo() || !this.#document) return null;
    const previous = this.#undoStack.pop();
    this.#redoStack.push(clone(this.#document));
    this.#document = clone(previous);
    this.#syncSelectionFromDocument();
    this.#persistSelectionToDocument();
    this.#emitHistoryState();

    const snapshot = this.getDocument();
    publish(EVENTS.GRAPH_VIEWPORT_CHANGED, {
      ...(snapshot?.viewport ?? { x: 0, y: 0, zoom: 1 }),
      origin: "graph-store"
    });
    publish(EVENTS.GRAPH_DOCUMENT_LOADED, {
      document: snapshot,
      origin: "graph-store",
      operation: "undo"
    });
    publish(EVENTS.GRAPH_DOCUMENT_CHANGED, {
      document: snapshot,
      origin: "graph-store",
      reason: "undo"
    });
    this.#emitSelectionState();

    return snapshot;
  }

  redo() {
    if (!this.canRedo() || !this.#document) return null;
    const next = this.#redoStack.pop();
    this.#undoStack.push(clone(this.#document));
    this.#document = clone(next);
    this.#syncSelectionFromDocument();
    this.#persistSelectionToDocument();
    this.#emitHistoryState();

    const snapshot = this.getDocument();
    publish(EVENTS.GRAPH_VIEWPORT_CHANGED, {
      ...(snapshot?.viewport ?? { x: 0, y: 0, zoom: 1 }),
      origin: "graph-store"
    });
    publish(EVENTS.GRAPH_DOCUMENT_LOADED, {
      document: snapshot,
      origin: "graph-store",
      operation: "redo"
    });
    publish(EVENTS.GRAPH_DOCUMENT_CHANGED, {
      document: snapshot,
      origin: "graph-store",
      reason: "redo"
    });
    this.#emitSelectionState();

    return snapshot;
  }

  canUndo() {
    return this.#undoStack.length > 0;
  }

  canRedo() {
    return this.#redoStack.length > 0;
  }

  getHistoryState() {
    return {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      undoCount: this.#undoStack.length,
      redoCount: this.#redoStack.length
    };
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

  getEdge(edgeId) {
    if (!this.#document) return null;
    const edge = findEdgeById(this.#document, edgeId);
    return edge ? clone(edge) : null;
  }

  getSelectedEdgeId() {
    return this.#selectedEdgeId;
  }

  getSelectedNodeIds() {
    return [...this.#selectedNodeIds];
  }

  getSelectedNodeId() {
    return this.#selectedNodeIds[0] ?? null;
  }

  setSelectedNode(nodeId, { additive = false, toggle = false } = {}) {
    if (!this.#document || !nodeId) return null;
    const node = this.getNode(nodeId);
    if (!node) return null;

    const nextIds = additive ? [...this.#selectedNodeIds] : [];
    const index = nextIds.indexOf(nodeId);

    if (index >= 0) {
      if (toggle || additive) nextIds.splice(index, 1);
      else return node;
    } else {
      nextIds.unshift(nodeId);
    }

    if (!nextIds.length && !additive) {
      nextIds.push(nodeId);
    }

    this.setSelection(nextIds);
    return node;
  }

  clearSelection() {
    this.clearSelectedEdge({ emitChange: false });
    if (!this.#selectedNodeIds.length) {
      publish(EVENTS.GRAPH_SELECTION_CLEARED, { origin: "graph-store" });
      publish(EVENTS.GRAPH_SELECTION_SET, { nodeIds: [], nodeId: null, origin: "graph-store" });
      return;
    }

    this.#selectedNodeIds = [];
    this.#persistSelectionToDocument();
    publish(EVENTS.GRAPH_SELECTION_CLEARED, { origin: "graph-store" });
    publish(EVENTS.GRAPH_SELECTION_SET, { nodeIds: [], nodeId: null, origin: "graph-store" });
    this.#emitDocumentChanged("selection");
  }

  setSelection(nodeIds = []) {
    if (!this.#document) return;

    this.clearSelectedEdge({ emitChange: false });
    const validIds = unique(nodeIds).filter((nodeId) => Boolean(findNodeById(this.#document, nodeId)));
    this.#selectedNodeIds = validIds;
    this.#persistSelectionToDocument();

    if (!validIds.length) {
      publish(EVENTS.GRAPH_SELECTION_CLEARED, { origin: "graph-store" });
      publish(EVENTS.GRAPH_SELECTION_SET, { nodeIds: [], nodeId: null, origin: "graph-store" });
    } else {
      publish(EVENTS.GRAPH_NODE_SELECTED, {
        nodeId: validIds[0],
        nodeIds: [...validIds],
        origin: "graph-store"
      });
      publish(EVENTS.GRAPH_SELECTION_SET, {
        nodeId: validIds[0],
        nodeIds: [...validIds],
        origin: "graph-store"
      });
    }

    this.#emitDocumentChanged("selection");
  }

  updateViewport(nextViewport = {}) {
    if (!this.#document) return null;

    const prev = this.#document.viewport ?? { x: 0, y: 0, zoom: 1 };
    const nextZoom = Number(nextViewport.zoom ?? prev.zoom ?? 1);
    const nextX = Number(nextViewport.x ?? prev.x ?? 0);
    const nextY = Number(nextViewport.y ?? prev.y ?? 0);

    this.#document.viewport = {
      x: Number.isFinite(nextX) ? nextX : prev.x ?? 0,
      y: Number.isFinite(nextY) ? nextY : prev.y ?? 0,
      zoom: Number.isFinite(nextZoom) ? nextZoom : prev.zoom ?? 1
    };

    publish(EVENTS.GRAPH_VIEWPORT_CHANGED, {
      ...this.#document.viewport,
      origin: "graph-store"
    });
    this.#emitDocumentChanged("viewport");

    return clone(this.#document.viewport);
  }

  updateNodePosition(nodeId, position) {
    const nextPosition = {
      x: Number(position?.x ?? 0),
      y: Number(position?.y ?? 0)
    };

    return this.updateNode(nodeId, { position: nextPosition });
  }

  updateNode(nodeId, patch) {
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

    this.#applyMutation(() => {
      this.#document = patchGraphNode(this.#document, nodeId, normalizedPatch);
    });

    const node = this.getNode(nodeId);

    publish(EVENTS.GRAPH_NODE_UPDATED, {
      nodeId,
      patch: normalizedPatch,
      node,
      origin: "graph-store"
    });

    this.#emitDocumentChanged("node_updated", { nodeId });
    return node;
  }

  patchNode(nodeId, patch) {
    return this.updateNode(nodeId, patch);
  }

  addNode(nodeLike = {}) {
    if (!this.#document) return null;

    const node = createNode(nodeLike);

    this.#applyMutation(() => {
      this.#document.nodes = [...(this.#document.nodes ?? []), node];
    });

    publish(EVENTS.GRAPH_NODE_CREATED, {
      node: clone(node),
      nodeId: node.id,
      origin: "graph-store"
    });

    this.#emitDocumentChanged("node_created", { nodeId: node.id });
    return clone(node);
  }

  removeNode(nodeId) {
    if (!this.#document) return null;

    const node = findNodeById(this.#document, nodeId);
    if (!node) return null;

    this.#applyMutation(() => {
      this.#document.nodes = (this.#document.nodes ?? []).filter((entry) => entry.id !== nodeId);
      this.#document.edges = (this.#document.edges ?? []).filter(
        (edge) => edge.source !== nodeId && edge.target !== nodeId
      );
    });

    if (this.#selectedEdgeId && !findEdgeById(this.#document, this.#selectedEdgeId)) {
      this.clearSelectedEdge({ emitChange: false });
    }

    if (this.#selectedNodeIds.includes(nodeId)) {
      this.#selectedNodeIds = this.#selectedNodeIds.filter((id) => id !== nodeId);
      this.#persistSelectionToDocument();
      this.#emitSelectionState();
    }

    publish(EVENTS.GRAPH_NODE_DELETED, {
      nodeId,
      node: clone(node),
      origin: "graph-store"
    });

    this.#emitDocumentChanged("node_deleted", { nodeId });
    return clone(node);
  }

  setSelectedEdge(edgeId) {
    if (!this.#document || !edgeId) {
      this.clearSelectedEdge();
      return null;
    }

    const edge = this.getEdge(edgeId);
    if (!edge) return null;

    this.#selectedEdgeId = edge.id;
    this.#selectedNodeIds = [];
    this.#persistSelectionToDocument();
    publish(EVENTS.GRAPH_SELECTION_CLEARED, { origin: "graph-store" });
    publish(EVENTS.GRAPH_SELECTION_SET, { nodeIds: [], nodeId: null, origin: "graph-store" });
    publish(EVENTS.GRAPH_EDGE_SELECTED, {
      edgeId: edge.id,
      edge,
      origin: "graph-store"
    });
    this.#emitDocumentChanged("edge_selection");
    return edge;
  }

  clearSelectedEdge({ emitChange = true } = {}) {
    if (!this.#selectedEdgeId) return;

    this.#selectedEdgeId = null;
    this.#persistSelectionToDocument();
    publish(EVENTS.GRAPH_EDGE_SELECTION_CLEARED, { origin: "graph-store" });
    if (emitChange) this.#emitDocumentChanged("edge_selection_cleared");
  }

  addEdge(edgeLike = {}, { selectAfterCreate = false } = {}) {
    if (!this.#document) return null;

    const edge = createEdge(edgeLike);
    const sourceExists = Boolean(findNodeById(this.#document, edge.source));
    const targetExists = Boolean(findNodeById(this.#document, edge.target));
    if (!sourceExists || !targetExists) return null;

    const duplicate = (this.#document.edges ?? []).some(
      (entry) =>
        entry.id === edge.id ||
        (entry.source === edge.source &&
          entry.target === edge.target &&
          entry.type === edge.type &&
          String(entry.label ?? "") === String(edge.label ?? ""))
    );
    if (duplicate) return null;

    this.#applyMutation(() => {
      this.#document.edges = [...(this.#document.edges ?? []), edge];
    });

    publish(EVENTS.GRAPH_EDGE_CREATED, {
      edge: clone(edge),
      origin: "graph-store"
    });

    if (selectAfterCreate) {
      this.setSelectedEdge(edge.id);
    }

    this.#emitDocumentChanged("edge_created", { edgeId: edge.id });
    return clone(edge);
  }

  updateEdge(edgeId, patch) {
    if (!this.#document || !edgeId || !patch) return null;
    const existing = findEdgeById(this.#document, edgeId);
    if (!existing) return null;

    const normalizedPatch = { ...patch };
    if (normalizedPatch.type != null) normalizedPatch.type = String(normalizedPatch.type);
    if (normalizedPatch.label != null) normalizedPatch.label = String(normalizedPatch.label);

    this.#applyMutation(() => {
      this.#document.edges = (this.#document.edges ?? []).map((edge) =>
        edge.id === edgeId ? { ...edge, ...normalizedPatch } : edge
      );
    });

    const edge = this.getEdge(edgeId);
    publish(EVENTS.GRAPH_EDGE_UPDATED, {
      edgeId,
      patch: normalizedPatch,
      edge,
      origin: "graph-store"
    });

    if (this.#selectedEdgeId === edgeId && edge) {
      publish(EVENTS.GRAPH_EDGE_SELECTED, {
        edgeId,
        edge,
        origin: "graph-store"
      });
    }

    this.#emitDocumentChanged("edge_updated", { edgeId });
    return edge;
  }

  removeEdge(edgeId) {
    if (!this.#document || !edgeId) return null;
    const edge = findEdgeById(this.#document, edgeId);
    if (!edge) return null;

    this.#applyMutation(() => {
      this.#document.edges = (this.#document.edges ?? []).filter((entry) => entry.id !== edgeId);
    });

    if (this.#selectedEdgeId === edgeId) {
      this.clearSelectedEdge({ emitChange: false });
    }

    publish(EVENTS.GRAPH_EDGE_DELETED, {
      edgeId,
      edge: clone(edge),
      origin: "graph-store"
    });

    this.#emitDocumentChanged("edge_deleted", { edgeId });
    return clone(edge);
  }

  #applyMutation(run) {
    if (!this.#document) return;
    this.#pushUndo(this.#document);
    this.#redoStack = [];
    run();
    this.#persistSelectionToDocument();
    this.#emitHistoryState();
  }

  #pushUndo(document) {
    this.#undoStack.push(clone(document));
    if (this.#undoStack.length > HISTORY_LIMITS.graphSnapshots) {
      this.#undoStack.shift();
    }
  }

  #emitHistoryState() {
    publish(EVENTS.GRAPH_HISTORY_CHANGED, {
      ...this.getHistoryState(),
      origin: "graph-store"
    });
  }

  #emitSelectionState() {
    if (this.#selectedEdgeId) {
      const edge = this.getEdge(this.#selectedEdgeId);
      if (edge) {
        publish(EVENTS.GRAPH_EDGE_SELECTED, {
          edgeId: edge.id,
          edge,
          origin: "graph-store"
        });
        return;
      }
    }

    if (!this.#selectedNodeIds.length) {
      publish(EVENTS.GRAPH_SELECTION_CLEARED, { origin: "graph-store" });
      publish(EVENTS.GRAPH_SELECTION_SET, { nodeIds: [], nodeId: null, origin: "graph-store" });
      return;
    }

    publish(EVENTS.GRAPH_NODE_SELECTED, {
      nodeId: this.#selectedNodeIds[0],
      nodeIds: [...this.#selectedNodeIds],
      origin: "graph-store"
    });
    publish(EVENTS.GRAPH_SELECTION_SET, {
      nodeId: this.#selectedNodeIds[0],
      nodeIds: [...this.#selectedNodeIds],
      origin: "graph-store"
    });
  }

  #emitDocumentChanged(reason, extra = {}) {
    publish(EVENTS.GRAPH_DOCUMENT_CHANGED, {
      document: this.getDocument(),
      reason,
      origin: "graph-store",
      ...extra
    });
  }

  #syncSelectionFromDocument() {
    const selected = this.#document?.metadata?.selection;

    if (Array.isArray(selected) && selected.length) {
      this.#selectedNodeIds = unique(selected).filter((nodeId) => Boolean(findNodeById(this.#document, nodeId)));
      this.#selectedEdgeId = null;
      return;
    }

    const fallbackNodeId = this.#document?.metadata?.selectedNodeId;
    if (fallbackNodeId && findNodeById(this.#document, fallbackNodeId)) {
      this.#selectedNodeIds = [fallbackNodeId];
      this.#selectedEdgeId = null;
      return;
    }

    this.#selectedNodeIds = [];
    const selectedEdgeId = this.#document?.metadata?.selectedEdgeId;
    this.#selectedEdgeId =
      selectedEdgeId && findEdgeById(this.#document, selectedEdgeId) ? selectedEdgeId : null;
  }

  #persistSelectionToDocument() {
    if (!this.#document) return;
    this.#document.metadata = {
      ...(this.#document.metadata ?? {}),
      selectedNodeId: this.#selectedNodeIds[0] ?? null,
      selection: [...this.#selectedNodeIds],
      selectedEdgeId: this.#selectedEdgeId ?? null
    };
  }
}

export const graphStore = new GraphStore();
