import * as THREE from "three";
import {
	DATA_COLORS,
	DEPTH_PLANES,
	NODE_GEOMETRY,
	TIER_COLORS,
} from "../../core/constants.js";

/* ── 3D node geometries per type ── */

const geometryCache = {};

const getGeometry = (type, tier) => {
	const key = type === "chunk" ? `chunk_t${tier}` : type;
	if (geometryCache[key]) return geometryCache[key];

	let geometry;
	switch (key) {
		case "chunk_t1":
			geometry = new THREE.SphereGeometry(
				NODE_GEOMETRY.CHUNK_T1.radius,
				NODE_GEOMETRY.CHUNK_T1.segments,
				NODE_GEOMETRY.CHUNK_T1.segments,
			);
			break;
		case "chunk_t2":
			geometry = new THREE.IcosahedronGeometry(
				NODE_GEOMETRY.CHUNK_T2.radius,
				NODE_GEOMETRY.CHUNK_T2.detail,
			);
			break;
		case "chunk_t3":
			geometry = new THREE.OctahedronGeometry(NODE_GEOMETRY.CHUNK_T3.radius);
			break;
		case "question":
			geometry = new THREE.TetrahedronGeometry(NODE_GEOMETRY.QUESTION.radius);
			break;
		case "trigger": {
			const r = NODE_GEOMETRY.TRIGGER.radius;
			const top = new THREE.ConeGeometry(r, r * 1.2, 4);
			top.translate(0, r * 0.6, 0);
			const bottom = new THREE.ConeGeometry(r, r * 1.2, 4);
			bottom.rotateX(Math.PI);
			bottom.translate(0, -r * 0.6, 0);
			geometry = new THREE.BufferGeometry();
			geometry.copy(mergeBufferGeometries([top, bottom]));
			break;
		}
		case "pattern":
			geometry = new THREE.OctahedronGeometry(NODE_GEOMETRY.CHUNK_T3.radius);
			break;
		default:
			geometry = new THREE.SphereGeometry(1, 16, 16);
	}

	geometryCache[key] = geometry;
	return geometry;
};

function mergeBufferGeometries(geometries) {
	const merged = new THREE.BufferGeometry();
	const positions = [];
	const normals = [];
	let indexOffset = 0;
	const indices = [];

	for (const geom of geometries) {
		const pos = geom.getAttribute("position");
		const norm = geom.getAttribute("normal");
		const idx = geom.getIndex();

		for (let i = 0; i < pos.count; i++) {
			positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
			if (norm) normals.push(norm.getX(i), norm.getY(i), norm.getZ(i));
		}

		if (idx) {
			for (let i = 0; i < idx.count; i++) {
				indices.push(idx.array[i] + indexOffset);
			}
		}

		indexOffset += pos.count;
	}

	merged.setAttribute(
		"position",
		new THREE.Float32BufferAttribute(positions, 3),
	);
	if (normals.length)
		merged.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
	if (indices.length) merged.setIndex(indices);
	merged.computeVertexNormals();
	return merged;
}

/* ── Color for node ── */

export const getNodeColor = (node) => {
	if (node.type === "chunk")
		return TIER_COLORS[node.data?.tier ?? 1] ?? TIER_COLORS[1];
	if (node.type === "question") return DATA_COLORS.QUESTION;
	if (node.type === "trigger") return DATA_COLORS.TRIGGER;
	if (node.type === "pattern") return DATA_COLORS.T3;
	if (node.type === "cluster") return DATA_COLORS.CLUSTER;
	return TIER_COLORS[1];
};

/* ── Scale factor for node ── */

const getNodeScale = (node) => {
	if (node.type === "chunk") {
		const accessCount = node.data?.access_count ?? 1;
		const tierMultiplier =
			node.data?.tier === 3 ? 2.0 : node.data?.tier === 2 ? 1.5 : 1.0;
		return tierMultiplier * (1 + Math.log2(Math.max(1, accessCount)) * 0.15);
	}
	if (node.type === "question") {
		const level = node.data?.level ?? 1;
		return 0.6 + level * 0.12;
	}
	if (node.type === "trigger") return 0.8;
	if (node.type === "pattern") return 2.0;
	return 1.0;
};

/* ── Default Z for node type/tier ── */

