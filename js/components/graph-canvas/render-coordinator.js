import { buildExecutionPlan } from "../../runtime/execution-planner.js";
import { renderEdges, renderNodes } from "./canvas-renderer.js";

const bindEdgePointerEvents = (edgeLayerEl, onEdgePointerDown) => {
  edgeLayerEl?.querySelectorAll("[data-edge-id]").forEach((edgeEl) => {
    edgeEl.addEventListener("pointerdown", (event) => onEdgePointerDown(event, edgeEl.dataset.edgeId));
  });
};

export const buildPlannedNodes = (document) => {
  const nodes = document?.nodes ?? [];
  const plan = buildExecutionPlan(document);

  return nodes.map((node) => ({
    ...node,
    metadata: {
      ...(node.metadata ?? {}),
      planning: plan.nodes?.[node.id] ?? null
    }
  }));
};

export const renderCanvasLayers = ({
  nodeLayerEl,
  edgeLayerEl,
  nodes,
  plannedNodes,
  edges,
  selectedEdgeId,
  onNodePointerDown,
  onConnectHandlePointerDown,
  onEdgePointerDown
}) => {
  renderNodes(nodeLayerEl, plannedNodes, onNodePointerDown, onConnectHandlePointerDown);
  renderEdges(edgeLayerEl, nodes, edges, selectedEdgeId);
  bindEdgePointerEvents(edgeLayerEl, onEdgePointerDown);
  return edgeLayerEl?.querySelector('[data-role="edge-draft"]') ?? null;
};

export const renderNodeDragPreview = ({
  nodeLayerEl,
  edgeLayerEl,
  document,
  nodeId,
  previewPosition,
  selectedEdgeId,
  onEdgePointerDown
}) => {
  const nodeEl = nodeLayerEl?.querySelector(`[data-node-id="${nodeId}"]`);
  if (nodeEl) {
    nodeEl.style.left = `${previewPosition.x}px`;
    nodeEl.style.top = `${previewPosition.y}px`;
  }

  const previewNodes = (document?.nodes ?? []).map((node) =>
    node.id === nodeId
      ? {
          ...node,
          position: previewPosition
        }
      : node
  );

  renderEdges(edgeLayerEl, previewNodes, document?.edges ?? [], selectedEdgeId);
  bindEdgePointerEvents(edgeLayerEl, onEdgePointerDown);
  return edgeLayerEl?.querySelector('[data-role="edge-draft"]') ?? null;
};
