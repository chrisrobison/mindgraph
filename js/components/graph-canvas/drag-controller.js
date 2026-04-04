import { clampGraphPoint } from "../../core/constants.js";

export const createDragController = ({
  workspaceEl,
  canDragWithTool,
  screenToWorld,
  renderPreview,
  commitMove,
  restoreRender
}) => {
  let dragState = null;

  const beginNodeDrag = (event, node, activeTool) => {
    if (event.button !== 0 || !workspaceEl) return false;
    if (!canDragWithTool(activeTool)) return false;

    workspaceEl.setPointerCapture(event.pointerId);
    workspaceEl.classList.add("is-dragging-node");

    const worldPoint = screenToWorld(event.clientX, event.clientY);
    dragState = {
      pointerId: event.pointerId,
      nodeId: node.id,
      offsetX: worldPoint.x - (node.position?.x ?? 0),
      offsetY: worldPoint.y - (node.position?.y ?? 0),
      previewPosition: node.position ?? { x: 0, y: 0 },
      moved: false
    };
    return true;
  };

  const handlePointerMove = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return false;

    const worldPoint = screenToWorld(event.clientX, event.clientY);
    const nextX = Math.round(worldPoint.x - dragState.offsetX);
    const nextY = Math.round(worldPoint.y - dragState.offsetY);
    dragState.moved = true;
    dragState.previewPosition = clampGraphPoint({ x: nextX, y: nextY });
    renderPreview(dragState.nodeId, dragState.previewPosition);
    return true;
  };

  const handlePointerUp = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId || !workspaceEl) return false;

    workspaceEl.releasePointerCapture(event.pointerId);
    workspaceEl.classList.remove("is-dragging-node");

    const moved = dragState.moved;
    const nodeId = dragState.nodeId;
    const previewPosition = dragState.previewPosition;
    dragState = null;

    if (moved && previewPosition) {
      commitMove(nodeId, previewPosition);
    } else {
      restoreRender();
    }
    return true;
  };

  return {
    isDragging: () => Boolean(dragState),
    beginNodeDrag,
    handlePointerMove,
    handlePointerUp
  };
};
