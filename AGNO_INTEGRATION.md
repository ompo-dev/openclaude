# OpenClaude Web Integration

This repository ships a fully local web workspace that uses Agno only as an embedded runtime layer. The product surface is OpenClaude Web: the OpenClaude runtime remains the source of truth for model access, tool execution, provider profiles, and repository behavior.

## Goals

- keep OpenClaude as the real execution engine for coding work
- preserve the existing Agent UI visual system without replacing it with a custom design system
- expose the OpenClaude toolchain in the browser instead of limiting usage to the terminal
- stay self-hosted and independent from any hosted Agno service
- make the web layer configurable for the same provider families already supported by OpenClaude

## Local Architecture

- `python/agno_server.py`
  exposes the local web API on `http://127.0.0.1:7777`
- `python/agno_tools/openclaude_agent_tool.py`
  keeps stable headless OpenClaude sessions per web chat and delegates real work to `node dist/cli.mjs`
- `python/agno_tools/bridge.py`
  resolves the active OpenClaude runtime profile, manages the local router config, probes local providers, and publishes the integration snapshot consumed by the UI
- `apps/agent-ui`
  contains the vendored Agent UI frontend, reworked for OpenClaude branding and local settings screens
- `.openclaude-profile.json`
  remains the persisted OpenClaude runtime profile used by both terminal and web sessions
- `.agno/router.json`
  stores the local web router mode when the orchestration model needs to differ from the main OpenClaude runtime
- `.agno/agentos.sqlite`
  stores local sessions and AgentOS state for the browser experience

## Execution Model

1. The browser talks to the local FastAPI app.
2. The web layer uses a lightweight router model for orchestration only.
3. For real repository work, the primary agent is instructed to use `openclaude_session`.
4. `openclaude_session` forwards the task to the native OpenClaude runtime.
5. The same OpenClaude toolchain remains available there: shell, file tools, grep, glob, agents, tasks, MCP, web tools, and provider-specific behavior.

This keeps tool parity anchored to OpenClaude instead of reimplementing tools inside the Agno layer.

## Runtime And Router Configuration

The web workspace now separates two concerns:

- `runtime`
  the OpenClaude execution profile shared with the terminal workflow
- `router`
  the model used by the web orchestration layer itself

The runtime can be persisted from the web UI and currently supports:

- OpenAI-compatible
- Ollama local
- Gemini OpenAI-compatible
- Codex
- Atomic Chat local

The router supports two modes:

- `inherit`
  reuse the current OpenClaude runtime profile
- `explicit`
  use a dedicated OpenAI-compatible router model and base URL just for web orchestration

The backend exposes:

- `GET /integration/config`
- `PUT /integration/config`
- `GET /integration/status`
- `GET /healthz`
- `GET /integration/docs`

## Web UI Surfaces

The vendored UI keeps the upstream visual language, but the product flow is now OpenClaude-specific:

- `Chat`
  the normal chat workspace backed by the OpenClaude runtime
- `Conversations`
  a larger session browser for reopening local runs
- `Settings`
  a local control panel for runtime profiles, router mode, provider probing, and tool visibility

The settings screen also shows:

- detected local providers and models
- the OpenClaude native tool catalog discovered from `src/tools`
- the current adaptation status of platform capabilities

## Independence From Hosted Agno

This integration is intentionally local-first:

- the UI is vendored into this repository
- the API is served from this repository
- state is stored in local files and SQLite
- OpenClaude remains the execution backend
- no hosted Agno dashboard or control plane is required

Agno is treated as an embedded engine and UI base, not as the owner of runtime state or product behavior.

## Documentation Alignment

The current implementation was adapted from the official Agno documentation and upstream repositories:

- Agent UI introduction: <https://docs.agno.com/agent-ui/introduction>
- Models overview: <https://docs.agno.com/models/overview>
- Chat history overview: <https://docs.agno.com/context/history/overview>
- HITL overview: <https://docs.agno.com/hitl/overview>
- Agent UI repository: <https://github.com/agno-agi/agent-ui>

The main features already adapted from those materials are:

- self-hosted Agent UI plus AgentOS flow
- local session persistence and session reopening
- OpenAI-compatible router flexibility
- browser-visible integration metadata and provider status

The features intentionally left disabled for now are:

- knowledge and memory layers beyond current OpenClaude behavior
- native human-in-the-loop approvals in the browser

These remain pending because the goal is to preserve OpenClaude behavior instead of changing its execution model.

## Current Limitation

The headless OpenClaude bridge currently runs with bypassed permission prompts:

- `--dangerously-skip-permissions`
- `--permission-mode bypassPermissions`

This is a temporary compatibility decision. The missing piece is a translator from OpenClaude `control_request` events into first-class approval prompts in the web UI.

## Start Commands

Windows PowerShell:

```powershell
.\scripts\start-agno.ps1
```

macOS / Linux:

```bash
./scripts/start-agno.sh
```

Default local URLs:

- API: `http://127.0.0.1:7777`
- UI: `http://127.0.0.1:3000`
