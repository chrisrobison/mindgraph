import { findNodeIdsInWorldRect, normalizeScreenRect } from "./canvas-selection.js";

export const createMarqueeSelectionController = ({
  workspaceEl,
  marqueeEl,
  screenToWorld,
  getNodes,
  getSelectedNodeIds,
  requestSelectionClear,
  requestSelectionSet
}) => {
  let marqueeState = null;

  const updateMarquee = () => {
    if (!marqueeEl || !marqueeState) return;

    const rect = normalizeScreenRect(
      marqueeState.startX,
      marqueeState.startY,
      marqueeState.endX,
      marqueeState.endY
    );

    marqueeEl.hidden = false;
    marqueeEl.style.left = `${rect.left}px`;
    marqueeEl.style.top = `${rect.top}px`;
    marqueeEl.style.width = `${rect.width}px`;
    marqueeEl.style.height = `${rect.height}px`;
  };

  const hideMarquee = () => {
    if (!marqueeEl) return;
    marqueeEl.hidden = true;
    marqueeEl.style.width = "0px";
    marqueeEl.style.height = "0px";
  };

  const applyMarqueeSelection = (state) => {
    if (!workspaceEl) return;

    const rect = normalizeScreenRect(state.startX, state.startY, state.endX, state.endY);
    const workspaceRect = workspaceEl.getBoundingClientRect();
    const boundsTopLeft = screenToWorld(rect.left + workspaceRect.left, rect.top + workspaceRect.top);
    const boundsBottomRight = screenToWorld(rect.right + workspaceRect.left, rect.bottom + workspaceRect.top);
    const worldRect = {
      left: Math.min(boundsTopLeft.x, boundsBottomRight.x),
      top: Math.min(boundsTopLeft.y, boundsBottomRight.y),
      right: Math.max(boundsTopLeft.x, boundsBottomRight.x),
      bottom: Math.max(boundsTopLeft.y, boundsBottomRight.y)
    };

    const ids = findNodeIdsInWorldRect(getNodes(), worldRect);
    if (!state.additive) {
      requestSelectionSet(ids);
      return;
    }

    const merged = [...new Set([...getSelectedNodeIds(), ...ids])];
    requestSelectionSet(merged);
  };

  const handlePointerDown = (event, activeTool) => {
    if (event.button !== 0 || activeTool !== "select" || !workspaceEl) return false;

    const rect = workspaceEl.getBoundingClientRect();
    marqueeState = {
      pointerId: event.pointerId,
      startX: event.clientX - rect.left,
      startY: event.clientY - rect.top,
      endX: event.clientX - rect.left,
      endY: event.clientY - rect.top,
      moved: false,
      additive: event.shiftKey
    };
    workspaceEl.setPointerCapture(event.pointerId);
    updateMarquee();
    event.preventDefault();
    return true;
  };

  const handlePointerMove = (event) => {
    if (!marqueeState || event.pointerId !== marqueeState.pointerId || !workspaceEl) return false;

    const rect = workspaceEl.getBoundingClientRect();
    marqueeState.endX = event.clientX - rect.left;
    marqueeState.endY = event.clientY - rect.top;
    marqueeState.moved =
      Math.abs(marqueeState.endX - marqueeState.startX) > 3 ||
      Math.abs(marqueeState.endY - marqueeState.startY) > 3;
    updateMarquee();
    return true;
  };

  const handlePointerUp = (event, activeTool) => {
    if (!marqueeState || event.pointerId !== marqueeState.pointerId || !workspaceEl) return false;

    workspaceEl.releasePointerCapture(event.pointerId);
    const finishedState = marqueeState;
    marqueeState = null;
    hideMarquee();

    if (!finishedState.moved) {
      if (activeTool === "select") requestSelectionClear();
      return true;
    }

    applyMarqueeSelection(finishedState);
    return true;
  };

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp
  };
};
