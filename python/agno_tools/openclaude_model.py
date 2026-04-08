from __future__ import annotations

import asyncio
import json
import os
import subprocess
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncIterator, Iterator

from agno.exceptions import ModelProviderError
from agno.models.base import Model
from agno.models.message import Message
from agno.models.response import ModelResponse
from agno.run.agent import RunOutput
from agno.run.team import TeamRunOutput


def _trimmed(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _parse_json_line(line: str) -> dict[str, Any] | None:
    candidate = line.strip()
    if not candidate:
        return None

    try:
        payload = json.loads(candidate)
    except json.JSONDecodeError:
        return None

    return payload if isinstance(payload, dict) else None


def _extract_text_from_assistant_payload(payload: dict[str, Any]) -> str | None:
    message = payload.get("message")
    if not isinstance(message, dict):
        return None

    content = message.get("content")
    if not isinstance(content, list):
        return None

    chunks: list[str] = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "text":
            text = _trimmed(block.get("text"))
            if text:
                chunks.append(text)

    if chunks:
        return "".join(chunks)
    return None


def _compact_provider_payload(payload: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None

    compact: dict[str, Any] = {}
    for key in ("type", "subtype", "session_id", "stop_reason", "is_error", "uuid"):
        value = payload.get(key)
        if value is not None:
            compact[key] = value

    error = payload.get("error")
    if isinstance(error, dict):
        error_message = _trimmed(error.get("message"))
        if error_message:
            compact["error"] = {"message": error_message}

    result_text = _trimmed(payload.get("result"))
    if result_text:
        compact["result_preview"] = result_text[:240]

    return compact or None


@dataclass
class OpenClaudeModel(Model):
    workspace_root: Path = field(default_factory=Path.cwd)
    cli_path: Path = field(default_factory=lambda: Path("dist/cli.mjs"))
    projects_dir: Path | None = None
    runtime_env: dict[str, str] = field(default_factory=dict)
    base_url: str | None = None
    provider_name: str | None = None
    permission_mode: str = "bypassPermissions"
    timeout_seconds: int = 900

    def __post_init__(self) -> None:
        self.workspace_root = self.workspace_root.resolve()
        self.cli_path = self.cli_path.resolve()
        if self.projects_dir is not None:
            self.projects_dir = self.projects_dir.resolve()
        self.name = self.name or "OpenClaude Runtime"
        self.provider = self.provider or self.provider_name or "OpenClaude Runtime"
        super().__post_init__()

    def _ensure_openclaude_built(self) -> None:
        if self.cli_path.exists():
            return

        result = subprocess.run(
            ["bun", "run", "build"],
            cwd=self.workspace_root,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        if result.returncode != 0:
            raise ModelProviderError(
                message=(
                    "Failed to build OpenClaude before serving the web runtime.\n"
                    f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
                ),
                model_name=self.name,
                model_id=self.id,
            )

    def _session_state_for(
        self,
        run_response: RunOutput | TeamRunOutput | None,
    ) -> dict[str, Any]:
        if run_response is None:
            return {}

        if run_response.session_state is None:
            run_response.session_state = {}

        return run_response.session_state

    def _resolve_openclaude_session(
        self,
        run_response: RunOutput | TeamRunOutput | None,
    ) -> tuple[dict[str, Any], str, bool]:
        session_state = self._session_state_for(run_response)
        existing = _trimmed(session_state.get("openclaude_model_session_id"))
        initialized = bool(session_state.get("openclaude_model_initialized"))
        if existing:
            transcript_exists = self._session_transcript_exists(existing)
            effective_initialized = initialized or transcript_exists
            session_state["openclaude_model_initialized"] = effective_initialized
            return session_state, existing, effective_initialized

        seed_parts = [
            "openclaude-web",
            self.workspace_root.as_posix(),
            getattr(run_response, "user_id", None) or "anonymous",
            getattr(run_response, "session_id", None) or getattr(run_response, "run_id", None) or str(uuid.uuid4()),
        ]
        stable_session_id = str(uuid.uuid5(uuid.NAMESPACE_URL, "/".join(seed_parts)))
        session_state["openclaude_model_session_id"] = stable_session_id
        transcript_exists = self._session_transcript_exists(stable_session_id)
        session_state["openclaude_model_initialized"] = transcript_exists
        return session_state, stable_session_id, transcript_exists

    def _sanitize_workspace_path(self) -> str:
        sanitized = "".join(char if char.isalnum() else "-" for char in self.workspace_root.as_posix())
        return sanitized or "workspace"

    def _session_transcript_path(self, session_id: str) -> Path | None:
        if self.projects_dir is None:
            return None
        return self.projects_dir / self._sanitize_workspace_path() / f"{session_id}.jsonl"

    def _session_transcript_exists(self, session_id: str) -> bool:
        transcript_path = self._session_transcript_path(session_id)
        return bool(transcript_path and transcript_path.exists())

    def _extract_prompt(self, messages: list[Message], initialized: bool) -> str:
        chat_messages: list[tuple[str, str]] = []
        for message in messages:
            if message.role not in {"user", "assistant"}:
                continue
            text = _trimmed(message.get_content_string())
            if text:
                chat_messages.append((message.role, text))

        if not chat_messages:
            raise ModelProviderError(
                message="OpenClaude Web received an empty prompt.",
                model_name=self.name,
                model_id=self.id,
            )

        if initialized or len(chat_messages) == 1:
            return chat_messages[-1][1]

        rendered = [
            "Continue this existing OpenClaude Web conversation using the transcript below.",
            "",
        ]
        for role, text in chat_messages:
            label = "User" if role == "user" else "Assistant"
            rendered.append(f"{label}: {text}")
            rendered.append("")
        rendered.append("Reply to the latest user message.")
        return "\n".join(rendered).strip()

    def _build_env(self) -> dict[str, str]:
        env = os.environ.copy()
        env.update({key: value for key, value in self.runtime_env.items() if value})
        env.setdefault("AGNO_TELEMETRY", "false")
        return env

    def _build_args(
        self,
        prompt: str,
        session_id: str,
        initialized: bool,
        *,
        stream: bool,
    ) -> list[str]:
        args = [
            "node",
            str(self.cli_path),
            "-p",
            "--dangerously-skip-permissions",
            "--permission-mode",
            self.permission_mode,
        ]

        if stream:
            args.extend(
                [
                    "--verbose",
                    "--output-format",
                    "stream-json",
                    "--include-partial-messages",
                ]
            )
        else:
            args.extend(["--output-format", "json"])

        if initialized:
            args.extend(["--resume", session_id])
        else:
            args.extend(["--session-id", session_id])

        args.append(prompt)
        return args

    def _handle_stream_payload(
        self,
        payload: dict[str, Any],
    ) -> tuple[str | None, str | None, dict[str, Any] | None]:
        payload_type = payload.get("type")

        if payload_type == "stream_event":
            event = payload.get("event")
            if not isinstance(event, dict):
                return None, None, None
            if event.get("type") != "content_block_delta":
                return None, None, None
            delta = event.get("delta")
            if not isinstance(delta, dict) or delta.get("type") != "text_delta":
                return None, None, None
            return _trimmed(delta.get("text")), None, None

        if payload_type == "assistant":
            return None, _extract_text_from_assistant_payload(payload), payload

        if payload_type == "result":
            if payload.get("is_error"):
                message = _trimmed(payload.get("result")) or "OpenClaude returned an error."
                raise ModelProviderError(message=message, model_name=self.name, model_id=self.id)
            return None, _trimmed(payload.get("result")), payload

        if payload_type == "error":
            error = payload.get("error")
            if isinstance(error, dict):
                message = _trimmed(error.get("message")) or json.dumps(error)
            else:
                message = _trimmed(payload.get("message")) or "OpenClaude returned an error."
            raise ModelProviderError(message=message, model_name=self.name, model_id=self.id)

        return None, None, None

    def _raise_subprocess_error(
        self,
        *,
        args: list[str],
        stdout_text: str,
        stderr_text: str,
        returncode: int,
    ) -> None:
        raise ModelProviderError(
            message=(
                f"OpenClaude exited with status {returncode}.\n"
                f"Command: {' '.join(args)}\n"
                f"STDERR:\n{stderr_text.strip() or '(no stderr)'}\n\n"
                f"STDOUT:\n{stdout_text.strip() or '(no stdout)'}"
            ),
            model_name=self.name,
            model_id=self.id,
        )

    def invoke(
        self,
        messages: list[Message],
        assistant_message: Message,
        response_format: dict[str, Any] | type | None = None,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict[str, Any] | None = None,
        run_response: RunOutput | TeamRunOutput | None = None,
        compress_tool_results: bool = False,
    ) -> ModelResponse:
        del assistant_message, response_format, tools, tool_choice, compress_tool_results

        self._ensure_openclaude_built()
        session_state, session_id, initialized = self._resolve_openclaude_session(run_response)
        prompt = self._extract_prompt(messages, initialized)
        args = self._build_args(prompt, session_id, initialized, stream=False)

        completed = subprocess.run(
            args,
            cwd=self.workspace_root,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=self.timeout_seconds,
            env=self._build_env(),
        )
        if completed.returncode != 0:
            self._raise_subprocess_error(
                args=args,
                stdout_text=completed.stdout,
                stderr_text=completed.stderr,
                returncode=completed.returncode,
            )

        payload = _parse_json_line(completed.stdout)
        if payload is None:
            self._raise_subprocess_error(
                args=args,
                stdout_text=completed.stdout,
                stderr_text=completed.stderr,
                returncode=completed.returncode,
            )

        if payload.get("type") == "error" or payload.get("is_error"):
            _, result_text, _ = self._handle_stream_payload(payload)
            raise ModelProviderError(
                message=result_text or "OpenClaude returned an error.",
                model_name=self.name,
                model_id=self.id,
            )

        result_text = _trimmed(payload.get("result")) or _extract_text_from_assistant_payload(payload) or ""
        session_state["openclaude_model_session_id"] = _trimmed(payload.get("session_id")) or session_id
        session_state["openclaude_model_initialized"] = True

        return ModelResponse(
            role="assistant",
            content=result_text,
            provider_data=_compact_provider_payload(payload),
            updated_session_state=session_state,
        )

    async def ainvoke(
        self,
        messages: list[Message],
        assistant_message: Message,
        response_format: dict[str, Any] | type | None = None,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict[str, Any] | None = None,
        run_response: RunOutput | TeamRunOutput | None = None,
        compress_tool_results: bool = False,
    ) -> ModelResponse:
        return await asyncio.to_thread(
            self.invoke,
            messages,
            assistant_message,
            response_format,
            tools,
            tool_choice,
            run_response,
            compress_tool_results,
        )

    def invoke_stream(
        self,
        messages: list[Message],
        assistant_message: Message,
        response_format: dict[str, Any] | type | None = None,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict[str, Any] | None = None,
        run_response: RunOutput | TeamRunOutput | None = None,
        compress_tool_results: bool = False,
    ) -> Iterator[ModelResponse]:
        response = self.invoke(
            messages,
            assistant_message,
            response_format=response_format,
            tools=tools,
            tool_choice=tool_choice,
            run_response=run_response,
            compress_tool_results=compress_tool_results,
        )
        yield response

    async def ainvoke_stream(
        self,
        messages: list[Message],
        assistant_message: Message,
        response_format: dict[str, Any] | type | None = None,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict[str, Any] | None = None,
        run_response: RunOutput | TeamRunOutput | None = None,
        compress_tool_results: bool = False,
    ) -> AsyncIterator[ModelResponse]:
        response = await self.ainvoke(
            messages,
            assistant_message,
            response_format=response_format,
            tools=tools,
            tool_choice=tool_choice,
            run_response=run_response,
            compress_tool_results=compress_tool_results,
        )
        yield response

    def _parse_provider_response(self, response: Any, **kwargs) -> ModelResponse:
        del kwargs
        if isinstance(response, ModelResponse):
            return response
        return ModelResponse(role="assistant", content=response if isinstance(response, str) else None)

    def _parse_provider_response_delta(self, response: Any) -> ModelResponse:
        if isinstance(response, ModelResponse):
            return response
        return ModelResponse(role="assistant", content=response if isinstance(response, str) else None)
