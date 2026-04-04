const isUndoShortcut = (event) =>
  (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z";
const isRedoShortcut = (event) =>
  (event.ctrlKey || event.metaKey) &&
  ((event.shiftKey && event.key.toLowerCase() === "z") || event.key.toLowerCase() === "y");

export const createKeyboardShortcutController = ({
  getActiveTool,
  getSelectedNodeIds,
  hasOpenEdgeChooser,
  isConnecting,
  closeEdgeChooser,
  cancelConnectDrag,
  setSelectTool,
  requestSelectionClear,
  canUndo,
  canRedo,
  requestUndo,
  requestRedo,
  requestDeleteNodes,
  duplicateSelectedNode
}) => ({
  handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (hasOpenEdgeChooser()) {
        closeEdgeChooser();
        return true;
      }
      if (isConnecting()) {
        cancelConnectDrag();
        return true;
      }

      if (getActiveTool() !== "select") {
        setSelectTool();
      } else {
        requestSelectionClear();
      }
      return true;
    }

    if (isUndoShortcut(event)) {
      event.preventDefault();
      if (!canUndo()) return true;
      requestUndo();
      return true;
    }

    if (isRedoShortcut(event)) {
      event.preventDefault();
      if (!canRedo()) return true;
      requestRedo();
      return true;
    }

    const selectedNodeIds = getSelectedNodeIds();
    if (!selectedNodeIds.length) return false;

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      requestDeleteNodes(selectedNodeIds);
      return true;
    }

    const isDuplicateShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d";
    if (isDuplicateShortcut) {
      event.preventDefault();
      duplicateSelectedNode();
      return true;
    }

    return false;
  }
});
