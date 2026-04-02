import { GRAPH_LIMITS, clampZoom } from "../../core/constants.js";

export const applyViewportTransform = (sceneEl, workspaceEl, viewport) => {
  if (!sceneEl || !workspaceEl) return;

  sceneEl.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`;
  const backgroundGrid = GRAPH_LIMITS.gridSize * viewport.zoom;
  workspaceEl.style.backgroundSize = `${backgroundGrid}px ${backgroundGrid}px`;
  workspaceEl.style.backgroundPosition = `${viewport.x}px ${viewport.y}px`;
};

export const screenToWorld = (workspaceEl, viewport, clientX, clientY) => {
  const rect = workspaceEl.getBoundingClientRect();
  return {
    x: (clientX - rect.left - viewport.x) / viewport.zoom,
    y: (clientY - rect.top - viewport.y) / viewport.zoom
  };
};

export const zoomAtClientPoint = (workspaceEl, viewport, clientX, clientY, direction) => {
  const zoomFactor = direction > 0 ? GRAPH_LIMITS.zoomInFactor : GRAPH_LIMITS.zoomOutFactor;
  const nextZoom = clampZoom(viewport.zoom * zoomFactor);
  if (nextZoom === viewport.zoom) {
    return viewport;
  }

  const rect = workspaceEl.getBoundingClientRect();
  const worldPointBeforeZoom = screenToWorld(workspaceEl, viewport, clientX, clientY);

  return {
    x: clientX - rect.left - worldPointBeforeZoom.x * nextZoom,
    y: clientY - rect.top - worldPointBeforeZoom.y * nextZoom,
    zoom: nextZoom
  };
};
