from __future__ import annotations

import os
import sys
from pathlib import Path

from agno.agent import Agent
from agno.db.sqlite import SqliteDb
from agno.os import AgentOS
from agno.tools.duckduckgo import DuckDuckGoTools
from agno.tools.shell import ShellTools
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from agno_tools import (
    AGNO_DB_PATH,
    DEFAULT_AGENTOS_CORS,
    DEFAULT_AGENTOS_HOST,
    DEFAULT_AGENTOS_PORT,
    OpenClaudeAgentTools,
    WORKSPACE_ROOT,
    WorkspaceFileTools,
    activate_named_model,
    assign_session_to_topic,
    browse_workspace_folder,
    create_git_branch,
    commit_git_changes,
    complete_terminal_command,
    create_topic,
    detach_session_from_topics,
    ensure_state_dir,
    get_git_overview,
    get_integration_snapshot,
    get_open_with_targets,
    get_slash_catalog,
    get_terminal_snapshot,
    get_workspace_bootstrap,
    get_workspace_context,
    launch_open_with_target,
    list_topics,
    list_git_branches,
    persist_native_settings,
    persist_router_profile,
    persist_runtime_profile,
    resize_terminal,
    resolve_workspace_topic,
    resolve_agno_model,
    run_terminal_command,
    send_terminal_input,
    set_project_workspace_root,
    switch_git_branch,
    workspace_status,
)

ensure_state_dir()

base_app = FastAPI(
    title="OpenClaude AgentOS",
    docs_url="/integration/docs",
    redoc_url=None,
)


def _configure_cors(target_app: FastAPI) -> None:
    target_app.add_middleware(
        CORSMiddleware,
        allow_origins=DEFAULT_AGENTOS_CORS,
        allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


_configure_cors(base_app)


@base_app.get("/healthz")
def healthz() -> dict[str, object]:
    return {"ok": True, **workspace_status()}


@base_app.get("/integration/status")
def integration_status() -> dict[str, object]:
    return workspace_status()


@base_app.get("/integration/config")
def integration_config() -> dict[str, object]:
    return get_integration_snapshot()


class RuntimeConfigPayload(BaseModel):
    profile: str
    model: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    gemini_auth_mode: str | None = None
    chatgpt_account_id: str | None = None


class RouterConfigPayload(BaseModel):
    mode: str = "inherit"
    model_id: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    provider_name: str | None = None


class AgentModelConfigPayload(BaseModel):
    name: str
    base_url: str
    api_key: str | None = None


class NativeSettingsPayload(BaseModel):
    agent_models: list[AgentModelConfigPayload] = []
    agent_routing: dict[str, str] = {}


class IntegrationConfigPayload(BaseModel):
    runtime: RuntimeConfigPayload
    router: RouterConfigPayload
    native_settings: NativeSettingsPayload | None = None


class ActivateModelPayload(BaseModel):
    model_name: str


class TopicCreatePayload(BaseModel):
    name: str
    description: str | None = None


class TopicSessionPayload(BaseModel):
    session_id: str


class WorkspaceTargetPayload(BaseModel):
    path: str
    create_topic: bool = True


class BranchSwitchPayload(BaseModel):
    branch_name: str


class BranchCreatePayload(BaseModel):
    branch_name: str
    start_point: str | None = None
    switch: bool = True


class TerminalRunPayload(BaseModel):
    command: str


class TerminalCompletePayload(BaseModel):
    command: str


class TerminalInputPayload(BaseModel):
    data: str


class TerminalResizePayload(BaseModel):
    cols: int
    rows: int


class OpenWithPayload(BaseModel):
    target_id: str


class FolderPickerPayload(BaseModel):
    title: str | None = None


class GitCommitPayload(BaseModel):
    message: str | None = None
    include_untracked: bool = True
    action: str = "commit"
    draft: bool = False


def _refresh_primary_agent_model() -> None:
    primary_agent.model = resolve_agno_model()


@base_app.put("/integration/config")
def update_integration_config(payload: IntegrationConfigPayload) -> dict[str, object]:
    runtime_payload = payload.runtime.model_dump()
    router_payload = payload.router.model_dump()
    native_settings_payload = (
        payload.native_settings.model_dump() if payload.native_settings else None
    )

    if router_payload.get("mode") == "explicit":
        if not router_payload.get("model_id") or not router_payload.get("base_url"):
            raise HTTPException(
                status_code=400,
                detail="Router explicit mode requires both model_id and base_url.",
            )

    try:
        persist_runtime_profile(runtime_payload)
        persist_router_profile(router_payload)
        if native_settings_payload is not None:
            persist_native_settings(native_settings_payload)
        _refresh_primary_agent_model()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return get_integration_snapshot()


@base_app.get("/integration/slash-catalog")
def integration_slash_catalog() -> dict[str, object]:
    return get_slash_catalog()


@base_app.post("/integration/activate-model")
def integration_activate_model(payload: ActivateModelPayload) -> dict[str, object]:
    try:
        activate_named_model(payload.model_name)
        _refresh_primary_agent_model()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return get_integration_snapshot()


@base_app.get("/integration/workspace")
def integration_workspace() -> dict[str, object]:
    return get_workspace_context()


@base_app.get("/integration/workspace-bootstrap")
def integration_workspace_bootstrap() -> dict[str, object]:
    return get_workspace_bootstrap()


@base_app.post("/integration/workspace-target")
def integration_workspace_target(payload: WorkspaceTargetPayload) -> dict[str, object]:
    try:
        set_project_workspace_root(payload.path)
        topic = resolve_workspace_topic(create_if_missing=payload.create_topic)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "workspace": get_workspace_context(),
        "topic": topic,
        "branches": list_git_branches(),
        "topics": list_topics(),
    }


