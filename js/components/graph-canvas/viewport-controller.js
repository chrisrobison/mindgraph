import { clampZoom } from "../../core/constants.js";
import { zoomAtClientPoint } from "./canvas-viewport.js";

export const createViewportController = ({
  workspaceEl,
  initialViewport,
  applyViewportTransform,
  publishViewportUpdateRequested
}) => {
  let viewport = {
    x: Number(initialViewport?.x ?? 0),
    y: Number(initialViewport?.y ?? 0),
    zoom: clampZoom(Number(initialViewport?.zoom ?? 1))
  };
  let panState = null;

  const updateViewport = (nextViewport) => {
    const nextZoom = Number(nextViewport?.zoom ?? viewport.zoom);
    const nextX = Number(nextViewport?.x ?? viewport.x);
    const nextY = Number(nextViewport?.y ?? viewport.y);
    if (!Number.isFinite(nextZoom)) return;

    viewport = {
      x: Number.isFinite(nextX) ? nextX : viewport.x,
      y: Number.isFinite(nextY) ? nextY : viewport.y,
      zoom: clampZoom(nextZoom)
    };
    applyViewportTransform(viewport);
  };

  const handlePointerDown = (event, activeTool) => {
    const canPan = activeTool === "pan" || event.button === 1;
    if (!canPan || !workspaceEl) return false;

    panState = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: viewport.x,
      originY: viewport.y,
      moved: false
    };

    workspaceEl.setPointerCapture(event.pointerId);
    event.preventDefault();
    return true;
  };

  const handlePointerMove = (event) => {
    if (!panState || event.pointerId !== panState.pointerId) return false;

    const deltaX = event.clientX - panState.startClientX;
    const deltaY = event.clientY - panState.startClientY;

    panState.moved = Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1;
    viewport = {
      ...viewport,
      x: panState.originX + deltaX,
      y: panState.originY + deltaY
    };
    applyViewportTransform(viewport);
    return true;
  };

  const handlePointerUp = (event) => {
    if (!panState || event.pointerId !== panState.pointerId || !workspaceEl) return false;

    workspaceEl.releasePointerCapture(event.pointerId);
    const changed = panState.moved;
    panState = null;

    if (changed) {
      publishViewportUpdateRequested({
        x: viewport.x,
        y: viewport.y,
        zoom: viewport.zoom
      });
    }
    return true;
  };

  const handleWheel = (event) => {
    if (!workspaceEl) return false;
    event.preventDefault();

    const direction = event.deltaY < 0 ? 1 : -1;
    const nextViewport = zoomAtClientPoint(
      workspaceEl,
      viewport,
      event.clientX,
      event.clientY,
      direction
    );

    if (nextViewport.zoom === viewport.zoom) return true;

    viewport = nextViewport;
    applyViewportTransform(viewport);
    publishViewportUpdateRequested({
      x: viewport.x,
      y: viewport.y,
      zoom: viewport.zoom
    });
    return true;
  };

  return {
    getViewport: () => viewport,
    updateViewport,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleWheel
  };
};
