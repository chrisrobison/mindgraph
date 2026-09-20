# Developer Workflow

## Prerequisites

- Node.js 22+
- Python 3 (only if you use `python3 -m http.server` for local static hosting)
- No build toolchain is required for core development

## Install

```bash
cd /Users/cdr/Projects/mindgraph
npm install
```

## Editor Type Hints (No Build)

The repository includes `jsconfig.json` with `checkJs` enabled to provide IDE type checking and autocomplete via JSDoc.

- JavaScript remains the source language.
- No transpile/build step is required.

## Run App (UI)

```bash
python3 -m http.server 4173
```

Open: <http://127.0.0.1:4173>

## Run the Edge Proxy (Optional — Cloud Providers Only)

The app runs entirely in the browser by default (WebLLM). The edge proxy is
only needed if you want to use a cloud provider (OpenAI/Anthropic/Gemini)
instead of a local model:

```bash
npm run start:edge
```

This starts `edge/llm-proxy.mjs` as a plain Node dev server on
`http://127.0.0.1:3001` (configurable via `HOST`/`PORT`). The same file also
runs unmodified under `wrangler dev`, `vercel dev`, or Deno Deploy. See
[docs/provider-proxy.md](provider-proxy.md) for the request/response shape
and environment variables.

## Test Commands

Run full test suite:

```bash
npm test
```

Watch mode:

```bash
npm run test:watch
```

Runtime/planner focused tests:

```bash
npm run test:runtime
```

Expected successful test exit summary includes:

- `# fail 0`
- non-zero pass count