@base_app.get("/integration/branches")
def integration_branches() -> dict[str, object]:
    return list_git_branches()


@base_app.post("/integration/branches/switch")
def integration_switch_branch(payload: BranchSwitchPayload) -> dict[str, object]:
    try:
        return switch_git_branch(payload.branch_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@base_app.post("/integration/branches/create")
def integration_create_branch(payload: BranchCreatePayload) -> dict[str, object]:
    try:
        return create_git_branch(
            payload.branch_name,
            start_point=payload.start_point,
            switch=payload.switch,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@base_app.get("/integration/git/overview")
def integration_git_overview() -> dict[str, object]:
    return get_git_overview()


@base_app.post("/integration/git/commit")
def integration_git_commit(payload: GitCommitPayload) -> dict[str, object]:
    try:
        return commit_git_changes(
            payload.message,
            include_untracked=payload.include_untracked,
            action=payload.action,
            draft=payload.draft,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@base_app.get("/integration/open-with")
def integration_open_with() -> dict[str, object]:
    return get_open_with_targets()


@base_app.post("/integration/open-with")
def integration_open_with_launch(payload: OpenWithPayload) -> dict[str, object]:
    try:
        return launch_open_with_target(payload.target_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@base_app.post("/integration/folder-picker")
def integration_folder_picker(payload: FolderPickerPayload) -> dict[str, object]:
    try:
        return browse_workspace_folder(payload.title)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@base_app.get("/integration/terminal")
def integration_terminal() -> dict[str, object]:
    return get_terminal_snapshot()


@base_app.post("/integration/terminal/run")
def integration_terminal_run(payload: TerminalRunPayload) -> dict[str, object]:
    try:
        return run_terminal_command(payload.command)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@base_app.post("/integration/terminal/input")
def integration_terminal_input(payload: TerminalInputPayload) -> dict[str, object]:
    try:
        return send_terminal_input(payload.data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@base_app.post("/integration/terminal/resize")
def integration_terminal_resize(payload: TerminalResizePayload) -> dict[str, object]:
    try:
        return resize_terminal(payload.cols, payload.rows)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@base_app.post("/integration/terminal/complete")
def integration_terminal_complete(payload: TerminalCompletePayload) -> dict[str, object]:
    try:
        return complete_terminal_command(payload.command)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@base_app.get("/integration/topics")
def integration_topics() -> dict[str, object]:
    return {"items": list_topics()}


@base_app.post("/integration/topics")
def integration_create_topic(payload: TopicCreatePayload) -> dict[str, object]:
    try:
        topic = create_topic(payload.name, payload.description)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"item": topic, "items": list_topics()}


@base_app.post("/integration/topics/{topic_id}/sessions")
def integration_assign_session(topic_id: str, payload: TopicSessionPayload) -> dict[str, object]:
    try:
        items = assign_session_to_topic(topic_id, payload.session_id)
    except ValueError as exc:
        status_code = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc

    return {"items": items}


@base_app.delete("/integration/topic-links/{session_id}")
def integration_detach_session(session_id: str) -> dict[str, object]:
    try:
        items = detach_session_from_topics(session_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"items": items}


def build_agent() -> Agent:
    return Agent(
        id="openclaude-web",
        name="OpenClaude Web",
        model=resolve_agno_model(),
        db=SqliteDb(db_file=str(AGNO_DB_PATH)),
        description=(
            "Local web agent for this OpenClaude repository. It uses Agno for the web layer "
            "and delegates real coding work to the native OpenClaude runtime."
        ),
        instructions=[
            "Use `openclaude_session` as the default tool for repository work. It preserves a stable OpenClaude session for the current web chat and exposes the native OpenClaude toolchain.",
            "Prefer `openclaude_session` for shell, file edits, MCP access, web work, debugging, planning, and multi-step coding tasks so tool parity stays aligned with OpenClaude.",
            "Use the direct workspace tools only for lightweight diagnostics of this integration layer or when the user explicitly asks for simple local operations.",
            "Keep all file and shell work inside the repository workspace.",
            "When you use `openclaude_session`, pass the user's request with enough detail for OpenClaude to act without extra prompting.",
            "Prefer concise answers in markdown after tool work finishes.",
        ],
        tools=[
            OpenClaudeAgentTools(),
            WorkspaceFileTools(),
            ShellTools(
                base_dir=str(WORKSPACE_ROOT),
                requires_confirmation_tools=["run_shell_command"],
                show_result_tools=["run_shell_command"],
            ),
            DuckDuckGoTools(
                enable_news=False,
                fixed_max_results=5,
                backend="html",
            ),
        ],
        add_history_to_context=True,
        num_history_runs=6,
        add_session_state_to_context=True,
        markdown=True,
        stream=True,
        stream_events=True,
        telemetry=False,
        reasoning=False,
    )


primary_agent = build_agent()


agent_os = AgentOS(
    name="OpenClaude Local OS",
    description="Local AgentOS wrapper around the OpenClaude runtime.",
    db=SqliteDb(db_file=str(AGNO_DB_PATH)),
    agents=[primary_agent],
    base_app=base_app,
    cors_allowed_origins=DEFAULT_AGENTOS_CORS,
    tracing=False,
    telemetry=False,
)

app = agent_os.get_app()
_configure_cors(app)


if __name__ == "__main__":
    agent_os.serve(
        app,
        host=os.getenv("AGNO_HOST", DEFAULT_AGENTOS_HOST),
        port=int(os.getenv("AGNO_PORT", str(DEFAULT_AGENTOS_PORT))),
        reload=os.getenv("AGNO_RELOAD", "0").lower() in {"1", "true", "yes"},
    )
