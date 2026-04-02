import { EVENTS } from "../core/event-constants.js";
import { EDGE_TYPE_VALUES } from "../core/types.js";
import { publish, subscribe } from "../core/pan.js";
import { graphStore } from "../store/graph-store.js";

const nodeTagByType = {
  note: "note-node",
  agent: "agent-node",
  data: "data-node",
  transformer: "transformer-node",
  view: "view-node",
  action: "action-node"
};

const nodeSizeByType = {
  note: { width: 250, height: 140 },
  agent: { width: 290, height: 180 },
  data: { width: 260, height: 138 },
  transformer: { width: 210, height: 104 },
  view: { width: 210, height: 104 },
  action: { width: 210, height: 104 }
};

const nodeTemplates = {
  note: {
    label: "New Note",
    description: "Capture context and decisions.",
    data: { color: "#f4f9ff", tags: [] }
  },
  agent: {
    label: "New Agent",
    description: "Define a role and objective.",
    data: {
      role: "Research Agent",
      mode: "orchestrate",
      status: "idle",
      allowedDataSources: [],
      linkedDataCount: 0
    }
  },
  data: {
    label: "New Data",
    description: "Connect a data source.",
    data: {
      source: "json",
      sourceType: "json",
      sourcePath: "embedded:site_config",
      sourceUrl: "",
      jsonPath: "",
      refreshMode: "manual",
      refreshInterval: 60,
      readonly: true,
      cachedData: null,
      cachedSchema: null,
      lastUpdated: ""
    }
  },
  transformer: {
    label: "New Transformer",
    description: "Transform source inputs.",
    data: { inputSchema: {}, outputSchema: {} }
  },
  view: {
    label: "New View",
    description: "Render output for review.",
    data: { outputTemplate: "summary_card" }
  },
  action: {
    label: "New Action",
    description: "Run an external action.",
    data: { command: "noop", config: {} }
  }
};

