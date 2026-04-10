import { clampGraphPoint, formatEdgeLabel, NODE_TEMPLATES, WORLD_SIZE } from "../core/constants.js";
import { EVENTS } from "../core/event-constants.js";
import { getEdgeCreationPresets, inferDefaultEdgeType } from "../core/graph-semantics.js";
import { publish, subscribe } from "../core/pan.js";
import { graphStore } from "../store/graph-store.js";
import { uiStore } from "../store/ui-store.js";
import { highlightSelection } from "./graph-canvas/canvas-renderer.js";
import { applyViewportTransform, screenToWorld } from "./graph-canvas/canvas-viewport.js";
import { createDragController } from "./graph-canvas/drag-controller.js";
import { createEdgeConnectController } from "./graph-canvas/edge-connect-controller.js";
import { createKeyboardShortcutController } from "./graph-canvas/keyboard-shortcut-controller.js";
import { createMarqueeSelectionController } from "./graph-canvas/marquee-selection-controller.js";
import {
  buildPlannedNodes,
  renderCanvasLayers,
  renderNodeDragPreview
} from "./graph-canvas/render-coordinator.js";
import { createViewportController } from "./graph-canvas/viewport-controller.js";

class GraphCanvas extends HTMLElement {
  #selectedNodeIds = [];
  #selectedEdgeId = null;
  #activeTool = "select";
  #dispose = [];
  #workspaceEl = null;
  #sceneEl = null;
  #nodeLayerEl = null;
  #edgeLayerEl = null;
  #edgeChooserEl = null;

  // The shell owns subscriptions and state snapshots; controllers own transient pointer/key interactions.
  #viewportController = null;
  #dragController = null;
  #marqueeController = null;
  #edgeConnectController = null;
  #keyboardController = null;

