# Developer Workflow

## Prerequisites

- Node.js 22+
- Python 3 (only if you use `python3 -m http.server` for local static hosting)

## Install

```bash
cd /Users/cdr/Projects/mindgraph
npm install
```

## Run App (UI)

```bash
python3 -m http.server 4173
```

Open: <http://127.0.0.1:4173>

## Run Hosted-Capable Runtime Proxy

```bash
npm run start:proxy
```

Health endpoint:

```bash
curl http://127.0.0.1:8787/api/mindgraph/health
```

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

Proxy/tenancy focused tests:

```bash
npm run test:proxy
```

Expected successful test exit summary includes:

- `# fail 0`
- non-zero pass count

## Multi-Tenant Local Defaults

Without extra env vars, proxy bootstraps a default control-plane tenant mapping:

- mode: `local`
- bootstrap host/domain: `localhost`
- control DB: `./data/mindgraph-control.sqlite`

For hosted routing, set:

- `TENANCY_MODE=hosted`
- `CONTROL_DB_CLIENT=sqlite|mysql`
- `CONTROL_DB_*` connection settings
- `MINDGRAPH_PROXY_TOKEN` (recommended in hosted environments)