const worldSize = {
  width: 3200,
  height: 2200
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const clampZoom = (value) => clamp(value, 0.45, 1.8);

class GraphCanvas extends HTMLElement {
  #document = null;
  #selectedNodeId = null;
  #activeTool = "select";
  #connectState = { sourceNodeId: null };
  #dispose = [];
  #viewport = { x: 0, y: 0, zoom: 1 };
  #workspaceEl = null;
  #sceneEl = null;
  #nodeLayerEl = null;
  #edgeLayerEl = null;
  #panState = null;
  #dragState = null;

  connectedCallback() {
    this.#renderShell();

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_DOCUMENT_LOADED, ({ payload }) => {
        const nextDocument = payload?.document ?? null;
        this.#document = nextDocument;

        if (nextDocument?.viewport) {
          this.#viewport = {
            x: Number(nextDocument.viewport.x ?? 0),
            y: Number(nextDocument.viewport.y ?? 0),
            zoom: clampZoom(Number(nextDocument.viewport.zoom ?? 1))
          };
          publish(EVENTS.GRAPH_VIEWPORT_CHANGED, { zoom: this.#viewport.zoom, origin: "graph-canvas" });
        }

        this.#renderGraph();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_VIEWPORT_CHANGED, ({ payload }) => {
        const nextZoom = Number(payload?.zoom ?? this.#viewport.zoom);
        const nextX = Number(payload?.x ?? this.#viewport.x);
        const nextY = Number(payload?.y ?? this.#viewport.y);
        if (!Number.isFinite(nextZoom)) return;
        this.#viewport.zoom = clampZoom(nextZoom);
        this.#viewport.x = Number.isFinite(nextX) ? nextX : this.#viewport.x;
        this.#viewport.y = Number.isFinite(nextY) ? nextY : this.#viewport.y;
        this.#applyViewportTransform();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.TOOLBAR_TOOL_CHANGED, ({ payload }) => {
        this.#activeTool = payload?.tool ?? "select";
        if (this.#activeTool !== "connect") this.#connectState.sourceNodeId = null;
        this.#syncInteractionMode();
        this.#highlightSelection();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_NODE_SELECTED, ({ payload }) => {
        this.#selectedNodeId = payload?.nodeId ?? null;
        this.#highlightSelection();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_SELECTION_CLEARED, () => {
        this.#selectedNodeId = null;
        this.#highlightSelection();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_NODE_UPDATED, ({ payload }) => {
        if (payload?.origin === "graph-canvas") return;

        const { nodeId, patch, operation, node } = payload ?? {};
        if (!this.#document) return;

        if (operation === "added" && node) {
          this.#document.nodes = [...(this.#document.nodes ?? []), node];
          this.#renderGraph();
          return;
        }

        if (operation === "removed" && nodeId) {
          this.#document.nodes = (this.#document.nodes ?? []).filter((entry) => entry.id !== nodeId);
          this.#document.edges = (this.#document.edges ?? []).filter(
            (edge) => edge.source !== nodeId && edge.target !== nodeId
          );
          this.#renderGraph();
          return;
        }

        if (!nodeId || !patch) return;

        this.#document.nodes = (this.#document.nodes ?? []).map((entry) =>
          entry.id === nodeId ? { ...entry, ...patch } : entry
        );
        this.#renderGraph();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_EDGE_CREATED, ({ payload }) => {
        if (payload?.origin === "graph-canvas") return;

        const edge = payload?.edge;
        if (!edge || !this.#document) return;

        const duplicate = (this.#document.edges ?? []).some((entry) => entry.id === edge.id);
        if (duplicate) return;

        this.#document.edges = [...(this.#document.edges ?? []), edge];
        this.#renderEdges();
      })
    );

    this.#syncInteractionMode();
  }

  disconnectedCallback() {
    this.#dispose.forEach((run) => run());
    this.#dispose = [];
  }

  #renderShell() {
    this.innerHTML = `
      <section class="mg-panel mg-graph-panel">
        <header>Graph Canvas</header>
        <div class="content mg-graph-content">
          <div class="graph-workspace" data-role="workspace" tabindex="0">
            <div class="graph-scene" data-role="scene">
              <svg class="graph-edges-layer" data-role="edges" width="${worldSize.width}" height="${worldSize.height}" viewBox="0 0 ${worldSize.width} ${worldSize.height}" aria-hidden="true"></svg>
              <div class="graph-node-layer" data-role="nodes"></div>
            </div>
          </div>
        </div>
      </section>
    `;

    this.#workspaceEl = this.querySelector('[data-role="workspace"]');
    this.#sceneEl = this.querySelector('[data-role="scene"]');
    this.#nodeLayerEl = this.querySelector('[data-role="nodes"]');
    this.#edgeLayerEl = this.querySelector('[data-role="edges"]');

    this.#bindInteractionEvents();
    this.#applyViewportTransform();
  }

  #bindInteractionEvents() {
    if (!this.#workspaceEl) return;

    this.#workspaceEl.addEventListener("pointerdown", (event) => this.#onWorkspacePointerDown(event));
    this.#workspaceEl.addEventListener("pointermove", (event) => this.#onWorkspacePointerMove(event));
    this.#workspaceEl.addEventListener("pointerup", (event) => this.#onWorkspacePointerUp(event));
    this.#workspaceEl.addEventListener("pointercancel", (event) => this.#onWorkspacePointerUp(event));
    this.#workspaceEl.addEventListener("keydown", (event) => this.#onWorkspaceKeyDown(event));
    this.#workspaceEl.addEventListener(
      "wheel",
      (event) => {
        this.#onWorkspaceWheel(event);
      },
      { passive: false }
    );
  }

  #onWorkspacePointerDown(event) {
    if (event.button !== 0 && event.button !== 1) return;
    this.#workspaceEl.focus();
    if (event.target.closest("[data-node-id]")) return;

    if (event.button === 0 && this.#activeTool.startsWith("create:")) {
      const nodeType = this.#activeTool.split(":")[1] ?? "note";
      const worldPoint = this.#screenToWorld(event.clientX, event.clientY);
      this.#createNodeAt(nodeType, worldPoint);
      event.preventDefault();
      return;
    }

    const canPan = this.#activeTool === "pan" || this.#activeTool === "select" || event.button === 1;
    if (!canPan) return;

    this.#panState = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: this.#viewport.x,
      originY: this.#viewport.y,
      moved: false,
      mouseButton: event.button
    };

    this.#workspaceEl.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  #onWorkspacePointerMove(event) {
    if (this.#dragState && event.pointerId === this.#dragState.pointerId) {
      const worldPoint = this.#screenToWorld(event.clientX, event.clientY);
      const nextX = Math.round(worldPoint.x - this.#dragState.offsetX);
      const nextY = Math.round(worldPoint.y - this.#dragState.offsetY);
      this.#dragState.moved = true;
      this.#updateNodePosition(this.#dragState.nodeId, nextX, nextY);
      return;
    }

    if (!this.#panState || event.pointerId !== this.#panState.pointerId) return;

    const deltaX = event.clientX - this.#panState.startClientX;
    const deltaY = event.clientY - this.#panState.startClientY;

    this.#panState.moved = Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1;
    this.#viewport.x = this.#panState.originX + deltaX;
    this.#viewport.y = this.#panState.originY + deltaY;
    this.#applyViewportTransform();
  }

  #onWorkspacePointerUp(event) {
    if (this.#dragState && event.pointerId === this.#dragState.pointerId) {
      this.#workspaceEl.releasePointerCapture(event.pointerId);
      this.#workspaceEl.classList.remove("is-dragging-node");
      this.#dragState = null;
      return;
    }

    if (!this.#panState || event.pointerId !== this.#panState.pointerId) return;

    this.#workspaceEl.releasePointerCapture(event.pointerId);
    const shouldClearSelection =
      this.#activeTool === "select" && this.#panState.mouseButton === 0 && !this.#panState.moved;
    this.#panState = null;

    if (shouldClearSelection) {
      publish(EVENTS.GRAPH_SELECTION_CLEARED, { origin: "graph-canvas" });
    }

    publish(EVENTS.GRAPH_VIEWPORT_CHANGED, {
      x: this.#viewport.x,
      y: this.#viewport.y,
      zoom: this.#viewport.zoom,
      origin: "graph-canvas"
    });
  }

  #onWorkspaceWheel(event) {
    if (!this.#workspaceEl) return;
    event.preventDefault();

    const direction = event.deltaY < 0 ? 1 : -1;
    const zoomFactor = direction > 0 ? 1.08 : 0.92;
    const nextZoom = clampZoom(this.#viewport.zoom * zoomFactor);
    if (nextZoom === this.#viewport.zoom) return;

    const rect = this.#workspaceEl.getBoundingClientRect();
    const worldPointBeforeZoom = this.#screenToWorld(event.clientX, event.clientY);

    this.#viewport.zoom = nextZoom;
    this.#viewport.x = event.clientX - rect.left - worldPointBeforeZoom.x * nextZoom;
    this.#viewport.y = event.clientY - rect.top - worldPointBeforeZoom.y * nextZoom;
    this.#applyViewportTransform();
    publish(EVENTS.GRAPH_VIEWPORT_CHANGED, {
      x: this.#viewport.x,
      y: this.#viewport.y,
      zoom: this.#viewport.zoom,
      origin: "graph-canvas"
    });
  }

  #onWorkspaceKeyDown(event) {
    if (!this.#selectedNodeId) return;

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      const removed = graphStore.removeNode(this.#selectedNodeId);
      if (removed) {
        publish(EVENTS.ACTIVITY_LOG_APPENDED, {
          level: "info",
          message: `Deleted node ${removed.label}`
        });
      }
      return;
    }

    const isDuplicateShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d";
    if (isDuplicateShortcut) {
      event.preventDefault();
      this.#duplicateSelectedNode();
    }
  }

  #onNodePointerDown(event, node) {
    if (event.button !== 0) return;
    this.#workspaceEl.focus();
    event.stopPropagation();

    if (this.#activeTool === "connect") {
      this.#handleConnectClick(node);
      return;
    }

    if (this.#activeTool !== "select") {
      publish(EVENTS.GRAPH_NODE_SELECTED, {
        nodeId: node.id,
        origin: "graph-canvas"
      });
      return;
    }

    this.#workspaceEl.setPointerCapture(event.pointerId);
    this.#workspaceEl.classList.add("is-dragging-node");

    const worldPoint = this.#screenToWorld(event.clientX, event.clientY);
    this.#dragState = {
      pointerId: event.pointerId,
      nodeId: node.id,
      offsetX: worldPoint.x - (node.position?.x ?? 0),
      offsetY: worldPoint.y - (node.position?.y ?? 0),
      moved: false
    };

    publish(EVENTS.GRAPH_NODE_SELECTED, {
      nodeId: node.id,
      origin: "graph-canvas"
    });
  }

  #handleConnectClick(node) {
    if (!this.#connectState.sourceNodeId) {
      this.#connectState.sourceNodeId = node.id;
      publish(EVENTS.GRAPH_NODE_SELECTED, { nodeId: node.id, origin: "graph-canvas" });
      publish(EVENTS.ACTIVITY_LOG_APPENDED, {
        level: "info",
        message: `Connect: source set to ${node.label}`
      });
      return;
    }

    const sourceNodeId = this.#connectState.sourceNodeId;
    const targetNodeId = node.id;
    if (sourceNodeId === targetNodeId) return;

    const defaultType = "depends_on";
    const selected = window.prompt(
      `Edge type (${EDGE_TYPE_VALUES.join(", ")}):`,
      defaultType
    );
    if (selected === null) {
      this.#connectState.sourceNodeId = null;
      return;
    }

    const edgeType = EDGE_TYPE_VALUES.includes(selected.trim()) ? selected.trim() : defaultType;
    const edge = graphStore.addEdge({
      source: sourceNodeId,
      target: targetNodeId,
      type: edgeType,
      label: edgeType.replaceAll("_", " ")
    });

    if (edge) {
      publish(EVENTS.ACTIVITY_LOG_APPENDED, {
        level: "info",
        message: `Created edge ${edge.type}`
      });
    }

    this.#connectState.sourceNodeId = null;
    publish(EVENTS.GRAPH_NODE_SELECTED, { nodeId: targetNodeId, origin: "graph-canvas" });
  }

  #createNodeAt(nodeType, position) {
    const template = nodeTemplates[nodeType] ?? nodeTemplates.note;
    const normalizedPosition = {
      x: Math.round(clamp(position.x, -150, worldSize.width - 100)),
      y: Math.round(clamp(position.y, -100, worldSize.height - 80))
    };

    const node = graphStore.addNode({
      type: nodeType,
      label: template.label,
      description: template.description,
      position: normalizedPosition,
      data: structuredClone(template.data),
      metadata: { createdFromTool: this.#activeTool }
    });
    if (!node) return;

    graphStore.setSelectedNode(node.id);
    publish(EVENTS.ACTIVITY_LOG_APPENDED, {
      level: "info",
      message: `Created ${nodeType} node`
    });
  }

  #duplicateSelectedNode() {
    const source = graphStore.getNode(this.#selectedNodeId);
    if (!source) return;

    const copy = graphStore.addNode({
      type: source.type,
      label: `${source.label} Copy`,
      description: source.description,
      position: {
        x: Number(source.position?.x ?? 0) + 36,
        y: Number(source.position?.y ?? 0) + 28
      },
      data: structuredClone(source.data ?? {}),
      metadata: { ...(source.metadata ?? {}), duplicatedFrom: source.id }
    });
    if (!copy) return;

    graphStore.setSelectedNode(copy.id);
    publish(EVENTS.ACTIVITY_LOG_APPENDED, {
      level: "info",
      message: `Duplicated node ${source.label}`
    });
  }

  #screenToWorld(clientX, clientY) {
    const rect = this.#workspaceEl.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.#viewport.x) / this.#viewport.zoom,
      y: (clientY - rect.top - this.#viewport.y) / this.#viewport.zoom
    };
  }

  #updateNodePosition(nodeId, x, y) {
    if (!this.#document) return;

    const clampedX = clamp(x, -150, worldSize.width - 100);
    const clampedY = clamp(y, -100, worldSize.height - 80);

    this.#document.nodes = (this.#document.nodes ?? []).map((node) =>
      node.id === nodeId
        ? {
            ...node,
            position: {
              x: clampedX,
              y: clampedY
            }
          }
        : node
    );

    const nodeEl = this.#nodeLayerEl?.querySelector(`[data-node-id="${nodeId}"]`);
    if (nodeEl) {
      nodeEl.style.left = `${clampedX}px`;
      nodeEl.style.top = `${clampedY}px`;
    }

    this.#renderEdges();

    publish(EVENTS.GRAPH_NODE_UPDATED, {
      nodeId,
      patch: {
        position: {
          x: clampedX,
          y: clampedY
        }
      },
      origin: "graph-canvas"
    });
  }

  #syncInteractionMode() {
    if (!this.#workspaceEl) return;
    this.#workspaceEl.dataset.tool = this.#activeTool;
  }

  #applyViewportTransform() {
    if (!this.#sceneEl || !this.#workspaceEl) return;

    this.#sceneEl.style.transform = `translate(${this.#viewport.x}px, ${this.#viewport.y}px) scale(${this.#viewport.zoom})`;
    const backgroundGrid = 24 * this.#viewport.zoom;
    this.#workspaceEl.style.backgroundSize = `${backgroundGrid}px ${backgroundGrid}px`;
    this.#workspaceEl.style.backgroundPosition = `${this.#viewport.x}px ${this.#viewport.y}px`;
  }

  #renderGraph() {
    this.#renderNodes();
    this.#renderEdges();
    this.#highlightSelection();
    this.#applyViewportTransform();
  }

  #renderNodes() {
    if (!this.#nodeLayerEl) return;

    const nodes = this.#document?.nodes ?? [];
    this.#nodeLayerEl.innerHTML = "";

    for (const node of nodes) {
      const tag = nodeTagByType[node.type] ?? "note-node";
      const nodeEl = document.createElement(tag);
      nodeEl.classList.add("mg-node-instance");
      nodeEl.dataset.nodeId = node.id;
      nodeEl.dataset.nodeType = node.type;
      nodeEl.style.left = `${node.position?.x ?? 0}px`;
      nodeEl.style.top = `${node.position?.y ?? 0}px`;
      nodeEl.node = node;
      nodeEl.addEventListener("pointerdown", (event) => this.#onNodePointerDown(event, node));
      this.#nodeLayerEl.append(nodeEl);
    }
  }

  #renderEdges() {
    if (!this.#edgeLayerEl) return;

    const nodes = this.#document?.nodes ?? [];
    const edges = this.#document?.edges ?? [];
    const nodeById = new Map(nodes.map((node) => [node.id, node]));

    const defs = `
      <defs>
        <marker id="mg-arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" class="graph-edge-arrow"></path>
        </marker>
      </defs>
    `;

    const edgeMarkup = edges
      .map((edge) => {
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        if (!source || !target) return "";

        const sourcePoint = this.#edgeAnchor(source, target);
        const targetPoint = this.#edgeAnchor(target, source);
        const bezier = this.#buildCurve(sourcePoint, targetPoint);
        const label = this.#escapeHtml(edge.label || edge.type || "");
        const labelX = (sourcePoint.x + targetPoint.x) / 2;
        const labelY = (sourcePoint.y + targetPoint.y) / 2 - 7;

        return `
          <path class="graph-edge-path graph-edge-${edge.type}" d="${bezier}" marker-end="url(#mg-arrow)"></path>
          <text class="graph-edge-label" x="${labelX}" y="${labelY}">${label}</text>
        `;
      })
      .join("");

    this.#edgeLayerEl.innerHTML = `${defs}${edgeMarkup}`;
  }

  #edgeAnchor(node, otherNode) {
    const size = nodeSizeByType[node.type] ?? nodeSizeByType.note;
    const nx = node.position?.x ?? 0;
    const ny = node.position?.y ?? 0;
    const cx = nx + size.width / 2;
    const cy = ny + size.height / 2;

    const otherSize = nodeSizeByType[otherNode.type] ?? nodeSizeByType.note;
    const ox = (otherNode.position?.x ?? 0) + otherSize.width / 2;
    const oy = (otherNode.position?.y ?? 0) + otherSize.height / 2;

    const dx = ox - cx;
    const dy = oy - cy;

    if (Math.abs(dx) > Math.abs(dy)) {
      return dx >= 0 ? { x: nx + size.width, y: cy } : { x: nx, y: cy };
    }

    return dy >= 0 ? { x: cx, y: ny + size.height } : { x: cx, y: ny };
  }

  #buildCurve(sourcePoint, targetPoint) {
    const dx = targetPoint.x - sourcePoint.x;
    const dy = targetPoint.y - sourcePoint.y;

    if (Math.abs(dx) > Math.abs(dy)) {
      const control = clamp(Math.abs(dx) * 0.35, 40, 200);
      const c1x = sourcePoint.x + Math.sign(dx || 1) * control;
      const c2x = targetPoint.x - Math.sign(dx || 1) * control;
      return `M ${sourcePoint.x} ${sourcePoint.y} C ${c1x} ${sourcePoint.y}, ${c2x} ${targetPoint.y}, ${targetPoint.x} ${targetPoint.y}`;
    }

    const control = clamp(Math.abs(dy) * 0.35, 40, 200);
    const c1y = sourcePoint.y + Math.sign(dy || 1) * control;
    const c2y = targetPoint.y - Math.sign(dy || 1) * control;
    return `M ${sourcePoint.x} ${sourcePoint.y} C ${sourcePoint.x} ${c1y}, ${targetPoint.x} ${c2y}, ${targetPoint.x} ${targetPoint.y}`;
  }

  #highlightSelection() {
    if (!this.#nodeLayerEl) return;

    this.#nodeLayerEl.querySelectorAll("[data-node-id]").forEach((nodeEl) => {
      const isSelected = nodeEl.dataset.nodeId === this.#selectedNodeId;
      nodeEl.classList.toggle("is-selected", isSelected);
      nodeEl.classList.toggle("is-connect-source", nodeEl.dataset.nodeId === this.#connectState.sourceNodeId);
    });
  }

  #escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
}

customElements.define("graph-canvas", GraphCanvas);
