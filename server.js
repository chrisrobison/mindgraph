#!/usr/bin/env node

/**
 * CAR Brain — Local Server (zero dependencies)
 *
 * Serves the static frontend and provides REST API for:
 * - Disk persistence of brain data
 * - Configuration management
 *
 * Usage:
 *   node server.js                    # standalone mode, port 4173
 *   node server.js --port 8080        # custom port
 *   node server.js --project ./myapp  # project mode
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

/* ── CLI args ── */

const args = process.argv.slice(2);
const getArg = (flag) => {
	const idx = args.indexOf(flag);
	return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
};

const PORT = parseInt(getArg("--port") ?? "4173", 10);
const PROJECT_PATH = getArg("--project");
const BRAIN_DIR = PROJECT_PATH
	? path.resolve(PROJECT_PATH, ".car-brain")
	: path.join(os.homedir(), ".car-brain", "brains", "default");

/* ── Ensure brain directory exists ── */

const ensureDir = (dirPath) => {
	if (!fs.existsSync(dirPath)) {
		fs.mkdirSync(dirPath, { recursive: true });
	}
};

ensureDir(BRAIN_DIR);
ensureDir(path.join(BRAIN_DIR, "sessions"));
ensureDir(path.join(BRAIN_DIR, "exports"));

/* ── MIME types ── */

const MIME_TYPES = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

/* ── Helper: read request body ── */

const readBody = (req) =>
	new Promise((resolve, reject) => {
		const chunks = [];
		req.on("data", (chunk) => chunks.push(chunk));
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
		req.on("error", reject);
	});

/* ── Helper: JSON response ── */

const jsonResponse = (res, statusCode, data) => {
	const body = JSON.stringify(data);
	res.writeHead(statusCode, {
		"Content-Type": "application/json; charset=utf-8",
		"Access-Control-Allow-Origin": "*",
	});
	res.end(body);
};

/* ── API routes ── */

const brainFilePath = path.join(BRAIN_DIR, "brain.json");
const configFilePath = path.join(BRAIN_DIR, "config.json");

const handleApi = async (req, res) => {
	const url = new URL(req.url, `http://localhost:${PORT}`);
	const pathname = url.pathname;

	// CORS preflight
	if (req.method === "OPTIONS") {
		res.writeHead(204, {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type",
		});
		res.end();
		return true;
	}

	// GET /api/brain — load brain from disk
	if (pathname === "/api/brain" && req.method === "GET") {
		try {
			if (fs.existsSync(brainFilePath)) {
				const data = fs.readFileSync(brainFilePath, "utf-8");
				jsonResponse(res, 200, JSON.parse(data));
			} else {
				jsonResponse(res, 404, { error: "No brain data on disk" });
			}
		} catch (error) {
			jsonResponse(res, 500, { error: error.message });
		}
		return true;
	}

	// PUT /api/brain — save brain to disk
	if (pathname === "/api/brain" && req.method === "PUT") {
		try {
			const body = await readBody(req);
			const parsed = JSON.parse(body);
			fs.writeFileSync(brainFilePath, JSON.stringify(parsed, null, 2), "utf-8");
			jsonResponse(res, 200, { ok: true, savedAt: new Date().toISOString() });
		} catch (error) {
			jsonResponse(res, 500, { error: error.message });
		}
		return true;
	}

	// GET /api/config — load config
	if (pathname === "/api/config" && req.method === "GET") {
		try {
			if (fs.existsSync(configFilePath)) {
				const data = fs.readFileSync(configFilePath, "utf-8");
				jsonResponse(res, 200, JSON.parse(data));
			} else {
				jsonResponse(res, 200, {
					runner: "claude-code",
					project: PROJECT_PATH ?? null,
					brainDir: BRAIN_DIR,
				});
			}
		} catch (error) {
			jsonResponse(res, 500, { error: error.message });
		}
		return true;
	}

	// PUT /api/config — save config
	if (pathname === "/api/config" && req.method === "PUT") {
		try {
			const body = await readBody(req);
			const parsed = JSON.parse(body);
			fs.writeFileSync(
				configFilePath,
				JSON.stringify(parsed, null, 2),
				"utf-8",
			);
			jsonResponse(res, 200, { ok: true });
		} catch (error) {
			jsonResponse(res, 500, { error: error.message });
		}
		return true;
	}

	// GET /api/health — health check
	if (pathname === "/api/health" && req.method === "GET") {
		jsonResponse(res, 200, {
			status: "ok",
			brainDir: BRAIN_DIR,
			project: PROJECT_PATH ?? null,
			hasBrain: fs.existsSync(brainFilePath),
		});
		return true;
	}

	return false;
};

/* ── Static file serving ── */

const STATIC_ROOT = __dirname;

const serveStatic = (req, res) => {
	const url = new URL(req.url, `http://localhost:${PORT}`);
	let pathname = url.pathname;

	// Default to index.html
	if (pathname === "/") pathname = "/index.html";

	const filePath = path.join(STATIC_ROOT, pathname);

	// Security: prevent directory traversal
	if (!filePath.startsWith(STATIC_ROOT)) {
		res.writeHead(403);
		res.end("Forbidden");
		return;
	}

	try {
		if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
			res.writeHead(404);
			res.end("Not Found");
			return;
		}

		const ext = path.extname(filePath);
		const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

		const content = fs.readFileSync(filePath);
		res.writeHead(200, {
			"Content-Type": contentType,
			"Cache-Control": "no-cache",
		});
		res.end(content);
	} catch (error) {
		res.writeHead(500);
		res.end(`Server Error: ${error.message}`);
	}
};

/* ── Server ── */

const server = http.createServer(async (req, res) => {
	try {
		// API routes
		if (req.url.startsWith("/api/")) {
			const handled = await handleApi(req, res);
			if (handled) return;
		}

		// Static files
		serveStatic(req, res);
	} catch (error) {
		console.error("Server error:", error);
		res.writeHead(500);
		res.end("Internal Server Error");
	}
});

server.listen(PORT, "127.0.0.1", () => {
	console.log(`\n  CAR Brain Server`);
	console.log(`  ─────────────────────────────────`);
	console.log(`  URL:      http://localhost:${PORT}`);
	console.log(`  Brain:    ${BRAIN_DIR}`);
	if (PROJECT_PATH) console.log(`  Project:  ${path.resolve(PROJECT_PATH)}`);
	console.log(`  ─────────────────────────────────\n`);
});
