export const normalizeScreenRect = (startX, startY, endX, endY) => {
  const left = Math.min(startX, endX);
  const top = Math.min(startY, endY);
  const width = Math.abs(endX - startX);
  const height = Math.abs(endY - startY);

  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height
  };
};

export const findNodeIdsInWorldRect = (nodes = [], worldRect) => {
  if (!worldRect) return [];

  return nodes
    .filter((node) => {
      const x = Number(node.position?.x ?? 0);
      const y = Number(node.position?.y ?? 0);
      return x >= worldRect.left && x <= worldRect.right && y >= worldRect.top && y <= worldRect.bottom;
    })
    .map((node) => node.id);
};
