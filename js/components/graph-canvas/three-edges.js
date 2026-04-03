import * as THREE from "three";
import { DATA_COLORS } from "../../core/constants.js";

/* ── Edge color by type ── */

const EDGE_COLOR_MAP = {
	linked_to: 0x00f5ff,
	amends: 0x7b61ff,
	contradicts: 0xff3333,
	promotes_to: 0x7b61ff,
	answers: 0xffd93d,
	decomposes_to: 0xffd93d,
	clusters_with: 0xffffff,
	preceded_by: 0x484f58,
	triggers: 0xff9f1c,
};

const getEdgeColor = (edgeType) => EDGE_COLOR_MAP[edgeType] ?? 0x484f58;

/* ── Create a line for an edge ── */

export const createEdgeLine = (edge, sourcePos, targetPos) => {
	const color = getEdgeColor(edge.type);

	const points = [sourcePos.clone(), targetPos.clone()];
	const geometry = new THREE.BufferGeometry().setFromPoints(points);

	const isDashed = edge.type === "amends" || edge.type === "contradicts";

	let material;
	if (isDashed) {
		material = new THREE.LineDashedMaterial({
			color,
			transparent: true,
			opacity: edge.type === "contradicts" ? 0.9 : 0.6,
			dashSize: 3,
			gapSize: 2,
			linewidth: 2,
		});
	} else {
		material = new THREE.LineBasicMaterial({
			color,
			transparent: true,
			opacity: edge.type === "preceded_by" ? 0.3 : 0.7,
			linewidth: 2,
		});
	}

	const line = new THREE.Line(geometry, material);
	if (isDashed) line.computeLineDistances();

	line.userData = {
		edgeId: edge.id,
		edgeType: edge.type,
		sourceId: edge.source,
		targetId: edge.target,
	};

	// Ensure edges render behind nodes
	line.renderOrder = -1;

	return line;
};

/* ── Update edge line positions ── */

export const updateEdgeLine = (line, sourcePos, targetPos) => {
	const positions = line.geometry.attributes.position;
	if (!positions) return;

	positions.setXYZ(0, sourcePos.x, sourcePos.y, sourcePos.z);
	positions.setXYZ(1, targetPos.x, targetPos.y, targetPos.z);
	positions.needsUpdate = true;

	if (line.isLine && line.material.isLineDashedMaterial) {
		line.computeLineDistances();
	}
};

/* ── Create particle trail along edge (for active retrieval) ── */

export const createEdgeParticles = (
	sourcePos,
	targetPos,
	color = DATA_COLORS.RETRIEVAL,
) => {
	const count = 12;
	const positions = new Float32Array(count * 3);
	const sizes = new Float32Array(count);

	for (let i = 0; i < count; i++) {
		const t = i / count;
		positions[i * 3] = THREE.MathUtils.lerp(sourcePos.x, targetPos.x, t);
		positions[i * 3 + 1] = THREE.MathUtils.lerp(sourcePos.y, targetPos.y, t);
		positions[i * 3 + 2] = THREE.MathUtils.lerp(sourcePos.z, targetPos.z, t);
		sizes[i] = 0.3 + Math.random() * 0.3;
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

	const material = new THREE.PointsMaterial({
		color,
		size: 0.5,
		transparent: true,
		opacity: 0.8,
		sizeAttenuation: true,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
	});

	const points = new THREE.Points(geometry, material);
	points.userData = { isRetrievalParticle: true, progress: 0 };
	return points;
};

/* ── Animate particles flowing along edge ── */

export const animateEdgeParticles = (
	particles,
	sourcePos,
	targetPos,
	delta,
) => {
	if (!particles?.userData) return;

	particles.userData.progress = (particles.userData.progress + delta * 0.8) % 1;
	const positions = particles.geometry.attributes.position;
	if (!positions) return;

	const count = positions.count;
	const baseProgress = particles.userData.progress;

	for (let i = 0; i < count; i++) {
		const t = (baseProgress + i / count) % 1;
		positions.setXYZ(
			i,
			THREE.MathUtils.lerp(sourcePos.x, targetPos.x, t),
			THREE.MathUtils.lerp(sourcePos.y, targetPos.y, t),
			THREE.MathUtils.lerp(sourcePos.z, targetPos.z, t),
		);
	}

	positions.needsUpdate = true;
};

/* ── Contradiction pulse effect ── */

export const updateContradictionPulse = (line, time) => {
	if (!line?.material || line.userData?.edgeType !== "contradicts") return;
	// Oscillate opacity 0.3-0.8 at 1.5s period
	line.material.opacity =
		0.3 + 0.5 * (0.5 + 0.5 * Math.sin(time * ((2 * Math.PI) / 1.5)));
};

/* ── Highlight edge on selection ── */

export const setEdgeSelected = (line, selected) => {
	if (!line?.material) return;
	if (selected) {
		line.material.opacity = 1.0;
		if (line.material.color) line.material.color.setHex(0xffffff);
	} else {
		const color = getEdgeColor(line.userData?.edgeType);
		line.material.opacity =
			line.userData?.edgeType === "preceded_by" ? 0.2 : 0.4;
		if (line.material.color) line.material.color.setHex(color);
	}
};
