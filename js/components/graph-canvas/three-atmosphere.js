import * as THREE from "three";
import { ATMOSPHERE, DEPTH_PLANES } from "../../core/constants.js";

/* ── Ambient particle field: ~200 tiny drifting points ── */

export const createAmbientParticles = () => {
	const count = ATMOSPHERE.AMBIENT_PARTICLES;
	const positions = new Float32Array(count * 3);
	const velocities = new Float32Array(count * 3);
	const sizes = new Float32Array(count);

	for (let i = 0; i < count; i++) {
		positions[i * 3] = (Math.random() - 0.5) * 600;
		positions[i * 3 + 1] = (Math.random() - 0.5) * 400;
		positions[i * 3 + 2] = -200 + Math.random() * -800;

		velocities[i * 3] = (Math.random() - 0.5) * 0.02;
		velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.015;
		velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.01;

		sizes[i] = 0.3 + Math.random() * 0.5;
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

	const material = new THREE.PointsMaterial({
		color: 0xffffff,
		size: 1.5,
		transparent: true,
		opacity: 0.2,
		sizeAttenuation: true,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
	});

	const points = new THREE.Points(geometry, material);
	points.userData = { velocities, isAmbientParticles: true };
	points.renderOrder = -10;
	return points;
};

/* ── Animate ambient particles ── */

export const animateAmbientParticles = (particles, delta) => {
	if (!particles?.geometry?.attributes?.position) return;

	const positions = particles.geometry.attributes.position;
	const velocities = particles.userData.velocities;
	const count = positions.count;

	for (let i = 0; i < count; i++) {
		let x = positions.getX(i) + velocities[i * 3] * delta * 60;
		let y = positions.getY(i) + velocities[i * 3 + 1] * delta * 60;
		let z = positions.getZ(i) + velocities[i * 3 + 2] * delta * 60;

		// Wrap around bounds
		if (x > 300) x = -300;
		if (x < -300) x = 300;
		if (y > 200) y = -200;
		if (y < -200) y = 200;
		if (z > 0) z = -1000;
		if (z < -1000) z = 0;

		positions.setXYZ(i, x, y, z);
	}

	positions.needsUpdate = true;
};

/* ── Star field: ~500 static points at far background ── */

export const createStarField = () => {
	const count = ATMOSPHERE.STAR_POINTS;
	const positions = new Float32Array(count * 3);
	const opacities = new Float32Array(count);

	for (let i = 0; i < count; i++) {
		positions[i * 3] = (Math.random() - 0.5) * 2000;
		positions[i * 3 + 1] = (Math.random() - 0.5) * 1500;
		positions[i * 3 + 2] =
			DEPTH_PLANES.STARS_NEAR +
			Math.random() * (DEPTH_PLANES.STARS_FAR - DEPTH_PLANES.STARS_NEAR);

		opacities[i] = 0.1 + Math.random() * 0.3;
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

	const material = new THREE.PointsMaterial({
		color: 0xffffff,
		size: 1.0,
		transparent: true,
		opacity: 0.4,
		sizeAttenuation: true,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
	});

	const points = new THREE.Points(geometry, material);
	points.renderOrder = -20;
	return points;
};

/* ── Nebula gradient sprites behind clusters ── */

export const createNebulaClouds = () => {
	const group = new THREE.Group();
	const colors = [0x00f5ff, 0x7b61ff, 0xff2d78, 0x00f5ff];
	const nebulaCount = ATMOSPHERE.NEBULA_COUNT;

	for (let i = 0; i < nebulaCount; i++) {
		const canvas = document.createElement("canvas");
		canvas.width = 256;
		canvas.height = 256;
		const ctx = canvas.getContext("2d");

		const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
		const hex = colors[i % colors.length];
		const r = (hex >> 16) & 0xff;
		const g = (hex >> 8) & 0xff;
		const b = hex & 0xff;
		gradient.addColorStop(0, `rgba(${r},${g},${b},0.15)`);
		gradient.addColorStop(0.4, `rgba(${r},${g},${b},0.06)`);
		gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, 256, 256);

		const texture = new THREE.CanvasTexture(canvas);
		const material = new THREE.SpriteMaterial({
			map: texture,
			transparent: true,
			opacity: 0.5,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		});

		const sprite = new THREE.Sprite(material);
		sprite.scale.set(500 + Math.random() * 200, 500 + Math.random() * 200, 1);
		sprite.position.set(
			(Math.random() - 0.5) * 600,
			(Math.random() - 0.5) * 300,
			DEPTH_PLANES.NEBULA_NEAR +
				Math.random() * (DEPTH_PLANES.NEBULA_FAR - DEPTH_PLANES.NEBULA_NEAR),
		);

		group.add(sprite);
	}

	group.renderOrder = -15;
	return group;
};

/* ── Ambient light breathing (sine wave) ── */

export const updateAmbientBreathing = (ambientLight, elapsedTime) => {
	if (!ambientLight) return;
	const base = 0.5;
	const amplitude = ATMOSPHERE.BREATHING_AMPLITUDE;
	const period = ATMOSPHERE.BREATHING_PERIOD;
	ambientLight.intensity =
		base + amplitude * Math.sin((elapsedTime * 2 * Math.PI) / period);
};