  connectedCallback() {
    this.#renderShell();

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_DOCUMENT_LOADED, ({ payload }) => {
        const nextViewport = payload?.document?.viewport;
        if (nextViewport) {
          this.#viewportController?.updateViewport({
            x: Number(nextViewport.x ?? 0),
            y: Number(nextViewport.y ?? 0),
            zoom: Number(nextViewport.zoom ?? 1)
          });
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
        this.#viewportController?.updateViewport({
          x: payload?.x,
          y: payload?.y,
          zoom: payload?.zoom
        });
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.TOOLBAR_TOOL_CHANGED, ({ payload }) => {
        this.#activeTool = payload?.tool ?? "select";
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
      subscribe(EVENTS.GRAPH_EDGE_SELECTED, ({ payload }) => {
        this.#selectedEdgeId = payload?.edgeId ?? null;
        this.#renderGraph();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_EDGE_SELECTION_CLEARED, () => {
        this.#selectedEdgeId = null;
        this.#renderGraph();
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
    this.#selectedEdgeId = graphStore.getSelectedEdgeId();
    this.#renderGraph();
  }

  disconnectedCallback() {
    this.#dispose.forEach((run) => run());
    this.#dispose = [];
  }

  #renderShell() {
    this.innerHTML = `
      <section class="mg-graph-panel">
        <div class="graph-wrap">
          <div class="graph-workspace" data-role="workspace" tabindex="0">
            <div class="graph-scene" data-role="scene">
              <svg class="graph-edges-layer" data-role="edges" width="${WORLD_SIZE.width}" height="${WORLD_SIZE.height}" viewBox="0 0 ${WORLD_SIZE.width} ${WORLD_SIZE.height}" aria-hidden="true"></svg>
              <div class="graph-node-layer" data-role="nodes"></div>
            </div>
            <div class="graph-marquee" data-role="marquee" hidden></div>
            <div class="graph-edge-chooser" data-role="edge-chooser" hidden></div>
          </div>
        </div>
      </section>
    `;

    this.#workspaceEl = this.querySelector('[data-role="workspace"]');
    this.#sceneEl = this.querySelector('[data-role="scene"]');
    this.#nodeLayerEl = this.querySelector('[data-role="nodes"]');
    this.#edgeLayerEl = this.querySelector('[data-role="edges"]');
    this.#edgeChooserEl = this.querySelector('[data-role="edge-chooser"]');

    this.#initializeControllers();
    this.#bindInteractionEvents();
    this.#applyViewportTransform();
  }

  #initializeControllers() {
    this.#viewportController = createViewportController({
      workspaceEl: this.#workspaceEl,
      initialViewport: { x: 0, y: 0, zoom: 1 },
      applyViewportTransform: (viewport) => {
        applyViewportTransform(this.#sceneEl, this.#workspaceEl, viewport);
      },
      publishViewportUpdateRequested: (viewport) => {
        publish(EVENTS.GRAPH_VIEWPORT_UPDATE_REQUESTED, {
          ...viewport,
          origin: "graph-canvas"
        });
      }
    });

    const screenToWorldAtClient = (clientX, clientY) =>
      screenToWorld(this.#workspaceEl, this.#viewportController.getViewport(), clientX, clientY);

    this.#edgeConnectController = createEdgeConnectController({
      workspaceEl: this.#workspaceEl,
      edgeChooserEl: this.#edgeChooserEl,
      screenToWorld: screenToWorldAtClient,
      getNodeById: (nodeId) => graphStore.getNode(nodeId),
      getEdgeCreationPresets,
      inferDefaultEdgeType,
      formatEdgeLabel,
      publishEdgeSelectionCleared: () => {
        publish(EVENTS.GRAPH_EDGE_SELECTION_CLEAR_REQUESTED, { origin: "graph-canvas" });
      },
      publishEdgeCreateRequested: (payload) => {
        publish(EVENTS.GRAPH_EDGE_CREATE_REQUESTED, {
          ...payload,
          origin: "graph-canvas"
        });
      },
      onVisualStateChanged: () => {
        this.#highlightSelection();
      }
    });

    this.#dragController = createDragController({
      workspaceEl: this.#workspaceEl,
      canDragWithTool: (tool) => tool === "select" || tool.startsWith("create:"),
      screenToWorld: screenToWorldAtClient,
      renderPreview: (nodeId, previewPosition) => {
        this.#renderDragPreview(nodeId, previewPosition);
      },
      commitMove: (nodeId, previewPosition) => {
        publish(EVENTS.GRAPH_NODE_MOVE_REQUESTED, {
          nodeId,
          position: previewPosition,
          origin: "graph-canvas"
        });
      },
      restoreRender: () => {
        this.#renderGraph();
      }
    });

    this.#marqueeController = createMarqueeSelectionController({
      workspaceEl: this.#workspaceEl,
      marqueeEl: this.querySelector('[data-role="marquee"]'),
      screenToWorld: screenToWorldAtClient,
      getNodes: () => graphStore.getDocument()?.nodes ?? [],
      getSelectedNodeIds: () => this.#selectedNodeIds,
      requestSelectionClear: () => {
        publish(EVENTS.GRAPH_SELECTION_CLEAR_REQUESTED, { origin: "graph-canvas" });
      },
      requestSelectionSet: (nodeIds) => {
        publish(EVENTS.GRAPH_SELECTION_SET_REQUESTED, { nodeIds, origin: "graph-canvas" });
      }
    });

    this.#keyboardController = createKeyboardShortcutController({
      getActiveTool: () => this.#activeTool,
      getSelectedNodeIds: () => this.#selectedNodeIds,
      hasOpenEdgeChooser: () => this.#edgeConnectController.hasOpenEdgeChooser(),
      isConnecting: () => this.#edgeConnectController.isConnecting(),
      closeEdgeChooser: () => this.#edgeConnectController.closeEdgeChooser(),
      cancelConnectDrag: () => this.#edgeConnectController.cancelConnectDrag(),
      setSelectTool: () => uiStore.setTool("select"),
      requestSelectionClear: () => {
        publish(EVENTS.GRAPH_SELECTION_CLEAR_REQUESTED, { origin: "graph-canvas" });
      },
      canUndo: () => graphStore.canUndo(),
      canRedo: () => graphStore.canRedo(),
      requestUndo: () => {
        publish(EVENTS.GRAPH_DOCUMENT_UNDO_REQUESTED, { origin: "graph-canvas" });
        publish(EVENTS.ACTIVITY_LOG_APPENDED, { level: "info", message: "Undo applied" });
      },
      requestRedo: () => {
        publish(EVENTS.GRAPH_DOCUMENT_REDO_REQUESTED, { origin: "graph-canvas" });
        publish(EVENTS.ACTIVITY_LOG_APPENDED, { level: "info", message: "Redo applied" });
      },
      requestDeleteNodes: (nodeIds) => {
        publish(EVENTS.GRAPH_NODE_DELETE_REQUESTED, {
          nodeIds: [...nodeIds],
          origin: "graph-canvas"
        });
        publish(EVENTS.ACTIVITY_LOG_APPENDED, {
          level: "info",
          message: `Deleted ${nodeIds.length} node(s)`
        });
      },
      duplicateSelectedNode: () => {
        this.#duplicateSelectedNode();
      }
    });
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
    if (event.target.closest('[data-role="edge-chooser"]')) return;
    if (this.#edgeConnectController.hasOpenEdgeChooser()) {
      this.#edgeConnectController.closeEdgeChooser();
    }

    this.#workspaceEl.focus();
    if (event.target.closest("[data-node-id]")) return;

    if (event.button === 0 && this.#activeTool.startsWith("create:")) {
      const nodeType = this.#activeTool.split(":")[1] ?? "note";
      const worldPoint = this.#screenToWorld(event.clientX, event.clientY);
      this.#createNodeAt(nodeType, worldPoint);
      event.preventDefault();
      return;
    }

    // Interaction ownership priority for empty-canvas events:
    // marquee select -> pan/viewport. This preserves existing behavior and avoids controller overlap.
    if (this.#marqueeController.handlePointerDown(event, this.#activeTool)) return;
    this.#viewportController.handlePointerDown(event, this.#activeTool);
  }

  #onWorkspacePointerMove(event) {
    // During pointermove, active transient interactions own the event in strict order.
    if (this.#edgeConnectController.handlePointerMove(event)) return;
    if (this.#dragController.handlePointerMove(event)) return;
    if (this.#marqueeController.handlePointerMove(event)) return;
    this.#viewportController.handlePointerMove(event);
  }

  #onWorkspacePointerUp(event) {
    if (this.#edgeConnectController.handlePointerUp(event)) return;
    if (this.#dragController.handlePointerUp(event)) return;
    if (this.#marqueeController.handlePointerUp(event, this.#activeTool)) return;
    this.#viewportController.handlePointerUp(event);
  }

  #onWorkspaceWheel(event) {
    this.#viewportController.handleWheel(event);
  }

  #onWorkspaceKeyDown(event) {
    this.#keyboardController.handleKeyDown(event);
  }

  #onNodePointerDown(event, node) {
    if (event.button !== 0) return;
    if (this.#edgeConnectController.hasOpenEdgeChooser()) this.#edgeConnectController.closeEdgeChooser();
    this.#workspaceEl.focus();
    event.stopPropagation();
    const isModifierConnectGesture = event.metaKey || event.ctrlKey;
    if (isModifierConnectGesture && this.#edgeConnectController.onNodeModifierPointerDown(event, node)) {
      return;
    }

    publish(EVENTS.GRAPH_NODE_SELECT_REQUESTED, {
      nodeId: node.id,
      additive: event.shiftKey,
      toggle: event.shiftKey,
      origin: "graph-canvas"
    });

    this.#dragController.beginNodeDrag(event, node, this.#activeTool);
  }

  #onConnectHandlePointerDown(event, node) {
    this.#edgeConnectController.onConnectHandlePointerDown(event, node);
  }

  #onEdgePointerDown(event, edgeId) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.#workspaceEl.focus();

    publish(EVENTS.GRAPH_EDGE_SELECT_REQUESTED, {
      edgeId,
      origin: "graph-canvas"
    });
  }

  #renderDragPreview(nodeId, previewPosition) {
    const document = graphStore.getDocument();
    const edgeDraftEl = renderNodeDragPreview({
      nodeLayerEl: this.#nodeLayerEl,
      edgeLayerEl: this.#edgeLayerEl,
      document,
      nodeId,
      previewPosition,
      selectedEdgeId: this.#selectedEdgeId,
      onEdgePointerDown: (event, edgeId) => this.#onEdgePointerDown(event, edgeId)
    });

    this.#edgeConnectController.setEdgeDraftElement(edgeDraftEl);
    this.#edgeConnectController.refreshTransientUi();
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
    return screenToWorld(this.#workspaceEl, this.#viewportController.getViewport(), clientX, clientY);
  }

  #syncInteractionMode() {
    if (!this.#workspaceEl) return;
    this.#workspaceEl.dataset.tool = this.#activeTool;
  }

  #applyViewportTransform() {
    applyViewportTransform(this.#sceneEl, this.#workspaceEl, this.#viewportController.getViewport());
  }

  #renderGraph() {
    const document = graphStore.getDocument();
    const nodes = document?.nodes ?? [];
    const edges = document?.edges ?? [];
    const plannedNodes = buildPlannedNodes(document);

    const edgeDraftEl = renderCanvasLayers({
      nodeLayerEl: this.#nodeLayerEl,
      edgeLayerEl: this.#edgeLayerEl,
      nodes,
      plannedNodes,
      edges,
      selectedEdgeId: this.#selectedEdgeId,
      onNodePointerDown: (event, node) => this.#onNodePointerDown(event, node),
      onConnectHandlePointerDown: (event, node) => this.#onConnectHandlePointerDown(event, node),
      onEdgePointerDown: (event, edgeId) => this.#onEdgePointerDown(event, edgeId)
    });

    this.#edgeConnectController.setEdgeDraftElement(edgeDraftEl);
    this.#edgeConnectController.refreshTransientUi();
    this.#highlightSelection();
    this.#applyViewportTransform();
  }

  #highlightSelection() {
    highlightSelection(
      this.#nodeLayerEl,
      this.#selectedNodeIds,
      this.#edgeConnectController?.getConnectSourceNodeId() ?? null,
      this.#edgeConnectController?.getHoveredNodeId() ?? null
    );
  }
}

customElements.define("graph-canvas", GraphCanvas);
