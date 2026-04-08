from __future__ import annotations

import os
import subprocess
import uuid
from pathlib import Path

from agno.run import RunContext
from agno.tools import Toolkit

from .bridge import (
    OPENCLAUDE_DIST_PATH,
    WORKSPACE_ROOT,
    ensure_state_dir,
    get_project_workspace_root,
    merged_runtime_env,
    resolve_workspace_path,
)


class OpenClaudeAgentTools(Toolkit):
    def __init__(self, workspace_root: Path | None = None):
        self.app_root = WORKSPACE_ROOT.resolve()
        self.workspace_root = (workspace_root or get_project_workspace_root()).resolve()
        super().__init__(
            name="openclaude_bridge",
            tools=[self.openclaude_session],
            show_result_tools=["openclaude_session"],
        )

    def _ensure_openclaude_built(self) -> None:
        if OPENCLAUDE_DIST_PATH.exists():
            return

        result = subprocess.run(
            ["bun", "run", "build"],
            cwd=self.app_root,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        if result.returncode != 0:
            raise RuntimeError(
                "Failed to build OpenClaude before launching the Agno bridge.\n"
                f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
            )

    def _resolve_openclaude_session_id(self, run_context: RunContext) -> str:
        workspace_root = get_project_workspace_root()
        state = run_context.session_state or {}
        existing = state.get("openclaude_session_id")
        if isinstance(existing, str) and existing:
            return existing

        stable = str(
            uuid.uuid5(
                uuid.NAMESPACE_URL,
                f"openclaude://{workspace_root.as_posix()}/{run_context.user_id or 'anonymous'}/{run_context.session_id}",
            )
        )
        state["openclaude_session_id"] = stable
        run_context.session_state = state
        return stable

    def openclaude_session(
        self,
        task: str,
        run_context: RunContext,
        cwd: str = ".",
        timeout_seconds: int = 900,
    ) -> str:
        """
        Delegate a coding task to the native OpenClaude runtime with its full local toolchain.

        Use this tool for real coding work: repository inspection, debugging, command execution,
        file changes, tool-driven web fetch/search, and multi-step development tasks. The same
        OpenClaude session is preserved across the current AgentOS chat session.

        Args:
            task: Full user task to forward to OpenClaude.
            cwd: Relative working directory inside the repository.
            timeout_seconds: Maximum execution time for this delegated run.
        """
        if not task.strip():
            raise ValueError("task cannot be empty")

        ensure_state_dir()
        self._ensure_openclaude_built()

        workspace_root = get_project_workspace_root()
        workdir = resolve_workspace_path(cwd, base_dir=workspace_root)
        if not workdir.is_dir():
            raise ValueError(f"cwd must be a directory inside the workspace: {cwd}")

        openclaude_session_id = self._resolve_openclaude_session_id(run_context)
        state = run_context.session_state or {}
        initialized = bool(state.get("openclaude_initialized"))

        args = [
            "node",
            str(OPENCLAUDE_DIST_PATH),
            "-p",
            "--output-format",
            "text",
            "--dangerously-skip-permissions",
            "--permission-mode",
            "bypassPermissions",
        ]
        if initialized:
            args.extend(["--resume", openclaude_session_id])
        else:
            args.extend(["--session-id", openclaude_session_id])
        args.append(task)

        env = os.environ.copy()
        env.update(merged_runtime_env())
        env.setdefault("AGNO_TELEMETRY", "false")

        completed = subprocess.run(
            args,
            cwd=workdir,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=timeout_seconds,
            env=env,
        )
        if completed.returncode != 0:
            stderr = completed.stderr.strip() or "(no stderr)"
            stdout = completed.stdout.strip() or "(no stdout)"
            raise RuntimeError(
                "OpenClaude returned a non-zero status.\n"
                f"Command: {' '.join(args)}\n"
                f"STDERR:\n{stderr}\n\nSTDOUT:\n{stdout}"
            )

        state["openclaude_initialized"] = True
        state["openclaude_last_cwd"] = workdir.relative_to(workspace_root).as_posix()
        run_context.session_state = state
        return completed.stdout.strip() or "(OpenClaude finished without textual output)"
