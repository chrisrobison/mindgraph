import { renderEdgesSvg } from "./canvas-edges.js";

const nodeTagByType = {
  note: "note-node",
  agent: "agent-node",
  data: "data-node",
  transformer: "transformer-node",
  view: "view-node",
  action: "action-node"
};

export const renderNodes = (nodeLayerEl, nodes, onNodePointerDown) => {
  if (!nodeLayerEl) return;

  nodeLayerEl.innerHTML = "";

  for (const node of nodes) {
    const tag = nodeTagByType[node.type] ?? "note-node";
    const nodeEl = document.createElement(tag);
    nodeEl.classList.add("mg-node-instance");
    nodeEl.dataset.nodeId = node.id;
    nodeEl.dataset.nodeType = node.type;
    nodeEl.style.left = `${node.position?.x ?? 0}px`;
    nodeEl.style.top = `${node.position?.y ?? 0}px`;
    nodeEl.node = node;
    nodeEl.addEventListener("pointerdown", (event) => onNodePointerDown(event, node));
    nodeLayerEl.append(nodeEl);
  }
};

export const renderEdges = (edgeLayerEl, nodes, edges) => {
  renderEdgesSvg(edgeLayerEl, nodes, edges);
};

export const highlightSelection = (nodeLayerEl, selectedNodeIds = [], connectSourceNodeId = null) => {
  if (!nodeLayerEl) return;

  const selectedSet = new Set(selectedNodeIds);

  nodeLayerEl.querySelectorAll("[data-node-id]").forEach((nodeEl) => {
    const isSelected = selectedSet.has(nodeEl.dataset.nodeId);
    nodeEl.classList.toggle("is-selected", isSelected);
    nodeEl.classList.toggle("is-connect-source", nodeEl.dataset.nodeId === connectSourceNodeId);
  });
};