export const getDefaultZ = (node) => {
	if (node.type === "chunk") {
		const tier = node.data?.tier ?? 1;
		if (tier === 1) return DEPTH_PLANES.MID;
		if (tier === 2) return DEPTH_PLANES.BACK;
		return DEPTH_PLANES.DEEP;
	}
	if (node.type === "question") return DEPTH_PLANES.QUESTIONS;
	if (node.type === "pattern") return DEPTH_PLANES.DEEP;
	if (node.type === "trigger") return DEPTH_PLANES.MID;
	if (node.type === "cluster") return DEPTH_PLANES.BACK;
	return DEPTH_PLANES.MID;
};

/* ── Create a 3D mesh for a node ── */

export const createNodeMesh = (node) => {
	if (node.type === "cluster") {
		return createClusterShell(node);
	}

	const color = getNodeColor(node);
	const tier = node.data?.tier ?? 1;
	const geometry = getGeometry(node.type, tier);
	const scale = getNodeScale(node);

	const material = new THREE.MeshStandardMaterial({
		color,
		emissive: color,
		emissiveIntensity: 1.8,
		roughness: 0.2,
		metalness: 0.3,
		transparent: true,
		opacity: 0.95,
	});

	const mesh = new THREE.Mesh(geometry, material);
	mesh.scale.setScalar(scale);

	const z = node.position?.z !== 0 ? node.position.z : getDefaultZ(node);
	mesh.position.set(node.position?.x ?? 0, node.position?.y ?? 0, z);

	mesh.userData = { nodeId: node.id, nodeType: node.type, tier };

	return mesh;
};

/* ── Cluster shell ── */

const createClusterShell = (node) => {
	const radius = 40;
	const geometry = new THREE.SphereGeometry(radius, 24, 24);
	const material = new THREE.MeshBasicMaterial({
		color: 0xffffff,
		transparent: true,
		opacity: 0.08,
		side: THREE.BackSide,
		depthWrite: false,
	});

	const shell = new THREE.Mesh(geometry, material);
	const z = node.position?.z !== 0 ? node.position.z : DEPTH_PLANES.BACK;
	shell.position.set(node.position?.x ?? 0, node.position?.y ?? 0, z);
	shell.userData = { nodeId: node.id, nodeType: "cluster" };

	// Wireframe overlay
	const wireMaterial = new THREE.MeshBasicMaterial({
		color: 0xffffff,
		transparent: true,
		opacity: 0.03,
		wireframe: true,
	});
	const wireframe = new THREE.Mesh(geometry.clone(), wireMaterial);
	shell.add(wireframe);

	return shell;
};

/* ── Selection ring ── */

export const createSelectionRing = (mesh) => {
	const scale = mesh.scale.x;
	const geometry = new THREE.TorusGeometry(scale * 1.4, 0.08, 8, 32);
	const material = new THREE.MeshBasicMaterial({
		color: 0xffffff,
		transparent: true,
		opacity: 0.8,
	});
	const ring = new THREE.Mesh(geometry, material);
	ring.rotation.x = Math.PI / 2;
	return ring;
};

/* ── Update mesh for state changes ── */

export const updateNodeMesh = (
	mesh,
	node,
	{ selected = false, relevance = 1.0, dimmed = false },
) => {
	if (!mesh || !mesh.material) return;

	const color = getNodeColor(node);
	const scale = getNodeScale(node);
	mesh.scale.setScalar(scale);

	if (mesh.material.emissive) {
		mesh.material.emissive.setHex(color);
		mesh.material.emissiveIntensity = relevance * (selected ? 2.0 : 1.0);
		mesh.material.opacity = dimmed ? 0.2 : 0.9;
	}

	// Slow rotation for T3 schemas and patterns
	if (
		node.type === "pattern" ||
		(node.type === "chunk" && node.data?.tier === 3)
	) {
		mesh.userData.shouldRotate = true;
	}
};

/* ── Update cluster shell to enclose members ── */

export const updateClusterShell = (shellMesh, memberPositions) => {
	if (!memberPositions.length) return;

	// Compute center of mass
	const center = new THREE.Vector3();
	for (const pos of memberPositions) {
		center.add(pos);
	}
	center.divideScalar(memberPositions.length);

	// Compute radius: max distance + 20% padding
	let maxDist = 0;
	for (const pos of memberPositions) {
		const dist = center.distanceTo(pos);
		if (dist > maxDist) maxDist = dist;
	}
	const radius = (maxDist + 5) * NODE_GEOMETRY.CLUSTER.padding;

	shellMesh.position.copy(center);
	shellMesh.scale.setScalar(radius / 10); // geometry has base radius 10
};
