/* ── CAR Brain Simulator — Constants & Design Tokens ── */

export const DEPTH_PLANES = Object.freeze({
	FRONT: 0,
	QUESTIONS: -100,
	MID: -200,
	BACK: -400,
	DEEP: -600,
	AMENDMENT: -800,
	NEBULA_NEAR: -800,
	NEBULA_FAR: -1200,
	STARS_NEAR: -1500,
	STARS_FAR: -2500,
});

export const TIER_COLORS = Object.freeze({
	1: 0x00f5ff,
	2: 0x7b61ff,
	3: 0xff2d78,
});

export const TIER_COLOR_CSS = Object.freeze({
	1: "#00f5ff",
	2: "#7b61ff",
	3: "#ff2d78",
});

export const DATA_COLORS = Object.freeze({
	T1: 0x00f5ff,
	T2: 0x7b61ff,
	T3: 0xff2d78,
	QUESTION: 0xffd93d,
	TRIGGER: 0xff9f1c,
	CLUSTER: 0xffffff,
	CONTRADICTION: 0xff3333,
	RETRIEVAL: 0x00f5ff,
});

export const DATA_COLORS_CSS = Object.freeze({
	T1: "#00f5ff",
	T2: "#7b61ff",
	T3: "#ff2d78",
	QUESTION: "#ffd93d",
	TRIGGER: "#ff9f1c",
	CLUSTER: "rgba(255,255,255,0.2)",
	CONTRADICTION: "#ff3333",
	RETRIEVAL: "#00f5ff",
});

export const CAMERA = Object.freeze({
	HOME_POSITION: Object.freeze([0, 80, 350]),
	HOME_LOOK_AT: Object.freeze([0, 0, -200]),
	INTRO_POSITION: Object.freeze([0, 200, 600]),
	SWOOP_DURATION: 2.0,
	FOCUS_DURATION: 0.6,
	ORBIT_SPEED: 5,
});

export const BLOOM = Object.freeze({
	THRESHOLD: 0.4,
	STRENGTH: 1.5,
	RADIUS: 0.6,
});

export const FOG = Object.freeze({
	COLOR: 0x080c14,
	DENSITY: 0.0008,
});

export const ATMOSPHERE = Object.freeze({
	AMBIENT_PARTICLES: 400,
	STAR_POINTS: 800,
	NEBULA_COUNT: 6,
	BREATHING_PERIOD: 8.0,
	BREATHING_AMPLITUDE: 0.05,
});

export const NODE_GEOMETRY = Object.freeze({
	CHUNK_T1: Object.freeze({ type: "sphere", radius: 5, segments: 32 }),
	CHUNK_T2: Object.freeze({ type: "icosahedron", radius: 7, detail: 1 }),
	CHUNK_T3: Object.freeze({ type: "octahedron", radius: 9 }),
	QUESTION: Object.freeze({ type: "tetrahedron", radius: 4 }),
	TRIGGER: Object.freeze({ type: "diamond", radius: 3.5 }),
	CLUSTER: Object.freeze({ type: "shell", padding: 15 }),
});

export const RETRIEVAL_STEPS = Object.freeze([
	{ id: 1, name: "Session Primer", duration: 0.5 },
	{ id: 2, name: "Context Construction", duration: 0.8 },
	{ id: 3, name: "Question Decomposition", duration: 1.0 },
	{ id: 4, name: "Metamemory Check", duration: 0.5 },
	{ id: 5, name: "Multi-Query Retrieval R1", duration: 1.2 },
	{ id: 6, name: "Cluster Formation", duration: 0.8 },
	{ id: 7, name: "Cluster Expansion R2", duration: 1.0 },
	{ id: 8, name: "Tiered Retrieval", duration: 0.8 },
	{ id: 9, name: "Interference Check", duration: 0.6 },
	{ id: 10, name: "Confidence Grading", duration: 0.5 },
	{ id: 11, name: "Thinking Profile", duration: 0.3 },
	{ id: 12, name: "Synthesis + Response", duration: 1.0 },
	{ id: 13, name: "Post-Retrieval Update", duration: 0.5 },
]);

export const EBBINGHAUS_DECAY = Object.freeze([
	{ days: 1, weight: 1.0 },
	{ days: 7, weight: 0.75 },
	{ days: 30, weight: 0.5 },
	{ days: 90, weight: 0.3 },
	{ days: 365, weight: 0.15 },
]);

export const HISTORY_LIMITS = Object.freeze({
	graphSnapshots: 80,
});

export const PERSISTENCE = Object.freeze({
	autosaveDebounceMs: 450,
	serverUrl: "http://localhost:4174",
	storage: Object.freeze({
		lastSessionDocument: "carbrain.last_session.document",
		autosaveEnabled: "carbrain.autosave.enabled",
		uiState: "carbrain.ui.state",
	}),
});

export const LAYOUT = Object.freeze({
	toolbarHeight: 44,
	paletteWidth: 56,
	inspectorWidth: 300,
	bottomPanelHeight: 180,
});

/* ── Utility helpers (preserved from original) ── */

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const clampZoom = (value) => clamp(value, 0.1, 5.0);

export const formatEdgeLabel = (value) =>
	String(value ?? "")
		.trim()
		.replaceAll("_", " ")
		.replace(/\s+/g, " ")
		.replace(/\b\w/g, (letter) => letter.toUpperCase());
