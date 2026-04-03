import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

import { BLOOM, CAMERA, FOG } from "../core/constants.js";
import { EVENTS } from "../core/event-constants.js";
import { publish, subscribe } from "../core/pan.js";
import { graphStore } from "../store/graph-store.js";
import { uiStore } from "../store/ui-store.js";
import {
	animateAmbientParticles,
	createAmbientParticles,
	createNebulaClouds,
	createStarField,
	updateAmbientBreathing,
} from "./graph-canvas/three-atmosphere.js";
import {
	createEdgeLine,
	setEdgeSelected,
	updateContradictionPulse,
} from "./graph-canvas/three-edges.js";
import {
	createNodeMesh,
	createSelectionRing,
	updateClusterShell,
	updateNodeMesh,
} from "./graph-canvas/three-nodes.js";

class GraphCanvas extends HTMLElement {
	#dispose = [];
	#renderer = null;
	#scene = null;
	#camera = null;
	#controls = null;
	#composer = null;
	#clock = null;
	#animationId = null;
	#containerEl = null;

	/* ── Scene groups ── */
	#nodeGroup = null;
	#edgeGroup = null;
	#atmosphereGroup = null;
	#ambientLight = null;
	#ambientParticles = null;
	#selectionRing = null;

	/* ── State ── */
	#nodeMeshMap = new Map(); // nodeId → THREE.Mesh
	#edgeLineMap = new Map(); // edgeId → THREE.Line
	#selectedNodeIds = [];
	#selectedEdgeId = null;
	#activeTool = "select";
	#hoveredNodeId = null;
	#hoverTimeout = null;
	#introComplete = false;
	#introStartTime = 0;
	#raycaster = new THREE.Raycaster();
	#mouse = new THREE.Vector2();
	#focusTarget = null;
	#focusProgress = 0;

