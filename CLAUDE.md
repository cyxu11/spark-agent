# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**DeerFlow 2.0** is an open-source super agent harness that orchestrates sub-agents, memory, and sandboxes — powered by extensible skills. It is a full ground-up rewrite of DeerFlow v1 (v1 lives on the `1.x` branch).

## Repository Layout

```
deer-flow/
├── Makefile                      # Root orchestration: install, dev, start, stop, docker
├── config.yaml                   # Main runtime config (models, tools, sandbox, memory, channels)
├── extensions_config.json        # MCP servers + skills enable/disable state
├── config.example.yaml           # Canonical schema; bump config_version here when schema changes
├── backend/                      # Python backend (LangGraph + FastAPI Gateway)
│   ├── CLAUDE.md                 # Detailed backend architecture guide ← READ THIS
│   ├── Makefile                  # Backend-only commands
│   ├── pyproject.toml            # uv workspace root; members: [packages/harness]
│   ├── packages/harness/         # deerflow-harness package (import: deerflow.*)
│   ├── app/                      # FastAPI Gateway + IM channels (import: app.*)
│   └── tests/                    # pytest test suite
├── frontend/                     # Next.js 16 web UI
│   ├── CLAUDE.md                 # Detailed frontend architecture guide ← READ THIS
│   └── src/                     # App Router + core/ (threads, api, settings, memory, skills)
├── skills/
│   ├── public/                   # Committed skills (SKILL.md + assets)
│   └── custom/                   # Gitignored user-installed skills
├── docker/                       # Docker Compose files for dev, prod, middleware, load-balancer
└── scripts/                      # serve.sh, docker.sh, deploy.sh, configure.py, check.py
```

## Commands

### Full Application (run from repo root)

```bash
make check          # Verify required tools are installed
make install        # Install all deps: backend (uv sync) + frontend (pnpm install)
make config         # Generate local config.yaml / extensions_config.json from examples
make config-upgrade # Merge new fields from config.example.yaml into your config.yaml
make dev            # Start all services in dev mode (http://localhost:2026)
make dev-pro        # Dev + Gateway mode (agent runtime embedded in Gateway, experimental)
make stop           # Stop all running services
make clean          # Stop + delete .deer-flow/ and .langgraph_api/ state
make up             # Build + start production Docker (http://localhost:2026)
make down           # Stop production Docker containers
```

### Backend Only (run from `backend/`)

```bash
make install        # uv sync
make dev            # LangGraph server (port 2024)
make gateway        # FastAPI Gateway (port 8001)
make test           # Run all tests: PYTHONPATH=. uv run pytest tests/ -v
make lint           # ruff check + format --check
make format         # ruff check --fix + format
```

Single test file: `PYTHONPATH=. uv run pytest tests/test_<feature>.py -v`

### Frontend Only (run from `frontend/`)

```bash
pnpm dev            # Dev server with Turbopack (http://localhost:3000)
pnpm build          # Production build
pnpm check          # Lint + type check (run before committing)
pnpm lint:fix       # ESLint with auto-fix
pnpm typecheck      # tsc --noEmit
```

## Architecture

```
Browser
  │
  ▼
Nginx (port 2026)
  ├── /api/langgraph/* ──▶ LangGraph Server (port 2024)   ← agent runtime
  ├── /api/*           ──▶ Gateway API (port 8001)         ← models, MCP, skills, memory, uploads
  └── /*               ──▶ Frontend (port 3000)            ← Next.js web UI
```

**Standard mode** (4 processes): Nginx + LangGraph Server + Gateway + Frontend  
**Gateway mode** (3 processes, `--gateway`): LangGraph Server removed; agent runtime embedded in Gateway via `RunManager`. Nginx routes `/api/langgraph/*` to Gateway instead.

### Two Key Layers in the Backend

| Layer | Package | Import prefix | Contains |
|-------|---------|---------------|---------|
| **Harness** | `packages/harness/` | `deerflow.*` | Agent, tools, sandbox, models, MCP, skills, config — publishable framework |
| **App** | `app/` | `app.*` | FastAPI Gateway routers, IM channel integrations — unpublished application |

**Critical rule**: `app.*` may import `deerflow.*`, but `deerflow.*` must never import `app.*`. Enforced by `tests/test_harness_boundary.py` in CI.

### Agent Execution Flow

1. Frontend sends a message → LangGraph Server (`lead_agent` graph)
2. `make_lead_agent()` assembles tools (`sandbox`, `builtin`, `MCP`, `community`, `subagent`)
3. Middleware chain processes each turn (12 middlewares in strict order — see `backend/CLAUDE.md`)
4. SSE stream flows back through nginx → LangGraph SDK → frontend thread hooks
5. Frontend renders messages, artifacts, and todos from stream events

### Configuration

- `config.yaml` (project root): models, tools, sandbox, memory, channels, summarization, title
- `extensions_config.json` (project root): MCP servers + skill enable states (modified via Gateway API at runtime)
- Values starting with `$` are resolved as environment variables (e.g. `$OPENAI_API_KEY`)
- Config is cached and **auto-reloaded** on mtime change — no restart needed after editing
- After changing `config.example.yaml` schema, bump its `config_version` and run `make config-upgrade`

## Subdirectory CLAUDE.md Files

Both subdirectories have their own detailed guides — read them when working in that area:

- **`backend/CLAUDE.md`**: Agent system, middleware chain, sandbox, subagents, MCP, skills, memory, IM channels, Gateway API routers, vLLM provider, reflection system, TDD policy
- **`frontend/CLAUDE.md`**: Next.js App Router, thread hooks data flow, component layout, Shadcn/generated files, environment variables, code style conventions
