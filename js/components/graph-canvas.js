import {
  clampGraphPoint,
  clampZoom,
  formatEdgeLabel,
  NODE_TEMPLATES,
  WORLD_SIZE
} from "../core/constants.js";
import { EVENTS } from "../core/event-constants.js";
import { EDGE_TYPE_VALUES } from "../core/types.js";
import { publish, subscribe } from "../core/pan.js";
import { graphStore } from "../store/graph-store.js";
import { uiStore } from "../store/ui-store.js";
import { renderEdges, renderNodes, highlightSelection } from "./graph-canvas/canvas-renderer.js";
import { applyViewportTransform, screenToWorld, zoomAtClientPoint } from "./graph-canvas/canvas-viewport.js";
import { findNodeIdsInWorldRect, normalizeScreenRect } from "./graph-canvas/canvas-selection.js";

const isUndoShortcut = (event) =>
  (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z";
const isRedoShortcut = (event) =>
  (event.ctrlKey || event.metaKey) &&
  ((event.shiftKey && event.key.toLowerCase() === "z") || event.key.toLowerCase() === "y");

class GraphCanvas extends HTMLElement {
  #selectedNodeIds = [];
  #activeTool = "select";
  #connectState = { sourceNodeId: null };
  #dispose = [];
  #viewport = { x: 0, y: 0, zoom: 1 };
  #workspaceEl = null;
  #sceneEl = null;
  #nodeLayerEl = null;
  #edgeLayerEl = null;
  #marqueeEl = null;
  #edgePopoverEl = null;
  #edgeTypeField = null;
  #edgeLabelField = null;
  #panState = null;
  #dragState = null;
  #marqueeState = null;
  #edgePopoverState = null;

  connectedCallback() {
    this.#renderShell();

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_DOCUMENT_LOADED, ({ payload }) => {
        const nextViewport = payload?.document?.viewport;
        if (nextViewport) {
          this.#viewport = {
            x: Number(nextViewport.x ?? 0),
            y: Number(nextViewport.y ?? 0),
            zoom: clampZoom(Number(nextViewport.zoom ?? 1))
          };
        }

        this.#renderGraph();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_DOCUMENT_CHANGED, ({ payload }) => {
        if (payload?.reason === "viewport") return;
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
        if (this.#activeTool !== "connect") {
          this.#connectState.sourceNodeId = null;
          this.#closeEdgePopover();
        }
        this.#syncInteractionMode();
        this.#highlightSelection();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_SELECTION_SET, ({ payload }) => {
        this.#selectedNodeIds = Array.isArray(payload?.nodeIds)
          ? [...payload.nodeIds]
          : payload?.nodeId
            ? [payload.nodeId]
            : [];
        this.#highlightSelection();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_SELECTION_CLEARED, () => {
        this.#selectedNodeIds = [];
        this.#highlightSelection();
      })
    );

    this.#syncInteractionMode();
    this.#selectedNodeIds = graphStore.getSelectedNodeIds();
    this.#renderGraph();
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
              <svg class="graph-edges-layer" data-role="edges" width="${WORLD_SIZE.width}" height="${WORLD_SIZE.height}" viewBox="0 0 ${WORLD_SIZE.width} ${WORLD_SIZE.height}" aria-hidden="true"></svg>
              <div class="graph-node-layer" data-role="nodes"></div>
            </div>
            <div class="graph-marquee" data-role="marquee" hidden></div>
            <div class="graph-edge-popover" data-role="edge-popover" hidden>
              <label>
                Edge Type
                <select data-role="edge-type" name="edge-type">
                  ${EDGE_TYPE_VALUES.map((type) => `<option value="${type}">${type}</option>`).join("")}
                </select>
              </label>
              <label>
                Label
                <input data-role="edge-label" name="edge-label" type="text" placeholder="Optional label" />
              </label>
              <div class="graph-edge-popover-actions">
                <button type="button" data-action="edge-cancel">Cancel</button>
                <button type="button" data-action="edge-create">Create Edge</button>
              </div>
            </div>
          </div>
        </div>
      </section>
    `;

    this.#workspaceEl = this.querySelector('[data-role="workspace"]');
    this.#sceneEl = this.querySelector('[data-role="scene"]');
    this.#nodeLayerEl = this.querySelector('[data-role="nodes"]');
    this.#edgeLayerEl = this.querySelector('[data-role="edges"]');
    this.#marqueeEl = this.querySelector('[data-role="marquee"]');
    this.#edgePopoverEl = this.querySelector('[data-role="edge-popover"]');
    this.#edgeTypeField = this.querySelector('[data-role="edge-type"]');
    this.#edgeLabelField = this.querySelector('[data-role="edge-label"]');

    this.#bindInteractionEvents();
    this.#bindEdgePopoverEvents();
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

  #bindEdgePopoverEvents() {
    this.querySelector('[data-action="edge-cancel"]')?.addEventListener("click", () => {
      this.#closeEdgePopover();
      this.#connectState.sourceNodeId = null;
      this.#highlightSelection();
    });

    this.querySelector('[data-action="edge-create"]')?.addEventListener("click", () => {
      this.#commitEdgeFromPopover();
    });

    this.#edgeTypeField?.addEventListener("change", () => {
      if (!this.#edgePopoverState) return;

      this.#edgePopoverState.edgeType = this.#edgeTypeField.value;
      if (!this.#edgePopoverState.labelTouched) {
        this.#edgeLabelField.value = formatEdgeLabel(this.#edgePopoverState.edgeType);
      }
    });

    this.#edgeLabelField?.addEventListener("input", () => {
      if (!this.#edgePopoverState) return;
      this.#edgePopoverState.labelTouched = true;
    });
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

    if (event.button === 0 && this.#activeTool === "select") {
      const rect = this.#workspaceEl.getBoundingClientRect();
      this.#marqueeState = {
        pointerId: event.pointerId,
        startX: event.clientX - rect.left,
        startY: event.clientY - rect.top,
        endX: event.clientX - rect.left,
        endY: event.clientY - rect.top,
        moved: false,
        additive: event.shiftKey
      };
      this.#workspaceEl.setPointerCapture(event.pointerId);
      this.#updateMarquee();
      event.preventDefault();
      return;
    }

    const canPan = this.#activeTool === "pan" || event.button === 1;
    if (!canPan) return;

    this.#panState = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: this.#viewport.x,
      originY: this.#viewport.y,
      moved: false
    };

    this.#workspaceEl.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  #onWorkspacePointerMove(event) {
    if (this.#dragState && event.pointerId === this.#dragState.pointerId) {
      const worldPoint = this.#screenToWorld(event.clientX, event.clientY);
      const nextX = Math.round(worldPoint.x - this.#dragState.offsetX);
      const nextY = Math.round(worldPoint.y - this.#dragState.offsetY);
      const previewPosition = clampGraphPoint({ x: nextX, y: nextY });

      this.#dragState.moved = true;
      this.#dragState.previewPosition = previewPosition;
      this.#applyDragPreview();
      return;
    }

    if (this.#marqueeState && event.pointerId === this.#marqueeState.pointerId) {
      const rect = this.#workspaceEl.getBoundingClientRect();
      this.#marqueeState.endX = event.clientX - rect.left;
      this.#marqueeState.endY = event.clientY - rect.top;
      this.#marqueeState.moved =
        Math.abs(this.#marqueeState.endX - this.#marqueeState.startX) > 3 ||
        Math.abs(this.#marqueeState.endY - this.#marqueeState.startY) > 3;
      this.#updateMarquee();
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

      const moved = this.#dragState.moved;
      const nodeId = this.#dragState.nodeId;
      const previewPosition = this.#dragState.previewPosition;
      this.#dragState = null;

      if (moved && previewPosition) {
        publish(EVENTS.GRAPH_NODE_MOVE_REQUESTED, {
          nodeId,
          position: previewPosition,
          origin: "graph-canvas"
        });
      } else {
        this.#renderGraph();
      }

      return;
    }

    if (this.#marqueeState && event.pointerId === this.#marqueeState.pointerId) {
      this.#workspaceEl.releasePointerCapture(event.pointerId);
      const marqueeState = this.#marqueeState;
      this.#marqueeState = null;
      this.#hideMarquee();

      if (!marqueeState.moved) {
        if (this.#activeTool === "select") {
          publish(EVENTS.GRAPH_SELECTION_CLEAR_REQUESTED, { origin: "graph-canvas" });
        }
        return;
      }

      this.#applyMarqueeSelection(marqueeState);
      return;
    }

    if (!this.#panState || event.pointerId !== this.#panState.pointerId) return;

    this.#workspaceEl.releasePointerCapture(event.pointerId);
    const changed = this.#panState.moved;
    this.#panState = null;

    if (changed) {
      publish(EVENTS.GRAPH_VIEWPORT_UPDATE_REQUESTED, {
        x: this.#viewport.x,
        y: this.#viewport.y,
        zoom: this.#viewport.zoom,
        origin: "graph-canvas"
      });
    }
  }

  #onWorkspaceWheel(event) {
    if (!this.#workspaceEl) return;
    event.preventDefault();

    const direction = event.deltaY < 0 ? 1 : -1;
    const nextViewport = zoomAtClientPoint(
      this.#workspaceEl,
      this.#viewport,
      event.clientX,
      event.clientY,
      direction
    );

    if (nextViewport.zoom === this.#viewport.zoom) return;

    this.#viewport = nextViewport;
    this.#applyViewportTransform();

    publish(EVENTS.GRAPH_VIEWPORT_UPDATE_REQUESTED, {
      x: this.#viewport.x,
      y: this.#viewport.y,
      zoom: this.#viewport.zoom,
      origin: "graph-canvas"
    });
  }

  #onWorkspaceKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (this.#edgePopoverState) {
        this.#closeEdgePopover();
        this.#connectState.sourceNodeId = null;
        this.#highlightSelection();
        return;
      }

      if (this.#connectState.sourceNodeId) {
        this.#connectState.sourceNodeId = null;
        this.#highlightSelection();
        return;
      }

      if (this.#activeTool !== "select") {
        uiStore.setTool("select");
      } else {
        publish(EVENTS.GRAPH_SELECTION_CLEAR_REQUESTED, { origin: "graph-canvas" });
      }
      return;
    }

    if (isUndoShortcut(event)) {
      event.preventDefault();
      if (!graphStore.canUndo()) return;
      publish(EVENTS.GRAPH_DOCUMENT_UNDO_REQUESTED, { origin: "graph-canvas" });
      publish(EVENTS.ACTIVITY_LOG_APPENDED, { level: "info", message: "Undo applied" });
      return;
    }

    if (isRedoShortcut(event)) {
      event.preventDefault();
      if (!graphStore.canRedo()) return;
      publish(EVENTS.GRAPH_DOCUMENT_REDO_REQUESTED, { origin: "graph-canvas" });
      publish(EVENTS.ACTIVITY_LOG_APPENDED, { level: "info", message: "Redo applied" });
      return;
    }

    if (!this.#selectedNodeIds.length) return;

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      publish(EVENTS.GRAPH_NODE_DELETE_REQUESTED, {
        nodeIds: [...this.#selectedNodeIds],
        origin: "graph-canvas"
      });
      publish(EVENTS.ACTIVITY_LOG_APPENDED, {
        level: "info",
        message: `Deleted ${this.#selectedNodeIds.length} node(s)`
      });
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

    publish(EVENTS.GRAPH_NODE_SELECT_REQUESTED, {
      nodeId: node.id,
      additive: event.shiftKey,
      toggle: event.shiftKey,
      origin: "graph-canvas"
    });

    const dragEnabled = this.#activeTool === "select" || this.#activeTool.startsWith("create:");
    if (!dragEnabled) return;

    this.#workspaceEl.setPointerCapture(event.pointerId);
    this.#workspaceEl.classList.add("is-dragging-node");

    const worldPoint = this.#screenToWorld(event.clientX, event.clientY);
    this.#dragState = {
      pointerId: event.pointerId,
      nodeId: node.id,
      offsetX: worldPoint.x - (node.position?.x ?? 0),
      offsetY: worldPoint.y - (node.position?.y ?? 0),
      previewPosition: node.position ?? { x: 0, y: 0 },
      moved: false
    };
  }

  #handleConnectClick(node) {
    if (!this.#connectState.sourceNodeId) {
      this.#connectState.sourceNodeId = node.id;
      publish(EVENTS.GRAPH_NODE_SELECT_REQUESTED, { nodeId: node.id, origin: "graph-canvas" });
      publish(EVENTS.ACTIVITY_LOG_APPENDED, {
        level: "info",
        message: `Connect mode: source set to ${node.label}`
      });
      this.#highlightSelection();
      return;
    }

    const sourceNodeId = this.#connectState.sourceNodeId;
    const targetNodeId = node.id;
    if (sourceNodeId === targetNodeId) return;

    this.#openEdgePopover(sourceNodeId, targetNodeId);
  }

  #openEdgePopover(sourceNodeId, targetNodeId) {
    const document = graphStore.getDocument();
    const source = (document?.nodes ?? []).find((node) => node.id === sourceNodeId);
    const target = (document?.nodes ?? []).find((node) => node.id === targetNodeId);
    if (!source || !target || !this.#edgePopoverEl) return;

    const edgeType = "depends_on";
    const label = formatEdgeLabel(edgeType);

    this.#edgePopoverState = {
      sourceNodeId,
      targetNodeId,
      edgeType,
      labelTouched: false
    };

    this.#edgeTypeField.value = edgeType;
    this.#edgeLabelField.value = label;

    const worldX = ((source.position?.x ?? 0) + (target.position?.x ?? 0)) / 2;
    const worldY = ((source.position?.y ?? 0) + (target.position?.y ?? 0)) / 2;
    const screenX = worldX * this.#viewport.zoom + this.#viewport.x;
    const screenY = worldY * this.#viewport.zoom + this.#viewport.y;

    this.#edgePopoverEl.hidden = false;
    this.#edgePopoverEl.style.left = `${screenX}px`;
    this.#edgePopoverEl.style.top = `${screenY}px`;
    this.#edgeLabelField.focus();
  }

  #commitEdgeFromPopover() {
    if (!this.#edgePopoverState) return;

    const edgeType = EDGE_TYPE_VALUES.includes(this.#edgeTypeField.value)
      ? this.#edgeTypeField.value
      : "depends_on";
    const rawLabel = String(this.#edgeLabelField.value ?? "").trim();

    publish(EVENTS.GRAPH_EDGE_CREATE_REQUESTED, {
      source: this.#edgePopoverState.sourceNodeId,
      target: this.#edgePopoverState.targetNodeId,
      type: edgeType,
      label: rawLabel || formatEdgeLabel(edgeType),
      origin: "graph-canvas"
    });

    publish(EVENTS.ACTIVITY_LOG_APPENDED, {
      level: "info",
      message: `Created edge ${edgeType}`
    });

    publish(EVENTS.GRAPH_NODE_SELECT_REQUESTED, {
      nodeId: this.#edgePopoverState.targetNodeId,
      origin: "graph-canvas"
    });

    this.#closeEdgePopover();
    this.#connectState.sourceNodeId = null;
    this.#highlightSelection();
  }

  #closeEdgePopover() {
    this.#edgePopoverState = null;
    if (this.#edgePopoverEl) {
      this.#edgePopoverEl.hidden = true;
    }
  }

  #applyDragPreview() {
    if (!this.#dragState) return;

    const nodeEl = this.#nodeLayerEl?.querySelector(`[data-node-id="${this.#dragState.nodeId}"]`);
    if (nodeEl) {
      nodeEl.style.left = `${this.#dragState.previewPosition.x}px`;
      nodeEl.style.top = `${this.#dragState.previewPosition.y}px`;
    }

    const document = graphStore.getDocument();
    const previewNodes = (document?.nodes ?? []).map((node) =>
      node.id === this.#dragState.nodeId
        ? {
            ...node,
            position: this.#dragState.previewPosition
          }
        : node
    );

    renderEdges(this.#edgeLayerEl, previewNodes, document?.edges ?? []);
  }

  #updateMarquee() {
    if (!this.#marqueeEl || !this.#marqueeState) return;

    const rect = normalizeScreenRect(
      this.#marqueeState.startX,
      this.#marqueeState.startY,
      this.#marqueeState.endX,
      this.#marqueeState.endY
    );

    this.#marqueeEl.hidden = false;
    this.#marqueeEl.style.left = `${rect.left}px`;
    this.#marqueeEl.style.top = `${rect.top}px`;
    this.#marqueeEl.style.width = `${rect.width}px`;
    this.#marqueeEl.style.height = `${rect.height}px`;
  }

  #hideMarquee() {
    if (!this.#marqueeEl) return;
    this.#marqueeEl.hidden = true;
    this.#marqueeEl.style.width = "0px";
    this.#marqueeEl.style.height = "0px";
  }

  #applyMarqueeSelection(marqueeState) {
    const rect = normalizeScreenRect(
      marqueeState.startX,
      marqueeState.startY,
      marqueeState.endX,
      marqueeState.endY
    );

    const boundsTopLeft = this.#screenToWorld(rect.left + this.#workspaceEl.getBoundingClientRect().left, rect.top + this.#workspaceEl.getBoundingClientRect().top);
    const boundsBottomRight = this.#screenToWorld(rect.right + this.#workspaceEl.getBoundingClientRect().left, rect.bottom + this.#workspaceEl.getBoundingClientRect().top);

    const worldRect = {
      left: Math.min(boundsTopLeft.x, boundsBottomRight.x),
      top: Math.min(boundsTopLeft.y, boundsBottomRight.y),
      right: Math.max(boundsTopLeft.x, boundsBottomRight.x),
      bottom: Math.max(boundsTopLeft.y, boundsBottomRight.y)
    };

    const document = graphStore.getDocument();
    const ids = findNodeIdsInWorldRect(document?.nodes ?? [], worldRect);
    if (!marqueeState.additive) {
      publish(EVENTS.GRAPH_SELECTION_SET_REQUESTED, { nodeIds: ids, origin: "graph-canvas" });
      return;
    }

    const merged = [...new Set([...this.#selectedNodeIds, ...ids])];
    publish(EVENTS.GRAPH_SELECTION_SET_REQUESTED, { nodeIds: merged, origin: "graph-canvas" });
  }

  #createNodeAt(nodeType, position) {
    const template = NODE_TEMPLATES[nodeType] ?? NODE_TEMPLATES.note;
    const normalizedPosition = clampGraphPoint(position);

    publish(EVENTS.GRAPH_NODE_CREATE_REQUESTED, {
      node: {
        type: nodeType,
        label: template.label,
        description: template.description,
        position: normalizedPosition,
        data: structuredClone(template.data),
        metadata: { createdFromTool: this.#activeTool }
      },
      selectAfterCreate: true,
      origin: "graph-canvas"
    });

    publish(EVENTS.ACTIVITY_LOG_APPENDED, {
      level: "info",
      message: `Created ${nodeType} node`
    });
  }

  #duplicateSelectedNode() {
    const sourceId = this.#selectedNodeIds[0] ?? null;
    if (!sourceId) return;
    const source = graphStore.getNode(sourceId);
    if (!source) return;

    publish(EVENTS.GRAPH_NODE_CREATE_REQUESTED, {
      node: {
        type: source.type,
        label: `${source.label} Copy`,
        description: source.description,
        position: clampGraphPoint({
          x: Number(source.position?.x ?? 0) + 36,
          y: Number(source.position?.y ?? 0) + 28
        }),
        data: structuredClone(source.data ?? {}),
        metadata: { ...(source.metadata ?? {}), duplicatedFrom: source.id }
      },
      selectAfterCreate: true,
      origin: "graph-canvas"
    });

    publish(EVENTS.ACTIVITY_LOG_APPENDED, {
      level: "info",
      message: `Duplicated node ${source.label}`
    });
  }

  #screenToWorld(clientX, clientY) {
    return screenToWorld(this.#workspaceEl, this.#viewport, clientX, clientY);
  }

  #syncInteractionMode() {
    if (!this.#workspaceEl) return;
    this.#workspaceEl.dataset.tool = this.#activeTool;
  }

  #applyViewportTransform() {
    applyViewportTransform(this.#sceneEl, this.#workspaceEl, this.#viewport);
  }

  #renderGraph() {
    const document = graphStore.getDocument();
    const nodes = document?.nodes ?? [];
    const edges = document?.edges ?? [];

    renderNodes(this.#nodeLayerEl, nodes, (event, node) => this.#onNodePointerDown(event, node));
    renderEdges(this.#edgeLayerEl, nodes, edges);
    this.#highlightSelection();
    this.#applyViewportTransform();
  }

  #highlightSelection() {
    highlightSelection(this.#nodeLayerEl, this.#selectedNodeIds, this.#connectState.sourceNodeId);
  }
}

customElements.define("graph-canvas", GraphCanvas);