	connectedCallback() {
		this.innerHTML = `
      <section class="mg-panel mg-graph-panel">
        <div class="content mg-graph-content">
          <div class="three-canvas-container" data-role="three-container" tabindex="0"></div>
        </div>
      </section>
    `;

		this.#containerEl = this.querySelector('[data-role="three-container"]');
		if (!this.#containerEl) return;

		try {
			this.#initThree();
			this.#initPostProcessing();
			this.#initAtmosphere();
			this.#initControls();
			this.#bindEvents();
			this.#bindSubscriptions();
			this.#startIntroSwoop();
			this.#animate();
		} catch (error) {
			console.error("WebGL initialization failed:", error);
			this.#containerEl.innerHTML = `
        <div class="webgl-error-overlay">
          Your browser doesn't support WebGL. Try Chrome or Firefox.
        </div>
      `;
		}
	}

	disconnectedCallback() {
		this.#dispose.forEach((run) => run());
		this.#dispose = [];
		if (this.#animationId) cancelAnimationFrame(this.#animationId);
		this.#renderer?.dispose();
		this.#controls?.dispose();
	}

	/* ── Three.js initialization ── */

	#initThree() {
		this.#clock = new THREE.Clock();

		// Renderer
		this.#renderer = new THREE.WebGLRenderer({
			antialias: true,
			alpha: false,
			powerPreference: "high-performance",
		});
		this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.#renderer.setClearColor(FOG.COLOR, 1);
		this.#renderer.toneMapping = THREE.ACESFilmicToneMapping;
		this.#renderer.toneMappingExposure = 1.2;
		this.#containerEl.appendChild(this.#renderer.domElement);

		// Scene
		this.#scene = new THREE.Scene();
		this.#scene.fog = new THREE.FogExp2(FOG.COLOR, FOG.DENSITY);

		// Camera
		const aspect =
			this.#containerEl.clientWidth /
			Math.max(this.#containerEl.clientHeight, 1);
		this.#camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 5000);
		this.#camera.position.set(...CAMERA.INTRO_POSITION);
		this.#camera.lookAt(...CAMERA.HOME_LOOK_AT);

		// Lights
		this.#ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
		this.#scene.add(this.#ambientLight);

		const directional = new THREE.DirectionalLight(0xffffff, 0.4);
		directional.position.set(50, 100, 100);
		this.#scene.add(directional);

		const backLight = new THREE.DirectionalLight(0x7b61ff, 0.15);
		backLight.position.set(-50, -50, -200);
		this.#scene.add(backLight);

		// Groups
		this.#nodeGroup = new THREE.Group();
		this.#edgeGroup = new THREE.Group();
		this.#atmosphereGroup = new THREE.Group();
		this.#scene.add(this.#edgeGroup);
		this.#scene.add(this.#nodeGroup);
		this.#scene.add(this.#atmosphereGroup);

		this.#handleResize();
	}

	#initPostProcessing() {
		const size = new THREE.Vector2(
			this.#containerEl.clientWidth,
			Math.max(this.#containerEl.clientHeight, 1),
		);

		this.#composer = new EffectComposer(this.#renderer);
		this.#composer.addPass(new RenderPass(this.#scene, this.#camera));

		const bloomPass = new UnrealBloomPass(
			size,
			BLOOM.STRENGTH,
			BLOOM.RADIUS,
			BLOOM.THRESHOLD,
		);
		this.#composer.addPass(bloomPass);
	}

	#initAtmosphere() {
		this.#ambientParticles = createAmbientParticles();
		this.#atmosphereGroup.add(this.#ambientParticles);
		this.#atmosphereGroup.add(createStarField());
		this.#atmosphereGroup.add(createNebulaClouds());
	}

	#initControls() {
		this.#controls = new OrbitControls(this.#camera, this.#containerEl);
		this.#controls.target.set(...CAMERA.HOME_LOOK_AT);
		this.#controls.enableDamping = true;
		this.#controls.dampingFactor = 0.08;
		this.#controls.minDistance = 20;
		this.#controls.maxDistance = 1500;
		this.#controls.maxPolarAngle = Math.PI * 0.85;
		this.#controls.enablePan = true;
		this.#controls.panSpeed = 0.8;
		this.#controls.rotateSpeed = 0.6;

		// Enable orbit only for pan/orbit tool or right-click
		this.#syncControlsForTool();
	}

	/* ── Event binding ── */

	#bindEvents() {
		const onResize = () => this.#handleResize();
		window.addEventListener("resize", onResize);
		this.#dispose.push(() => window.removeEventListener("resize", onResize));

		this.#containerEl.addEventListener("pointerdown", (e) =>
			this.#onPointerDown(e),
		);
		this.#containerEl.addEventListener("pointermove", (e) =>
			this.#onPointerMove(e),
		);
		this.#containerEl.addEventListener("pointerup", (e) =>
			this.#onPointerUp(e),
		);
		this.#containerEl.addEventListener("dblclick", (e) =>
			this.#onDoubleClick(e),
		);
		this.#containerEl.addEventListener("keydown", (e) => this.#onKeyDown(e));
		this.#containerEl.addEventListener("contextmenu", (e) =>
			e.preventDefault(),
		);
	}

	#bindSubscriptions() {
		this.#dispose.push(
			subscribe(EVENTS.GRAPH_DOCUMENT_LOADED, () => {
				this.#rebuildScene();
			}),
		);

		this.#dispose.push(
			subscribe(EVENTS.GRAPH_DOCUMENT_CHANGED, ({ payload }) => {
				if (payload?.reason === "viewport" || payload?.reason === "selection")
					return;
				this.#rebuildScene();
			}),
		);

		this.#dispose.push(
			subscribe(EVENTS.GRAPH_SELECTION_SET, ({ payload }) => {
				this.#selectedNodeIds = Array.isArray(payload?.nodeIds)
					? [...payload.nodeIds]
					: payload?.nodeId
						? [payload.nodeId]
						: [];
				this.#updateSelectionVisuals();
				if (this.#selectedNodeIds.length === 1) {
					this.#focusOnNode(this.#selectedNodeIds[0]);
				}
			}),
		);

		this.#dispose.push(
			subscribe(EVENTS.GRAPH_SELECTION_CLEARED, () => {
				this.#selectedNodeIds = [];
				this.#updateSelectionVisuals();
			}),
		);

		this.#dispose.push(
			subscribe(EVENTS.GRAPH_EDGE_SELECTED, ({ payload }) => {
				this.#selectedEdgeId = payload?.edgeId ?? null;
				this.#updateEdgeSelectionVisuals();
			}),
		);

		this.#dispose.push(
			subscribe(EVENTS.GRAPH_EDGE_SELECTION_CLEARED, () => {
				this.#selectedEdgeId = null;
				this.#updateEdgeSelectionVisuals();
			}),
		);

		this.#dispose.push(
			subscribe(EVENTS.TOOLBAR_TOOL_CHANGED, ({ payload }) => {
				this.#activeTool = payload?.tool ?? "select";
				this.#syncControlsForTool();
			}),
		);

		this.#dispose.push(
			subscribe(EVENTS.CAR_CANVAS_CAMERA_HOME, () => {
				this.#animateCameraToHome();
			}),
		);

		this.#dispose.push(
			subscribe(EVENTS.CAR_CANVAS_CAMERA_FOCUS, ({ payload }) => {
				if (payload?.nodeId) this.#focusOnNode(payload.nodeId);
			}),
		);
	}

	/* ── Resize ── */

	#handleResize() {
		if (!this.#containerEl || !this.#renderer || !this.#camera) return;

		const width = this.#containerEl.clientWidth;
		const height = Math.max(this.#containerEl.clientHeight, 1);

		this.#camera.aspect = width / height;
		this.#camera.updateProjectionMatrix();
		this.#renderer.setSize(width, height);
		this.#composer?.setSize(width, height);
	}

	/* ── Scene rebuild ── */

	#rebuildScene() {
		// Clear existing nodes and edges
		this.#nodeGroup.clear();
		this.#edgeGroup.clear();
		this.#nodeMeshMap.clear();
		this.#edgeLineMap.clear();
		this.#selectionRing = null;

		const doc = graphStore.getDocument();
		if (!doc) return;

		const nodes = doc.nodes ?? [];
		const edges = doc.edges ?? [];

		// Create node meshes
		for (const node of nodes) {
			const mesh = createNodeMesh(node);
			this.#nodeGroup.add(mesh);
			this.#nodeMeshMap.set(node.id, mesh);
		}

		// Update cluster shells to enclose members
		for (const node of nodes) {
			if (node.type === "cluster") {
				const memberIds = node.data?.member_ids ?? [];
				const memberPositions = memberIds
					.map((id) => this.#nodeMeshMap.get(id)?.position)
					.filter(Boolean);
				const shell = this.#nodeMeshMap.get(node.id);
				if (shell && memberPositions.length) {
					updateClusterShell(shell, memberPositions);
				}
			}
		}

		// Create edge lines
		for (const edge of edges) {
			const sourceMesh = this.#nodeMeshMap.get(edge.source);
			const targetMesh = this.#nodeMeshMap.get(edge.target);
			if (!sourceMesh || !targetMesh) continue;

			const line = createEdgeLine(
				edge,
				sourceMesh.position,
				targetMesh.position,
			);
			this.#edgeGroup.add(line);
			this.#edgeLineMap.set(edge.id, line);
		}

		this.#updateSelectionVisuals();
		this.#updateEdgeSelectionVisuals();

		// Show empty state if no nodes
		this.#updateCanvasOverlay(nodes.length);
	}

	/* ── Canvas overlay (empty/loading states) ── */

	#updateCanvasOverlay(nodeCount) {
		const existing = this.#containerEl.querySelector(".canvas-empty-state");
		if (existing) existing.remove();

		if (nodeCount === 0) {
			const overlay = document.createElement("div");
			overlay.className = "canvas-empty-state";
			overlay.textContent = "This brain is empty. Add a memory to begin.";
			this.#containerEl.appendChild(overlay);
		}
	}

	/* ── Selection visuals ── */

	#updateSelectionVisuals() {
		// Remove old selection ring
		if (this.#selectionRing) {
			this.#selectionRing.parent?.remove(this.#selectionRing);
			this.#selectionRing = null;
		}

		const selectedSet = new Set(this.#selectedNodeIds);
		const hasSelection = selectedSet.size > 0;

		for (const [nodeId, mesh] of this.#nodeMeshMap) {
			const node = graphStore.getNode(nodeId);
			if (!node) continue;

			const isSelected = selectedSet.has(nodeId);
			updateNodeMesh(mesh, node, {
				selected: isSelected,
				relevance: 1.0,
				dimmed: hasSelection && !isSelected,
			});
		}

		// Add selection ring to first selected node
		if (this.#selectedNodeIds.length > 0) {
			const primaryMesh = this.#nodeMeshMap.get(this.#selectedNodeIds[0]);
			if (primaryMesh) {
				this.#selectionRing = createSelectionRing(primaryMesh);
				primaryMesh.add(this.#selectionRing);
			}
		}
	}

	#updateEdgeSelectionVisuals() {
		for (const [edgeId, line] of this.#edgeLineMap) {
			setEdgeSelected(line, edgeId === this.#selectedEdgeId);
		}
	}

	/* ── Camera ── */

	#startIntroSwoop() {
		this.#introComplete = false;
		this.#introStartTime = this.#clock.getElapsedTime();
		this.#camera.position.set(...CAMERA.INTRO_POSITION);
	}

	#updateIntroSwoop(elapsed) {
		if (this.#introComplete) return;

		const t = Math.min(
			(elapsed - this.#introStartTime) / CAMERA.SWOOP_DURATION,
			1,
		);
		if (t >= 1) {
			this.#introComplete = true;
			this.#camera.position.set(...CAMERA.HOME_POSITION);
			this.#controls.target.set(...CAMERA.HOME_LOOK_AT);
			this.#controls.update();
			return;
		}

		// EaseInOutCubic
		const ease = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

		this.#camera.position.lerpVectors(
			new THREE.Vector3(...CAMERA.INTRO_POSITION),
			new THREE.Vector3(...CAMERA.HOME_POSITION),
			ease,
		);

		this.#controls.target.lerpVectors(
			new THREE.Vector3(...CAMERA.HOME_LOOK_AT),
			new THREE.Vector3(...CAMERA.HOME_LOOK_AT),
			ease,
		);
	}

	#focusOnNode(nodeId) {
		const mesh = this.#nodeMeshMap.get(nodeId);
		if (!mesh) return;

		this.#focusTarget = mesh.position.clone();
		this.#focusProgress = 0;
	}

	#updateCameraFocus(delta) {
		if (!this.#focusTarget || this.#focusProgress >= 1) return;

		this.#focusProgress = Math.min(
			this.#focusProgress + delta / CAMERA.FOCUS_DURATION,
			1,
		);

		// EaseInOutCubic
		const t = this.#focusProgress;
		const ease = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

		this.#controls.target.lerp(this.#focusTarget, ease);

		if (this.#focusProgress >= 1) {
			this.#focusTarget = null;
		}
	}

	#animateCameraToHome() {
		this.#focusTarget = new THREE.Vector3(...CAMERA.HOME_LOOK_AT);
		this.#focusProgress = 0;
	}

	/* ── Pointer events ── */

	#updateMouse(event) {
		const rect = this.#containerEl.getBoundingClientRect();
		this.#mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		this.#mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
	}

	#raycastNodes() {
		this.#raycaster.setFromCamera(this.#mouse, this.#camera);
		const meshes = [];
		this.#nodeMeshMap.forEach((mesh) => meshes.push(mesh));
		const intersects = this.#raycaster.intersectObjects(meshes, true);
		if (intersects.length === 0) return null;

		// Walk up to find userData.nodeId
		let obj = intersects[0].object;
		while (obj && !obj.userData?.nodeId) obj = obj.parent;
		return obj?.userData?.nodeId ?? null;
	}

	#onPointerDown(event) {
		if (event.button !== 0) return;
		this.#containerEl.focus();
		this.#updateMouse(event);

		const nodeId = this.#raycastNodes();

		if (nodeId) {
			event.stopPropagation();

			if (this.#activeTool === "select" || this.#activeTool === "pan") {
				publish(EVENTS.GRAPH_NODE_SELECT_REQUESTED, {
					nodeId,
					additive: event.shiftKey,
					toggle: event.shiftKey,
					origin: "graph-canvas",
				});
			}
			return;
		}

		// Click on empty space clears selection
		if (this.#activeTool === "select" && !event.shiftKey) {
			publish(EVENTS.GRAPH_SELECTION_CLEAR_REQUESTED, {
				origin: "graph-canvas",
			});
		}
	}

	#onPointerMove(event) {
		this.#updateMouse(event);

		// Hover detection with 300ms delay
		const nodeId = this.#raycastNodes();
		if (nodeId !== this.#hoveredNodeId) {
			if (this.#hoverTimeout) clearTimeout(this.#hoverTimeout);
			this.#hoveredNodeId = nodeId;

			if (nodeId) {
				this.#hoverTimeout = setTimeout(() => {
					publish(EVENTS.CAR_CANVAS_NODE_HOVERED, {
						nodeId,
						origin: "graph-canvas",
					});
				}, 300);
			} else {
				publish(EVENTS.CAR_CANVAS_NODE_UNHOVERED, { origin: "graph-canvas" });
			}
		}
	}

	#onPointerUp(_event) {
		// OrbitControls handles pointer up
	}

	#onDoubleClick(event) {
		this.#updateMouse(event);
		const nodeId = this.#raycastNodes();
		if (nodeId) {
			publish(EVENTS.GRAPH_NODE_SELECT_REQUESTED, {
				nodeId,
				origin: "graph-canvas",
			});
			publish(EVENTS.CAR_CANVAS_CAMERA_FOCUS, {
				nodeId,
				origin: "graph-canvas",
			});
		} else {
			// Double-click empty = home
			this.#animateCameraToHome();
		}
	}

	#onKeyDown(event) {
		if (event.key === "Escape") {
			event.preventDefault();
			if (this.#activeTool !== "select") {
				uiStore.setTool("select");
			} else {
				publish(EVENTS.GRAPH_SELECTION_CLEAR_REQUESTED, {
					origin: "graph-canvas",
				});
			}
			return;
		}

		if (event.key === "h" || event.key === "H") {
			this.#animateCameraToHome();
			return;
		}

		const isUndo =
			(event.ctrlKey || event.metaKey) &&
			!event.shiftKey &&
			event.key.toLowerCase() === "z";
		const isRedo =
			(event.ctrlKey || event.metaKey) &&
			((event.shiftKey && event.key.toLowerCase() === "z") ||
				event.key.toLowerCase() === "y");

		if (isUndo) {
			event.preventDefault();
			if (graphStore.canUndo()) {
				publish(EVENTS.GRAPH_DOCUMENT_UNDO_REQUESTED, {
					origin: "graph-canvas",
				});
			}
			return;
		}

		if (isRedo) {
			event.preventDefault();
			if (graphStore.canRedo()) {
				publish(EVENTS.GRAPH_DOCUMENT_REDO_REQUESTED, {
					origin: "graph-canvas",
				});
			}
			return;
		}

		if (
			(event.key === "Delete" || event.key === "Backspace") &&
			this.#selectedNodeIds.length
		) {
			event.preventDefault();
			publish(EVENTS.GRAPH_NODE_DELETE_REQUESTED, {
				nodeIds: [...this.#selectedNodeIds],
				origin: "graph-canvas",
			});
			return;
		}

		// Tool shortcuts
		const toolShortcuts = {
			v: "select",
			h: "pan",
			c: "create:chunk",
			l: "connect",
			q: "create:question",
			t: "create:trigger",
		};
		const tool = toolShortcuts[event.key.toLowerCase()];
		if (tool && !event.ctrlKey && !event.metaKey) {
			uiStore.setTool(tool);
		}
	}

	/* ── Controls sync ── */

	#syncControlsForTool() {
		if (!this.#controls) return;
		const orbiting = this.#activeTool === "pan";
		this.#controls.enableRotate = orbiting;
		this.#controls.enablePan = orbiting;
		// Zoom always enabled via scroll
		this.#controls.enableZoom = true;
		this.#containerEl?.classList.toggle("is-orbiting", orbiting);
	}

	/* ── Animation loop ── */

	#animate() {
		this.#animationId = requestAnimationFrame(() => this.#animate());

		const delta = this.#clock.getDelta();
		const elapsed = this.#clock.getElapsedTime();

		// Intro swoop
		if (!this.#introComplete) {
			this.#updateIntroSwoop(elapsed);
		}

		// Camera focus lerp
		this.#updateCameraFocus(delta);

		// Controls update (damping)
		this.#controls?.update();

		// Ambient breathing
		updateAmbientBreathing(this.#ambientLight, elapsed);

		// Animate ambient particles
		animateAmbientParticles(this.#ambientParticles, delta);

		// Rotate T3/pattern nodes
		this.#nodeGroup?.children.forEach((mesh) => {
			if (mesh.userData?.shouldRotate) {
				mesh.rotation.y += delta * 0.3;
				mesh.rotation.x += delta * 0.1;
			}
		});

		// Contradiction pulse
		this.#edgeLineMap.forEach((line) => {
			updateContradictionPulse(line, elapsed);
		});

		// Render
		if (this.#composer) {
			this.#composer.render();
		} else {
			this.#renderer?.render(this.#scene, this.#camera);
		}
	}
}

customElements.define("graph-canvas", GraphCanvas);
