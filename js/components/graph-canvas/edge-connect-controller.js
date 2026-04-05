import { NODE_SIZE_BY_TYPE } from "../../core/constants.js";

export const createEdgeConnectController = ({
  workspaceEl,
  edgeChooserEl,
  screenToWorld,
  getNodeById,
  getEdgeCreationPresets,
  inferDefaultEdgeType,
  formatEdgeLabel,
  publishEdgeSelectionCleared,
  publishEdgeCreateRequested,
  onVisualStateChanged
}) => {
  let connectSourceNodeId = null;
  let connectDragState = null;
  let edgeDraftEl = null;
  let edgeChooserState = null;

  const findNodeIdAtClientPoint = (clientX, clientY) => {
    const target = document.elementFromPoint(clientX, clientY);
    const nodeEl = target?.closest("[data-node-id]");
    return nodeEl?.dataset?.nodeId ?? null;
  };

  const connectionPointForNode = (node) => {
    const size = NODE_SIZE_BY_TYPE[node.type] ?? NODE_SIZE_BY_TYPE.note;
    const x = Number(node.position?.x ?? 0) + size.width - 10;
    const y = Number(node.position?.y ?? 0) + 16;
    return { x, y };
  };

  const hideConnectDraft = () => {
    if (!edgeDraftEl) return;
    edgeDraftEl.hidden = true;
    edgeDraftEl.setAttribute("d", "");
  };

  const renderConnectDraft = () => {
    if (!edgeDraftEl) return;
    if (!connectDragState) {
      hideConnectDraft();
      return;
    }

    const { sourcePoint, pointerWorld } = connectDragState;
    edgeDraftEl.hidden = false;
    edgeDraftEl.setAttribute("d", `M ${sourcePoint.x} ${sourcePoint.y} L ${pointerWorld.x} ${pointerWorld.y}`);
  };

  const closeEdgeChooser = () => {
    if (!edgeChooserEl) return;
    edgeChooserState = null;
    edgeChooserEl.hidden = true;
    edgeChooserEl.innerHTML = "";
  };

  const renderEdgeChooser = () => {
    const state = edgeChooserState;
    if (!state || !edgeChooserEl) return;

    const selectedPreset = state.presets.find((preset) => preset.type === state.selectedType) ?? state.presets[0];
    const optionsMarkup = state.presets
      .map((preset) => {
        const disabled = preset.valid ? "" : "disabled";
        const suffix = preset.valid ? "" : " (invalid)";
        return `<option value="${preset.type}" ${preset.type === state.selectedType ? "selected" : ""} ${disabled}>${preset.type}${suffix}</option>`;
      })
      .join("");

    edgeChooserEl.innerHTML = `
      <div class="graph-edge-chooser-card">
        <h4>Create Edge</h4>
        <p class="graph-edge-chooser-meta">${state.sourceNodeLabel} -> ${state.targetNodeLabel}</p>
        <label class="graph-edge-chooser-field">
          <span>Edge Type</span>
          <select data-field="edge-chooser-type">${optionsMarkup}</select>
        </label>
        <p class="graph-edge-chooser-help">${selectedPreset?.description ?? ""}</p>
        <p class="graph-edge-chooser-help graph-edge-chooser-reason">${selectedPreset?.reason ?? ""}</p>
        <p class="graph-edge-chooser-help">
          Contract: ${selectedPreset?.contract?.sourcePort ?? "-"} -> ${selectedPreset?.contract?.targetPort ?? "-"} (${selectedPreset?.contract?.payloadType ?? "none"})
        </p>
        <div class="graph-edge-chooser-actions">
          <button type="button" data-action="edge-chooser-connect">Connect</button>
          <button type="button" data-action="edge-chooser-cancel">Cancel</button>
        </div>
      </div>
    `;

    edgeChooserEl.querySelector('[data-field="edge-chooser-type"]')?.addEventListener("change", (event) => {
      if (!edgeChooserState) return;
      edgeChooserState.selectedType = event.target.value;
      renderEdgeChooser();
    });

    edgeChooserEl.querySelector('[data-action="edge-chooser-cancel"]')?.addEventListener("click", () => {
      closeEdgeChooser();
    });

    edgeChooserEl.querySelector('[data-action="edge-chooser-connect"]')?.addEventListener("click", () => {
      const current = edgeChooserState;
      if (!current) return;
      const selected = current.presets.find((preset) => preset.type === current.selectedType);
      if (!selected?.valid) return;

      publishEdgeCreateRequested({
        source: current.sourceNodeId,
        target: current.targetNodeId,
        type: selected.type,
        label: formatEdgeLabel(selected.type),
        selectAfterCreate: true
      });
      closeEdgeChooser();
    });
  };

  const openEdgeChooser = (sourceNodeId, targetNodeId, clientX = null, clientY = null) => {
    const sourceNode = getNodeById(sourceNodeId);
    const targetNode = getNodeById(targetNodeId);
    if (!sourceNode || !targetNode || !edgeChooserEl || !workspaceEl) return;

    const presets = getEdgeCreationPresets(sourceNode, targetNode);
    const validPresets = presets.filter((preset) => preset.valid);
    const defaultType = inferDefaultEdgeType(sourceNode, targetNode);
    const selectedType = validPresets.some((preset) => preset.type === defaultType)
      ? defaultType
      : validPresets[0]?.type ?? defaultType;

    edgeChooserState = {
      sourceNodeId,
      targetNodeId,
      sourceNodeLabel: sourceNode.label,
      targetNodeLabel: targetNode.label,
      presets,
      selectedType
    };

    renderEdgeChooser();

    const workspaceRect = workspaceEl.getBoundingClientRect();
    const offsetX = Number.isFinite(clientX) ? clientX - workspaceRect.left : workspaceRect.width * 0.5;
    const offsetY = Number.isFinite(clientY) ? clientY - workspaceRect.top : workspaceRect.height * 0.5;
    const width = edgeChooserEl.offsetWidth || 320;
    const height = edgeChooserEl.offsetHeight || 230;
    const left = Math.min(Math.max(12, offsetX + 10), workspaceRect.width - width - 12);
    const top = Math.min(Math.max(12, offsetY + 10), workspaceRect.height - height - 12);
    edgeChooserEl.style.left = `${Math.round(left)}px`;
    edgeChooserEl.style.top = `${Math.round(top)}px`;

    edgeChooserEl.hidden = false;
    edgeChooserEl.querySelector('[data-field="edge-chooser-type"]')?.focus();
  };

  const createDefaultEdge = (sourceNodeId, targetNodeId) => {
    const sourceNode = getNodeById(sourceNodeId);
    const targetNode = getNodeById(targetNodeId);
    if (!sourceNode || !targetNode) return false;

    const presets = getEdgeCreationPresets(sourceNode, targetNode);
    const validPresets = presets.filter((preset) => preset.valid);
    const defaultType = inferDefaultEdgeType(sourceNode, targetNode);
    const selectedPreset =
      validPresets.find((preset) => preset.type === defaultType) ?? validPresets[0] ?? null;

    if (!selectedPreset) return false;

    publishEdgeCreateRequested({
      source: sourceNodeId,
      target: targetNodeId,
      type: selectedPreset.type,
      label: formatEdgeLabel(selectedPreset.type),
      selectAfterCreate: true
    });
    return true;
  };

  const cancelConnectDrag = () => {
    connectDragState = null;
    connectSourceNodeId = null;
    hideConnectDraft();
    onVisualStateChanged();
  };

  const commitConnectDrag = (pointerEvent = null) => {
    const state = connectDragState;
    if (!state) return;

    const targetNodeId = state.hoveredNodeId;
    if (targetNodeId && targetNodeId !== state.sourceNodeId) {
      if (state.autoCreateOnDrop) {
        const created = createDefaultEdge(state.sourceNodeId, targetNodeId);
        if (!created) {
          openEdgeChooser(
            state.sourceNodeId,
            targetNodeId,
            pointerEvent?.clientX ?? null,
            pointerEvent?.clientY ?? null
          );
        }
      } else {
        openEdgeChooser(
          state.sourceNodeId,
          targetNodeId,
          pointerEvent?.clientX ?? null,
          pointerEvent?.clientY ?? null
        );
      }
    }

    cancelConnectDrag();
  };

  const beginConnectDrag = (event, node, options = {}) => {
    if (event.button !== 0) return false;
    event.preventDefault();
    event.stopPropagation();
    workspaceEl?.focus();
    closeEdgeChooser();

    const sourcePoint = connectionPointForNode(node);
    const pointerWorld = screenToWorld(event.clientX, event.clientY);
    connectSourceNodeId = node.id;
    connectDragState = {
      pointerId: event.pointerId,
      sourceNodeId: node.id,
      sourcePoint,
      pointerWorld,
      hoveredNodeId: null,
      captureEl: options.captureEl ?? event.currentTarget,
      autoCreateOnDrop: options.autoCreateOnDrop === true
    };

    connectDragState.captureEl?.setPointerCapture?.(event.pointerId);
    publishEdgeSelectionCleared();
    renderConnectDraft();
    onVisualStateChanged();
    return true;
  };

  const onConnectHandlePointerDown = (event, node) => beginConnectDrag(event, node, { autoCreateOnDrop: false });

  const onNodeModifierPointerDown = (event, node) =>
    beginConnectDrag(event, node, {
      autoCreateOnDrop: true,
      captureEl: workspaceEl
    });

  const handlePointerMove = (event) => {
    if (!connectDragState || event.pointerId !== connectDragState.pointerId) return false;

    const worldPoint = screenToWorld(event.clientX, event.clientY);
    connectDragState.pointerWorld = worldPoint;
    const hoveredNodeId = findNodeIdAtClientPoint(event.clientX, event.clientY);
    connectDragState.hoveredNodeId =
      hoveredNodeId && hoveredNodeId !== connectDragState.sourceNodeId ? hoveredNodeId : null;
    renderConnectDraft();
    onVisualStateChanged();
    return true;
  };

  const handlePointerUp = (event) => {
    if (!connectDragState || event.pointerId !== connectDragState.pointerId) return false;

    connectDragState.captureEl?.releasePointerCapture?.(event.pointerId);
    commitConnectDrag(event);
    return true;
  };

  const refreshTransientUi = () => {
    renderConnectDraft();
    if (edgeChooserState) {
      renderEdgeChooser();
    }
  };

  return {
    setEdgeDraftElement(nextEdgeDraftEl) {
      edgeDraftEl = nextEdgeDraftEl;
      renderConnectDraft();
    },
    isConnecting: () => Boolean(connectDragState),
    hasOpenEdgeChooser: () => Boolean(edgeChooserState),
    getConnectSourceNodeId: () => connectSourceNodeId,
    getHoveredNodeId: () => connectDragState?.hoveredNodeId ?? null,
    closeEdgeChooser,
    cancelConnectDrag,
    refreshTransientUi,
    onConnectHandlePointerDown,
    onNodeModifierPointerDown,
    handlePointerMove,
    handlePointerUp
  };
};
