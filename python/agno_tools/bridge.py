from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from agno.models.openai.chat import OpenAIChat
from agno.models.openai.like import OpenAILike

from .openclaude_model import OpenClaudeModel

try:
    if os.name == "nt":
        from winpty import PtyProcess  # type: ignore[import-not-found]
    else:
        PtyProcess = None
except Exception:
    PtyProcess = None

WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
PROJECT_WORKSPACE_ROOT = Path(
    os.getenv("OPENCLAUDE_TARGET_WORKSPACE") or str(WORKSPACE_ROOT)
).expanduser().resolve()
AGNO_STATE_DIR = WORKSPACE_ROOT / ".agno"
AGNO_DB_PATH = AGNO_STATE_DIR / "agentos.sqlite"
AGNO_ROUTER_CONFIG_PATH = AGNO_STATE_DIR / "router.json"
AGNO_TOPICS_PATH = AGNO_STATE_DIR / "topics.json"
AGNO_TERMINAL_HISTORY_PATH = AGNO_STATE_DIR / "terminal-history.json"
OPENCLAUDE_DIST_PATH = WORKSPACE_ROOT / "dist" / "cli.mjs"
OPENCLAUDE_PROFILE_PATH = WORKSPACE_ROOT / ".openclaude-profile.json"
OPENCLAUDE_WEB_CATALOG_PATH = WORKSPACE_ROOT / "scripts" / "openclaude-web-catalog.ts"

DEFAULT_AGENTOS_HOST = os.getenv("AGNO_HOST", "127.0.0.1")
DEFAULT_AGENTOS_PORT = int(os.getenv("AGNO_PORT", "7777"))

DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"
DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com"
DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex"
DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai"
DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1"
DEFAULT_ATOMIC_CHAT_BASE_URL = "http://127.0.0.1:1337/v1"

SUPPORTED_RUNTIME_PROFILES = (
    "anthropic",
    "openai",
    "ollama",
    "gemini",
    "codex",
    "atomic-chat",
)

PROFILE_LABELS = {
    "anthropic": "Anthropic first-party",
    "openai": "OpenAI-compatible",
    "ollama": "Ollama local",
    "gemini": "Gemini OpenAI-compatible",
    "codex": "Codex",
    "atomic-chat": "Atomic Chat local",
}

DEFAULT_PROFILE_BASE_URLS = {
    "anthropic": DEFAULT_ANTHROPIC_BASE_URL,
    "openai": DEFAULT_OPENAI_BASE_URL,
    "ollama": DEFAULT_OLLAMA_BASE_URL,
    "gemini": DEFAULT_GEMINI_BASE_URL,
    "codex": DEFAULT_CODEX_BASE_URL,
    "atomic-chat": DEFAULT_ATOMIC_CHAT_BASE_URL,
}

DEFAULT_PROFILE_MODELS = {
    "anthropic": "claude-sonnet-4-6",
    "openai": "gpt-4.1-mini",
    "ollama": "qwen2.5-coder:7b",
    "gemini": "gemini-2.0-flash",
    "codex": "codexplan",
    "atomic-chat": "llama3:8b",
}

PLATFORM_FEATURES = [
    {
        "id": "local-agent-ui",
        "label": "UI vendorizada e self-hosted",
        "enabled": True,
        "notes": "A interface roda dentro do repositório, sem dependência do painel hospedado do Agno.",
    },
    {
        "id": "session-state",
        "label": "Session state persistente",
        "enabled": True,
        "notes": "Cada chat web mantém um session_id estável do OpenClaude para continuar a conversa nativa.",
    },
    {
        "id": "sessions-storage",
        "label": "Sessões e storage locais",
        "enabled": True,
        "notes": "O AgentOS persiste sessões no SQLite local e a UI consegue reabrir runs anteriores.",
    },
    {
        "id": "knowledge-memory",
        "label": "Knowledge e memory do AgentOS",
        "enabled": False,
        "notes": "As docs do Agno suportam isso, mas ainda não ligamos essas camadas para preservar o fluxo atual do OpenClaude.",
    },
    {
        "id": "human-in-the-loop",
        "label": "Aprovação humana de tools",
        "enabled": False,
        "notes": "As docs do Agno suportam HITL, mas falta traduzir os control_request do OpenClaude para prompts web de aprovação.",
    },
]

MAX_CHANGED_FILES = 12
MAX_FULL_CHANGED_FILES = 250
MAX_PATCH_CHARS = 2400
MAX_UNTRACKED_PREVIEW_LINES = 80
MAX_TERMINAL_OUTPUT_CHARS = 16000
MAX_TERMINAL_ENTRIES = 4000
STANDARD_AGENT_ROUTING_KEYS = (
    "default",
    "Explore",
    "Plan",
    "general-purpose",
    "frontend-dev",
)
MAX_BRANCHES = 80

_ANSI_OSC_PATTERN = re.compile(r"\x1b\][^\x07]*(?:\x07|\x1b\\)")
_ANSI_CSI_PATTERN = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
_ANSI_SINGLE_PATTERN = re.compile(r"\x1b[@-_]")
_POWERSHELL_PROMPT_PATTERN = re.compile(r"PS (?P<cwd>[A-Za-z]:[^>\r\n]*)>\s*$")


def _strip_terminal_ansi(text: str) -> str:
    cleaned = _ANSI_OSC_PATTERN.sub("", text)
    cleaned = _ANSI_CSI_PATTERN.sub("", cleaned)
    cleaned = _ANSI_SINGLE_PATTERN.sub("", cleaned)
    cleaned = cleaned.replace("\x00", "")
    cleaned = cleaned.replace("\r\n", "\n").replace("\r", "\n")
    return cleaned


@dataclass
class _InteractiveTerminalSession:
    command: str
    cwd: Path
    process: Any
    buffer: list[str] = field(default_factory=list)
    lock: threading.Lock = field(default_factory=threading.Lock)
    last_output_at: float = field(default_factory=time.monotonic)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    thread: threading.Thread | None = None


_INTERACTIVE_TERMINAL_SESSION: _InteractiveTerminalSession | None = None


def _resolve_terminal_cwd() -> Path:
    workspace_root = get_project_workspace_root().resolve()
    payload = load_terminal_history_payload()
    current_cwd = Path(payload.get("cwd") or str(workspace_root)).expanduser().resolve()
    if not current_cwd.exists() or not current_cwd.is_dir():
        current_cwd = workspace_root
    return current_cwd


def ensure_state_dir() -> Path:
    AGNO_STATE_DIR.mkdir(parents=True, exist_ok=True)
    return AGNO_STATE_DIR


def get_project_workspace_root() -> Path:
    return PROJECT_WORKSPACE_ROOT


def set_project_workspace_root(path: str | Path | None) -> Path:
    global PROJECT_WORKSPACE_ROOT

    if path is None:
        _close_interactive_terminal_session()
        PROJECT_WORKSPACE_ROOT = WORKSPACE_ROOT.resolve()
        save_terminal_history_payload(
            {"entries": [], "cwd": str(PROJECT_WORKSPACE_ROOT)}
        )
        return PROJECT_WORKSPACE_ROOT

    candidate = Path(path).expanduser().resolve()
    if not candidate.exists():
        raise ValueError(f"Workspace path not found: {candidate}")
    if not candidate.is_dir():
        raise ValueError(f"Workspace path must be a directory: {candidate}")

    _close_interactive_terminal_session()
    PROJECT_WORKSPACE_ROOT = candidate
    save_terminal_history_payload(
        {"entries": [], "cwd": str(PROJECT_WORKSPACE_ROOT)}
    )
    return PROJECT_WORKSPACE_ROOT


def _trimmed(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed or None


def _pick(env: dict[str, str], *keys: str) -> str | None:
    for key in keys:
        value = _trimmed(env.get(key))
        if value:
            return value
    return None


def _is_env_truthy(key: str) -> bool:
    value = (_trimmed(os.getenv(key)) or "").lower()
    return value in {"1", "true", "yes", "on"}


def _build_default_agentos_cors() -> list[str]:
    ui_port = _trimmed(os.getenv("AGNO_UI_PORT")) or "3000"
    extra_origins = _trimmed(os.getenv("AGNO_CORS_ORIGINS"))
    origins = {
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        f"http://localhost:{ui_port}",
        f"http://127.0.0.1:{ui_port}",
    }

    if extra_origins:
        origins.update(origin.strip() for origin in extra_origins.split(",") if origin.strip())

    return sorted(origins)


DEFAULT_AGENTOS_CORS = _build_default_agentos_cors()


def mask_secret(value: str | None) -> str | None:
    sanitized = _trimmed(value)
    if not sanitized:
        return None

    if len(sanitized) <= 8:
        return "configured"

    if sanitized.startswith("sk-"):
        return f"{sanitized[:3]}...{sanitized[-4:]}"

    if sanitized.startswith("AIza"):
        return f"{sanitized[:4]}...{sanitized[-4:]}"

    return f"{sanitized[:2]}...{sanitized[-4:]}"


def _normalize_chat_base_url(profile: str, base_url: str | None) -> str:
    default_url = DEFAULT_PROFILE_BASE_URLS.get(profile, DEFAULT_OPENAI_BASE_URL)
    normalized = _trimmed(base_url) or default_url

    if profile in {"ollama", "atomic-chat"}:
        if normalized.endswith("/v1"):
            return normalized
        return normalized.rstrip("/") + "/v1"

    return normalized


def _service_root_from_chat_base(base_url: str) -> str:
    return base_url[:-3] if base_url.endswith("/v1") else base_url.rstrip("/")


def _is_ollama_base_url(base_url: str | None) -> bool:
    value = (_trimmed(base_url) or "").lower()
    return "11434" in value or "ollama" in value


def _is_atomic_chat_base_url(base_url: str | None) -> bool:
    value = (_trimmed(base_url) or "").lower()
    return "1337" in value or "atomic" in value


def _looks_like_codex_base_url(base_url: str | None) -> bool:
    value = (_trimmed(base_url) or "").lower()
    return "chatgpt.com/backend-api/codex" in value


def get_openclaude_config_home_dir() -> Path:
    explicit = _trimmed(os.getenv("CLAUDE_CONFIG_DIR"))
    if explicit:
        return Path(explicit).expanduser()

    new_default = Path.home() / ".openclaude"
    legacy_path = Path.home() / ".claude"
    if not new_default.exists() and legacy_path.exists():
        return legacy_path
    return new_default


def get_openclaude_credentials_path() -> Path:
    return get_openclaude_config_home_dir() / ".credentials.json"


def get_openclaude_settings_path() -> Path:
    filename = "cowork_settings.json" if _is_env_truthy("CLAUDE_CODE_USE_COWORK_PLUGINS") else "settings.json"
    return get_openclaude_config_home_dir() / filename


def load_openclaude_settings() -> dict[str, Any]:
    return _read_json_file(get_openclaude_settings_path(), {})


def save_openclaude_settings(settings: dict[str, Any]) -> dict[str, Any]:
    settings_path = get_openclaude_settings_path()
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    settings_path.write_text(
        json.dumps(settings, indent=2),
        encoding="utf-8",
    )
    return settings


def load_claude_code_credentials() -> dict[str, Any] | None:
    credentials_path = get_openclaude_credentials_path()
    if not credentials_path.exists():
        return None

    try:
        data = json.loads(credentials_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None

    if not isinstance(data, dict):
        return None

    return data


def load_claude_code_oauth_tokens() -> dict[str, Any] | None:
    credentials = load_claude_code_credentials()
    if not credentials:
        return None

    oauth_data = credentials.get("claudeAiOauth")
    if not isinstance(oauth_data, dict):
        return None

    access_token = _trimmed(oauth_data.get("accessToken"))
    if not access_token:
        return None

    scopes = oauth_data.get("scopes")
    return {
        "accessToken": access_token,
        "refreshToken": _trimmed(oauth_data.get("refreshToken")),
        "expiresAt": oauth_data.get("expiresAt"),
        "scopes": scopes if isinstance(scopes, list) else [],
        "subscriptionType": oauth_data.get("subscriptionType"),
        "rateLimitTier": oauth_data.get("rateLimitTier"),
    }


def _resolve_anthropic_api_key(env: dict[str, str]) -> str | None:
    return _pick(env, "ANTHROPIC_API_KEY")


def _resolve_anthropic_auth_token(env: dict[str, str]) -> str | None:
    return _pick(env, "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN") or _trimmed(
        (load_claude_code_oauth_tokens() or {}).get("accessToken")
    )


def load_openclaude_profile_file() -> dict[str, Any] | None:
    if not OPENCLAUDE_PROFILE_PATH.exists():
        return None

    try:
        data = json.loads(OPENCLAUDE_PROFILE_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None

    if not isinstance(data, dict):
        return None

    profile = data.get("profile")
    env = data.get("env")
    if profile not in SUPPORTED_RUNTIME_PROFILES or not isinstance(env, dict):
        return None

    return {
        "profile": profile,
        "env": {
            str(key): str(value)
            for key, value in env.items()
            if isinstance(key, str) and isinstance(value, str) and value.strip()
        },
        "createdAt": data.get("createdAt"),
    }


def load_openclaude_profile_env() -> dict[str, str]:
    profile_file = load_openclaude_profile_file()
    if not profile_file:
        return {}
    return profile_file["env"]


def save_openclaude_profile_file(profile_file: dict[str, Any]) -> dict[str, Any]:
    OPENCLAUDE_PROFILE_PATH.write_text(
        json.dumps(profile_file, indent=2),
        encoding="utf-8",
    )
    return profile_file


def load_router_config() -> dict[str, Any]:
    if not AGNO_ROUTER_CONFIG_PATH.exists():
        return {"mode": "inherit"}

    try:
        data = json.loads(AGNO_ROUTER_CONFIG_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"mode": "inherit"}

    if not isinstance(data, dict):
        return {"mode": "inherit"}

    mode = data.get("mode")
    if mode not in {"inherit", "explicit"}:
        mode = "inherit"

    return {
        "mode": mode,
        "model_id": _trimmed(data.get("model_id")),
        "base_url": _trimmed(data.get("base_url")),
        "api_key": _trimmed(data.get("api_key")),
        "provider_name": _trimmed(data.get("provider_name")) or "OpenAI-Compatible",
        "updated_at": data.get("updated_at"),
    }


def save_router_config(config: dict[str, Any]) -> dict[str, Any]:
    ensure_state_dir()

    mode = config.get("mode")
    if mode not in {"inherit", "explicit"}:
        mode = "inherit"

    payload = {
        "mode": mode,
        "model_id": _trimmed(config.get("model_id")),
        "base_url": _trimmed(config.get("base_url")),
        "api_key": _trimmed(config.get("api_key")),
        "provider_name": _trimmed(config.get("provider_name")) or "OpenAI-Compatible",
        "updated_at": _trimmed(config.get("updated_at"))
        or datetime.now(timezone.utc).isoformat(),
    }

    AGNO_ROUTER_CONFIG_PATH.write_text(
        json.dumps(payload, indent=2),
        encoding="utf-8",
    )
    return payload


def merged_runtime_env() -> dict[str, str]:
    merged = load_openclaude_profile_env()
    for key, value in os.environ.items():
        if value:
            merged[key] = value
    return merged


def infer_runtime_profile(
    env: dict[str, str] | None = None,
    profile_file: dict[str, Any] | None = None,
) -> str:
    if profile_file and profile_file.get("profile") in SUPPORTED_RUNTIME_PROFILES:
        return str(profile_file["profile"])

    merged = env or merged_runtime_env()
    base_url = _pick(merged, "OPENAI_BASE_URL", "GEMINI_BASE_URL")

    if _pick(merged, "CLAUDE_CODE_USE_GEMINI", "GEMINI_MODEL", "GEMINI_BASE_URL"):
        return "gemini"
    if _pick(merged, "CODEX_API_KEY", "CHATGPT_ACCOUNT_ID", "CODEX_ACCOUNT_ID") or _looks_like_codex_base_url(base_url):
        return "codex"
    if _is_atomic_chat_base_url(base_url):
        return "atomic-chat"
    if _is_ollama_base_url(base_url):
        return "ollama"
    if _pick(
        merged,
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "CLAUDE_CODE_OAUTH_TOKEN",
        "ANTHROPIC_MODEL",
        "ANTHROPIC_BASE_URL",
    ) or load_claude_code_oauth_tokens():
        return "anthropic"
    return "openai"


def build_runtime_profile_payload(config: dict[str, Any]) -> dict[str, Any]:
    existing = load_openclaude_profile_file() or {}
    existing_env = existing.get("env", {}) if isinstance(existing.get("env"), dict) else {}

    profile = str(config.get("profile") or infer_runtime_profile())
    if profile not in SUPPORTED_RUNTIME_PROFILES:
        raise ValueError(f"Unsupported runtime profile: {profile}")

    env: dict[str, str] = {}

    if profile == "gemini":
        env["GEMINI_AUTH_MODE"] = str(
            config.get("gemini_auth_mode")
            or existing_env.get("GEMINI_AUTH_MODE")
            or "api-key"
        )
        env["GEMINI_MODEL"] = str(
            config.get("model")
            or existing_env.get("GEMINI_MODEL")
            or DEFAULT_PROFILE_MODELS["gemini"]
        )
        env["GEMINI_BASE_URL"] = _normalize_chat_base_url(
            "gemini",
            str(config.get("base_url") or existing_env.get("GEMINI_BASE_URL") or DEFAULT_GEMINI_BASE_URL),
        )
        api_key = _trimmed(config.get("api_key")) or _trimmed(
            existing_env.get("GEMINI_API_KEY") or existing_env.get("GOOGLE_API_KEY")
        )
        if env["GEMINI_AUTH_MODE"] == "api-key" and api_key:
            env["GEMINI_API_KEY"] = api_key
    elif profile == "codex":
        env["OPENAI_BASE_URL"] = _normalize_chat_base_url(
            "codex",
            str(config.get("base_url") or existing_env.get("OPENAI_BASE_URL") or DEFAULT_CODEX_BASE_URL),
        )
        env["OPENAI_MODEL"] = str(
            config.get("model")
            or existing_env.get("OPENAI_MODEL")
            or DEFAULT_PROFILE_MODELS["codex"]
        )
        codex_key = _trimmed(config.get("api_key")) or _trimmed(existing_env.get("CODEX_API_KEY"))
        if codex_key:
            env["CODEX_API_KEY"] = codex_key
        account_id = _trimmed(config.get("chatgpt_account_id")) or _trimmed(
            existing_env.get("CHATGPT_ACCOUNT_ID") or existing_env.get("CODEX_ACCOUNT_ID")
        )
        if account_id:
            env["CHATGPT_ACCOUNT_ID"] = account_id
    elif profile == "anthropic":
        env["ANTHROPIC_BASE_URL"] = _normalize_chat_base_url(
            "anthropic",
            str(
                config.get("base_url")
                or existing_env.get("ANTHROPIC_BASE_URL")
                or DEFAULT_ANTHROPIC_BASE_URL
            ),
        )
        env["ANTHROPIC_MODEL"] = str(
            config.get("model")
            or existing_env.get("ANTHROPIC_MODEL")
            or DEFAULT_PROFILE_MODELS["anthropic"]
        )
        api_key = _trimmed(config.get("api_key")) or _trimmed(existing_env.get("ANTHROPIC_API_KEY"))
        if api_key:
            env["ANTHROPIC_API_KEY"] = api_key
    else:
        env["OPENAI_BASE_URL"] = _normalize_chat_base_url(
            profile,
            str(
                config.get("base_url")
                or existing_env.get("OPENAI_BASE_URL")
                or DEFAULT_PROFILE_BASE_URLS[profile]
            ),
        )
        env["OPENAI_MODEL"] = str(
            config.get("model")
            or existing_env.get("OPENAI_MODEL")
            or DEFAULT_PROFILE_MODELS[profile]
        )

        if profile == "openai":
            api_key = _trimmed(config.get("api_key")) or _trimmed(existing_env.get("OPENAI_API_KEY"))
            if api_key:
                env["OPENAI_API_KEY"] = api_key

    return {
        "profile": profile,
        "env": env,
        "createdAt": existing.get("createdAt") or datetime.now(timezone.utc).isoformat(),
    }


def persist_runtime_profile(config: dict[str, Any]) -> dict[str, Any]:
    payload = build_runtime_profile_payload(config)
    payload["createdAt"] = _trimmed(config.get("created_at")) or datetime.now(timezone.utc).isoformat()
    return save_openclaude_profile_file(payload)


def persist_router_profile(config: dict[str, Any]) -> dict[str, Any]:
    existing = load_router_config()
    payload = {
        "mode": config.get("mode") or existing.get("mode") or "inherit",
        "model_id": config.get("model_id") or existing.get("model_id"),
        "base_url": config.get("base_url") or existing.get("base_url"),
        "provider_name": config.get("provider_name") or existing.get("provider_name"),
        "api_key": config.get("api_key") or existing.get("api_key"),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    return save_router_config(payload)


def _build_openai_like_model(
    *,
    model_id: str,
    base_url: str,
    api_key: str | None,
    provider_name: str,
) -> OpenAILike:
    token = api_key or "local"
    return OpenAILike(
        id=model_id,
        base_url=base_url,
        api_key=token,
        provider=provider_name,
        temperature=0,
        max_tokens=4096,
    )


def _build_claude_model(
    *,
    model_id: str,
    base_url: str,
    api_key: str | None,
    auth_token: str | None,
) -> Any:
    try:
        from agno.models.anthropic.claude import Claude
    except ImportError as exc:
        raise RuntimeError(
            "Anthropic support is not installed in the Agno environment. Re-run the bootstrap so python/requirements.txt installs `anthropic`."
        ) from exc

    client_params: dict[str, Any] | None = None
    if _trimmed(base_url) and base_url != DEFAULT_ANTHROPIC_BASE_URL:
        client_params = {"base_url": base_url}

    return Claude(
        id=model_id,
        api_key=api_key,
        auth_token=auth_token,
        client_params=client_params,
        temperature=0,
        max_tokens=4096,
    )


def resolve_agno_model() -> Any:
    router_config = load_router_config()
    if (
        router_config.get("mode") == "explicit"
        and router_config.get("model_id")
        and router_config.get("base_url")
    ):
        return _build_openai_like_model(
            model_id=str(router_config["model_id"]),
            base_url=str(router_config["base_url"]),
            api_key=_trimmed(router_config.get("api_key")),
            provider_name=str(router_config.get("provider_name") or "OpenAI-Compatible"),
        )

    env = merged_runtime_env()
    runtime_profile = infer_runtime_profile(env)
    runtime_snapshot = get_runtime_profile_snapshot()

    explicit_model_id = _pick(env, "AGNO_MODEL_ID", "AGNO_MODEL")
    explicit_base_url = _pick(env, "AGNO_BASE_URL")
    explicit_api_key = _pick(env, "AGNO_API_KEY")
    if explicit_model_id and explicit_base_url:
        return _build_openai_like_model(
            model_id=explicit_model_id,
            base_url=explicit_base_url,
            api_key=explicit_api_key,
            provider_name="OpenAI-Compatible",
        )

    if runtime_profile in SUPPORTED_RUNTIME_PROFILES:
        return OpenClaudeModel(
            id=str(runtime_snapshot.get("model") or DEFAULT_PROFILE_MODELS[runtime_profile]),
            name="OpenClaude Runtime",
            provider=PROFILE_LABELS.get(runtime_profile, "OpenClaude Runtime"),
            provider_name=PROFILE_LABELS.get(runtime_profile, "OpenClaude Runtime"),
            base_url=_trimmed(runtime_snapshot.get("base_url")),
            runtime_env=env,
            workspace_root=get_project_workspace_root(),
            cli_path=OPENCLAUDE_DIST_PATH,
            projects_dir=get_openclaude_config_home_dir() / "projects",
        )

    profile_openai_base = _pick(env, "OPENAI_BASE_URL")
    profile_openai_model = _pick(env, "OPENAI_MODEL")
    profile_openai_key = _pick(env, "OPENAI_API_KEY", "CODEX_API_KEY")
    if profile_openai_base and profile_openai_model:
        return _build_openai_like_model(
            model_id=profile_openai_model,
            base_url=profile_openai_base,
            api_key=profile_openai_key,
            provider_name=f"{PROFILE_LABELS.get(runtime_profile, 'OpenAI-Compatible')} runtime",
        )

    profile_gemini_base = _pick(env, "GEMINI_BASE_URL")
    profile_gemini_model = _pick(env, "GEMINI_MODEL")
    profile_gemini_key = _pick(env, "GEMINI_API_KEY", "GOOGLE_API_KEY")
    if profile_gemini_base and profile_gemini_model:
        return _build_openai_like_model(
            model_id=profile_gemini_model,
            base_url=profile_gemini_base,
            api_key=profile_gemini_key,
            provider_name="Gemini OpenAI-Compatible",
        )

    openai_key = _pick(env, "OPENAI_API_KEY")
    openai_model = _pick(env, "OPENAI_MODEL", "AGNO_MODEL", "AGNO_MODEL_ID")
    if openai_key and openai_model:
        return OpenAIChat(
            id=openai_model,
            api_key=openai_key,
            temperature=0,
            max_tokens=4096,
        )

    fallback_base_url = _pick(env, "AGNO_LOCAL_BASE_URL") or DEFAULT_OLLAMA_BASE_URL
    fallback_model = _pick(env, "AGNO_LOCAL_MODEL", "OPENAI_MODEL") or DEFAULT_PROFILE_MODELS["ollama"]
    fallback_key = _pick(env, "AGNO_LOCAL_API_KEY", "OPENAI_API_KEY") or "ollama"
    return _build_openai_like_model(
        model_id=fallback_model,
        base_url=fallback_base_url,
        api_key=fallback_key,
        provider_name="Local OpenAI-Compatible",
    )


def resolve_workspace_path(
    path: str,
    *,
    allow_missing: bool = False,
    base_dir: Path | None = None,
) -> Path:
    root = (base_dir or get_project_workspace_root()).resolve()
    candidate = (root / path).resolve()

    if candidate != root and root not in candidate.parents:
        raise ValueError(f"Path escapes workspace: {path}")

    if not allow_missing and not candidate.exists():
        raise FileNotFoundError(f"Path not found: {path}")

    return candidate


def _camel_to_label(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", " ", name).replace("  ", " ").strip()


def list_openclaude_tools() -> list[dict[str, str]]:
    tools_dir = WORKSPACE_ROOT / "src" / "tools"
    if not tools_dir.exists():
        return []

    items: list[dict[str, str]] = []
    for entry in sorted(tools_dir.iterdir(), key=lambda item: item.name.lower()):
        if not entry.is_dir() or entry.name in {"shared", "testing"}:
            continue
        items.append(
            {
                "id": entry.name,
                "name": entry.name,
                "label": _camel_to_label(entry.name),
                "source": "openclaude-native",
            }
        )
    return items


def _read_json_file(path: Path, fallback: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return fallback

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return fallback

    return data if isinstance(data, dict) else fallback


def _write_json_file(path: Path, payload: dict[str, Any]) -> dict[str, Any]:
    ensure_state_dir()
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


def load_terminal_history_payload() -> dict[str, Any]:
    workspace_root = get_project_workspace_root().resolve()
    data = _read_json_file(
        AGNO_TERMINAL_HISTORY_PATH,
        {
            "entries": [],
            "cwd": str(workspace_root),
            "workspace_root": str(workspace_root),
        },
    )
    entries = data.get("entries")
    if not isinstance(entries, list):
        entries = []

    saved_workspace_root = _trimmed(data.get("workspace_root"))
    raw_cwd = _trimmed(data.get("cwd"))
    cwd_path = workspace_root
    if saved_workspace_root == str(workspace_root) and raw_cwd:
        candidate = Path(raw_cwd).expanduser().resolve()
        if candidate.exists() and candidate.is_dir():
            cwd_path = candidate

    return {
        "entries": entries[-MAX_TERMINAL_ENTRIES:],
        "cwd": str(cwd_path),
        "workspace_root": str(workspace_root),
    }


def save_terminal_history_payload(payload: dict[str, Any]) -> dict[str, Any]:
    entries = payload.get("entries")
    normalized_entries = entries if isinstance(entries, list) else []
    workspace_root = get_project_workspace_root().resolve()
    raw_cwd = _trimmed(payload.get("cwd")) or str(workspace_root)
    cwd_path = workspace_root
    candidate = Path(raw_cwd).expanduser().resolve()
    if candidate.exists() and candidate.is_dir():
        cwd_path = candidate

    return _write_json_file(
        AGNO_TERMINAL_HISTORY_PATH,
        {
            "entries": normalized_entries[-MAX_TERMINAL_ENTRIES:],
            "cwd": str(cwd_path),
            "workspace_root": str(workspace_root),
        },
    )


def _append_terminal_entries(*entries: dict[str, Any], cwd: str | Path | None = None) -> dict[str, Any]:
    payload = load_terminal_history_payload()
    history = payload["entries"]
    history.extend(entries)
    next_cwd = str(cwd) if cwd is not None else payload.get("cwd")
    return save_terminal_history_payload({"entries": history, "cwd": next_cwd})


def _close_interactive_terminal_session() -> None:
    global _INTERACTIVE_TERMINAL_SESSION

    session = _INTERACTIVE_TERMINAL_SESSION
    _INTERACTIVE_TERMINAL_SESSION = None
    if not session:
        return

    process = session.process
    try:
        if process and process.isalive():
            process.terminate()
    except Exception:
        pass


def _get_active_terminal_session() -> _InteractiveTerminalSession | None:
    global _INTERACTIVE_TERMINAL_SESSION

    session = _INTERACTIVE_TERMINAL_SESSION
    if not session:
        return None

    try:
        alive = bool(session.process and session.process.isalive())
    except Exception:
        alive = False

    if alive:
        return session

    _close_interactive_terminal_session()
    return None

    try:
        if process:
            process.close()
    except Exception:
        pass


def _interactive_reader_loop(session: _InteractiveTerminalSession) -> None:
    process = session.process
    while True:
        try:
            chunk = process.read(1024)
        except EOFError:
            break
        except Exception:
            break

        if not chunk:
            continue

        with session.lock:
            session.buffer.append(str(chunk))
            session.last_output_at = time.monotonic()


def _build_interactive_terminal_invocation(command: str) -> list[str]:
    if os.name == "nt":
        return ["powershell.exe", "-NoLogo", "-NoProfile", "-Command", command]

    shell = os.getenv("SHELL") or "/bin/bash"
    return [shell, "-lc", command]


def _spawn_interactive_terminal_session(
    command: str, cwd: Path
) -> _InteractiveTerminalSession:
    if PtyProcess is None:
        raise ValueError("Interactive terminal support is not available in this build.")

    env = os.environ.copy()
    normalized_command = (_trimmed(command) or "").lower()
    if normalized_command in {"openclaude", "claude"} or normalized_command.startswith(
        ("openclaude ", "claude ")
    ):
        env["OPENCLAUDE_EMBEDDED_TERMINAL_SESSION"] = "1"

    process = PtyProcess.spawn(
        _build_interactive_terminal_invocation(command),
        cwd=str(cwd),
        env=env,
        dimensions=(30, 120),
    )
    session = _InteractiveTerminalSession(command=command, cwd=cwd, process=process)
    session.thread = threading.Thread(
        target=_interactive_reader_loop,
        args=(session,),
        name="openclaude-terminal-reader",
        daemon=True,
    )
    session.thread.start()
    return session


def _spawn_terminal_shell_session(cwd: Path) -> _InteractiveTerminalSession:
    if PtyProcess is None:
        raise ValueError("Interactive terminal support is not available in this build.")

    if os.name == "nt":
        argv = ["powershell.exe", "-NoLogo"]
    else:
        argv = [os.getenv("SHELL") or "/bin/bash"]

    process = PtyProcess.spawn(
        argv,
        cwd=str(cwd),
        env=os.environ.copy(),
        dimensions=(30, 120),
    )
    session = _InteractiveTerminalSession(command="", cwd=cwd, process=process)
    session.thread = threading.Thread(
        target=_interactive_reader_loop,
        args=(session,),
        name="openclaude-terminal-shell-reader",
        daemon=True,
    )
    session.thread.start()
    return session


def _collect_interactive_terminal_output(
    session: _InteractiveTerminalSession,
    *,
    max_wait_seconds: float = 4.0,
    quiet_seconds: float = 0.25,
    min_wait_seconds: float = 0.0,
) -> str:
    deadline = time.monotonic() + max_wait_seconds
    earliest_break = time.monotonic() + min_wait_seconds
    observed_output = False

    while time.monotonic() < deadline:
        with session.lock:
            has_output = bool(session.buffer)
            last_output_at = session.last_output_at

        if has_output:
            observed_output = True
            if (
                time.monotonic() >= earliest_break
                and time.monotonic() - last_output_at >= quiet_seconds
            ):
                break
        elif observed_output and time.monotonic() >= earliest_break:
            break

        time.sleep(0.05)

    with session.lock:
        combined = "".join(session.buffer)
        session.buffer.clear()

    cleaned = _strip_terminal_ansi(combined)
    cleaned = cleaned.replace("\n\n\n", "\n\n")
    return cleaned.strip()


def _drain_interactive_terminal_output(
    session: _InteractiveTerminalSession,
    *,
    max_wait_seconds: float = 0.35,
    quiet_seconds: float = 0.08,
    min_wait_seconds: float = 0.0,
) -> tuple[str, str]:
    deadline = time.monotonic() + max_wait_seconds
    earliest_break = time.monotonic() + min_wait_seconds
    observed_output = False

    while time.monotonic() < deadline:
        with session.lock:
            has_output = bool(session.buffer)
            last_output_at = session.last_output_at

        if has_output:
            observed_output = True
            if (
                time.monotonic() >= earliest_break
                and time.monotonic() - last_output_at >= quiet_seconds
            ):
                break
        elif observed_output and time.monotonic() >= earliest_break:
            break

        time.sleep(0.03)

    with session.lock:
        raw_output = "".join(session.buffer)
        session.buffer.clear()

    cleaned_output = _strip_terminal_ansi(raw_output).replace("\n\n\n", "\n\n")
    return raw_output, cleaned_output.strip()


def _ensure_terminal_shell_session(cwd: Path) -> _InteractiveTerminalSession | None:
    global _INTERACTIVE_TERMINAL_SESSION

    if PtyProcess is None:
        return None

    session = _get_active_terminal_session()
    if session and session.command:
        return session

    if session is None or session.cwd != cwd:
        _close_interactive_terminal_session()
        session = _spawn_terminal_shell_session(cwd)
        _INTERACTIVE_TERMINAL_SESSION = session
        _flush_terminal_shell_output(session, max_wait_seconds=1.75, min_wait_seconds=0.4)

    return session


def _flush_terminal_shell_output(
    session: _InteractiveTerminalSession,
    *,
    max_wait_seconds: float = 0.35,
    min_wait_seconds: float = 0.0,
) -> None:
    raw_output, cleaned_output = _drain_interactive_terminal_output(
        session,
        max_wait_seconds=max_wait_seconds,
        min_wait_seconds=min_wait_seconds,
    )
    if not raw_output:
        return

    next_cwd = _extract_prompt_cwd_from_output(cleaned_output) or session.cwd
    session.cwd = next_cwd
    if session.command:
        entry_text = raw_output
        is_raw = True
    else:
        entry_text = cleaned_output
        is_raw = False

    if not entry_text:
        return
    _append_terminal_entries(
        {
            "id": str(uuid.uuid4()),
            "kind": "output",
            "text": entry_text,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "raw": is_raw,
        },
        cwd=next_cwd,
    )


def _extract_prompt_cwd_from_output(output: str) -> Path | None:
    if not output:
        return None

    matches = list(_POWERSHELL_PROMPT_PATTERN.finditer(output))
    if not matches:
        return None

    candidate = _trimmed(matches[-1].group("cwd"))
    if not candidate:
        return None

    candidate_path = Path(candidate).expanduser().resolve()
    if candidate_path.exists() and candidate_path.is_dir():
        return candidate_path
    return None


def _should_use_interactive_terminal_session(command: str) -> bool:
    return os.name == "nt" and PtyProcess is not None and _is_interactive_terminal_command(command)


def _normalize_agent_models(raw_value: Any) -> dict[str, dict[str, str]]:
    if not isinstance(raw_value, dict):
        return {}

    normalized: dict[str, dict[str, str]] = {}
    for raw_name, raw_config in raw_value.items():
        name = _trimmed(str(raw_name) if raw_name is not None else None)
        if not name or not isinstance(raw_config, dict):
            continue

        base_url = _trimmed(raw_config.get("base_url"))
        if not base_url:
            continue

        api_key = raw_config.get("api_key")
        normalized[name] = {
            "base_url": base_url,
            "api_key": api_key.strip() if isinstance(api_key, str) else "",
        }

    return dict(sorted(normalized.items(), key=lambda item: item[0].lower()))


def _normalize_agent_routing(raw_value: Any) -> dict[str, str]:
    if not isinstance(raw_value, dict):
        return {}

    normalized: dict[str, str] = {}
    for raw_key, raw_model in raw_value.items():
        key = _trimmed(str(raw_key) if raw_key is not None else None)
        model_name = _trimmed(str(raw_model) if raw_model is not None else None)
        if not key or not model_name:
            continue
        normalized[key] = model_name

    def routing_sort(item: tuple[str, str]) -> tuple[int, str]:
        key = item[0]
        try:
            return (STANDARD_AGENT_ROUTING_KEYS.index(key), key.lower())
        except ValueError:
            return (len(STANDARD_AGENT_ROUTING_KEYS), key.lower())

    return dict(sorted(normalized.items(), key=routing_sort))


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "topic"


def _run_git(
    args: list[str],
    *,
    cwd: Path | None = None,
    timeout_seconds: int = 10,
) -> str | None:
    try:
        completed = subprocess.run(
            ["git", *args],
            cwd=str((cwd or get_project_workspace_root()).resolve()),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_seconds,
        )
    except Exception:
        return None

    if completed.returncode != 0:
        return None

    output = completed.stdout.strip()
    return output or None


def _parse_diff_stats(diff_output: str | None) -> dict[str, dict[str, int | None]]:
    stats: dict[str, dict[str, int | None]] = {}
    if not diff_output:
        return stats

    for line in diff_output.splitlines():
        parts = line.split("\t", 2)
        if len(parts) != 3:
            continue

        insertions_raw, deletions_raw, path = parts
        path_key = path.rsplit(" -> ", 1)[-1].strip()
        stats[path_key] = {
            "insertions": None if insertions_raw == "-" else int(insertions_raw),
            "deletions": None if deletions_raw == "-" else int(deletions_raw),
        }

    return stats


def _status_to_kind(staged_status: str, unstaged_status: str) -> str:
    statuses = {staged_status, unstaged_status}

    if "?" in statuses:
        return "untracked"
    if "R" in statuses:
        return "renamed"
    if "D" in statuses:
        return "deleted"
    if "A" in statuses:
        return "added"
    if "M" in statuses:
        return "modified"

    return "changed"


def _merge_file_stats(
    cached_stats: dict[str, int | None] | None,
    unstaged_stats: dict[str, int | None] | None,
) -> dict[str, int | None]:
    insertions_values = [
        value
        for value in (
            (cached_stats or {}).get("insertions"),
            (unstaged_stats or {}).get("insertions"),
        )
        if isinstance(value, int)
    ]
    deletions_values = [
        value
        for value in (
            (cached_stats or {}).get("deletions"),
            (unstaged_stats or {}).get("deletions"),
        )
        if isinstance(value, int)
    ]

    return {
        "insertions": sum(insertions_values) if insertions_values else None,
        "deletions": sum(deletions_values) if deletions_values else None,
    }


def _read_untracked_preview(path: Path) -> tuple[str | None, bool]:
    if not path.is_file():
        return None, False

    try:
        content = path.read_text(encoding="utf-8")
    except Exception:
        return None, False

    lines = content.splitlines()
    visible_lines = lines[:MAX_UNTRACKED_PREVIEW_LINES]
    preview = "\n".join(visible_lines).strip()
    if not preview:
        return None, False

    truncated = len(lines) > MAX_UNTRACKED_PREVIEW_LINES or len(preview) > MAX_PATCH_CHARS
    if len(preview) > MAX_PATCH_CHARS:
        preview = preview[:MAX_PATCH_CHARS].rstrip() + "\n... preview truncated"

    return preview, truncated


def _build_patch_preview(
    *,
    repo_root: Path,
    relative_path: str,
    staged_status: str,
    unstaged_status: str,
    kind: str,
) -> tuple[str | None, bool]:
    if kind == "untracked":
        return _read_untracked_preview(repo_root / relative_path)

    fragments: list[str] = []
    if staged_status not in {" ", "?"}:
        staged_patch = _run_git(
            ["diff", "--cached", "--no-ext-diff", "--unified=3", "--", relative_path],
            cwd=repo_root,
        )
        if staged_patch:
            fragments.append(staged_patch)

    if unstaged_status not in {" ", "?"}:
        unstaged_patch = _run_git(
            ["diff", "--no-ext-diff", "--unified=3", "--", relative_path],
            cwd=repo_root,
        )
        if unstaged_patch:
            fragments.append(unstaged_patch)

    if not fragments:
        return None, False

    combined = "\n\n".join(fragment for fragment in fragments if fragment).strip()
    if not combined:
        return None, False

    truncated = len(combined) > MAX_PATCH_CHARS
    if truncated:
        combined = combined[:MAX_PATCH_CHARS].rstrip() + "\n... patch truncated"

    return combined, truncated


def _build_workspace_context(max_changed_files: int | None = MAX_CHANGED_FILES) -> dict[str, Any]:
    workspace_root = get_project_workspace_root()
    repo_root_value = _run_git(["rev-parse", "--show-toplevel"], cwd=workspace_root)
    topics = list_topics()

    if not repo_root_value:
        return {
            "workspace_root": str(workspace_root),
            "project_root": str(workspace_root),
            "project_label": workspace_root.name,
            "repo_root": None,
            "repo_name": workspace_root.name,
            "origin_url": None,
            "branch": None,
            "head": None,
            "upstream": None,
            "ahead": 0,
            "behind": 0,
            "is_git_repo": False,
            "is_dirty": False,
            "changed_file_count": 0,
            "total_insertions": 0,
            "total_deletions": 0,
            "staged_file_count": 0,
            "unstaged_file_count": 0,
            "untracked_file_count": 0,
            "topic_count": len(topics),
            "changed_files": [],
        }

    repo_root = Path(repo_root_value).resolve()
    repo_name = repo_root.name
    branch_name = _run_git(["branch", "--show-current"], cwd=repo_root)
    head = _run_git(["rev-parse", "--short", "HEAD"], cwd=repo_root)
    origin_url = _run_git(["remote", "get-url", "origin"], cwd=repo_root)
    status_output = _run_git(["status", "--porcelain=v1", "--branch", "--untracked-files=all"], cwd=repo_root) or ""
    numstat = _parse_diff_stats(_run_git(["diff", "--numstat"], cwd=repo_root))
    cached_numstat = _parse_diff_stats(_run_git(["diff", "--cached", "--numstat"], cwd=repo_root))

    branch = branch_name
    upstream = None
    ahead = 0
    behind = 0

    total_insertions = 0
    total_deletions = 0
    staged_file_count = 0
    unstaged_file_count = 0
    untracked_file_count = 0
    changed_files: list[dict[str, Any]] = []
    status_lines = status_output.splitlines()
    if status_lines and status_lines[0].startswith("## "):
        branch_info = status_lines[0][3:]
        branch_part, separator, tracking_info = branch_info.partition("...")
        if branch_part and branch_part != "HEAD (no branch)":
            branch = branch_part

        if separator and tracking_info:
            upstream = tracking_info
            tracking_meta = ""
            if " [" in tracking_info:
                upstream, _, tracking_meta = tracking_info.partition(" [")
                tracking_meta = tracking_meta.rstrip("]")
            for item in tracking_meta.split(", "):
                if item.startswith("ahead "):
                    ahead = int(item.replace("ahead ", "") or "0")
                elif item.startswith("behind "):
                    behind = int(item.replace("behind ", "") or "0")

        status_lines = status_lines[1:]

    for line in status_lines:
        if len(line) < 3:
            continue

        staged_status = line[0]
        unstaged_status = line[1]
        relative_path = line[3:].strip().rsplit(" -> ", 1)[-1]
        if not relative_path:
            continue

        kind = _status_to_kind(staged_status, unstaged_status)
        if staged_status != " ":
            staged_file_count += 1
        if unstaged_status != " ":
            unstaged_file_count += 1
        if kind == "untracked":
            untracked_file_count += 1
        stats = _merge_file_stats(
            cached_numstat.get(relative_path),
            numstat.get(relative_path),
        )
        if isinstance(stats.get("insertions"), int):
            total_insertions += int(stats["insertions"])
        if isinstance(stats.get("deletions"), int):
            total_deletions += int(stats["deletions"])

        if max_changed_files is not None and len(changed_files) >= max_changed_files:
            continue

        patch_preview, patch_truncated = _build_patch_preview(
            repo_root=repo_root,
            relative_path=relative_path,
            staged_status=staged_status,
            unstaged_status=unstaged_status,
            kind=kind,
        )
        changed_files.append(
            {
                "path": relative_path,
                "kind": kind,
                "tracked": kind != "untracked",
                "staged_status": None if staged_status == " " else staged_status,
                "unstaged_status": None if unstaged_status == " " else unstaged_status,
                "insertions": stats.get("insertions"),
                "deletions": stats.get("deletions"),
                "patch_preview": patch_preview,
                "patch_truncated": patch_truncated,
            }
        )

    return {
        "workspace_root": str(workspace_root),
        "project_root": str(repo_root),
        "project_label": repo_name,
        "repo_root": str(repo_root),
        "repo_name": repo_name,
        "origin_url": origin_url,
        "branch": branch,
        "head": head,
        "upstream": upstream,
        "ahead": ahead,
        "behind": behind,
        "is_git_repo": True,
        "is_dirty": bool(status_lines),
        "changed_file_count": len(status_lines),
        "total_insertions": total_insertions,
        "total_deletions": total_deletions,
        "staged_file_count": staged_file_count,
        "unstaged_file_count": unstaged_file_count,
        "untracked_file_count": untracked_file_count,
        "topic_count": len(topics),
        "changed_files": changed_files,
    }


def get_workspace_context() -> dict[str, Any]:
    return _build_workspace_context(max_changed_files=MAX_CHANGED_FILES)


def load_topics_payload() -> dict[str, Any]:
    data = _read_json_file(AGNO_TOPICS_PATH, {"topics": []})
    items = data.get("topics")
    if not isinstance(items, list):
        items = []

    normalized_topics: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue

        name = _trimmed(item.get("name"))
        if not name:
            continue

        session_ids: list[str] = []
        seen_sessions: set[str] = set()
        for session_id in item.get("session_ids", []):
            normalized_session = _trimmed(session_id)
            if normalized_session and normalized_session not in seen_sessions:
                seen_sessions.add(normalized_session)
                session_ids.append(normalized_session)

        normalized_topics.append(
            {
                "id": _trimmed(item.get("id")) or str(uuid.uuid4()),
                "name": name,
                "slug": _trimmed(item.get("slug")) or _slugify(name),
                "description": _trimmed(item.get("description")),
                "kind": _trimmed(item.get("kind")) or "custom",
                "project_root": _trimmed(item.get("project_root"))
                or str(get_project_workspace_root()),
                "repo_name": _trimmed(item.get("repo_name"))
                or get_project_workspace_root().name,
                "branch": _trimmed(item.get("branch")),
                "created_at": _trimmed(item.get("created_at"))
                or datetime.now(timezone.utc).isoformat(),
                "updated_at": _trimmed(item.get("updated_at"))
                or _trimmed(item.get("created_at"))
                or datetime.now(timezone.utc).isoformat(),
                "session_ids": session_ids,
            }
        )

    normalized_topics.sort(key=lambda topic: topic.get("updated_at") or "", reverse=True)
    return {"topics": normalized_topics}


def save_topics_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return _write_json_file(AGNO_TOPICS_PATH, payload)


def list_topics() -> list[dict[str, Any]]:
    return load_topics_payload()["topics"]


def create_topic(name: str, description: str | None = None) -> dict[str, Any]:
    normalized_name = _trimmed(name)
    if not normalized_name:
        raise ValueError("Topic name cannot be empty.")

    context = get_workspace_context()
    now = datetime.now(timezone.utc).isoformat()
    topic = {
        "id": str(uuid.uuid4()),
        "name": normalized_name,
        "slug": _slugify(normalized_name),
        "description": _trimmed(description),
        "kind": "custom",
        "project_root": context.get("project_root") or str(get_project_workspace_root()),
        "repo_name": context.get("repo_name") or get_project_workspace_root().name,
        "branch": context.get("branch"),
        "created_at": now,
        "updated_at": now,
        "session_ids": [],
    }

    payload = load_topics_payload()
    payload["topics"] = [topic, *payload["topics"]]
    save_topics_payload(payload)
    return topic


def assign_session_to_topic(topic_id: str, session_id: str) -> list[dict[str, Any]]:
    normalized_topic_id = _trimmed(topic_id)
    normalized_session_id = _trimmed(session_id)
    if not normalized_topic_id or not normalized_session_id:
        raise ValueError("Both topic_id and session_id are required.")

    payload = load_topics_payload()
    topics = payload["topics"]
    now = datetime.now(timezone.utc).isoformat()
    found_topic = False

    for topic in topics:
        session_ids = [item for item in topic.get("session_ids", []) if item != normalized_session_id]
        if topic["id"] == normalized_topic_id:
            found_topic = True
            session_ids.insert(0, normalized_session_id)
            topic["updated_at"] = now
        topic["session_ids"] = session_ids

    if not found_topic:
        raise ValueError(f"Topic not found: {normalized_topic_id}")

    save_topics_payload({"topics": topics})
    return list_topics()


def detach_session_from_topics(session_id: str) -> list[dict[str, Any]]:
    normalized_session_id = _trimmed(session_id)
    if not normalized_session_id:
        raise ValueError("session_id is required.")

    payload = load_topics_payload()
    updated = False
    now = datetime.now(timezone.utc).isoformat()

    for topic in payload["topics"]:
        session_ids = topic.get("session_ids", [])
        next_session_ids = [item for item in session_ids if item != normalized_session_id]
        if len(next_session_ids) != len(session_ids):
            topic["session_ids"] = next_session_ids
            topic["updated_at"] = now
            updated = True

    if updated:
        save_topics_payload(payload)

    return list_topics()


def resolve_workspace_topic(create_if_missing: bool = True) -> dict[str, Any] | None:
    context = get_workspace_context()
    project_root = _trimmed(context.get("project_root")) or str(get_project_workspace_root())
    repo_name = _trimmed(context.get("repo_name")) or get_project_workspace_root().name
    branch = _trimmed(context.get("branch"))

    payload = load_topics_payload()
    topics = payload["topics"]
    for topic in topics:
        same_project = _trimmed(topic.get("project_root")) == project_root
        if not same_project:
            continue

        if topic.get("kind") == "workspace" or _trimmed(topic.get("name")) == repo_name:
            topic["name"] = repo_name
            topic["slug"] = _slugify(repo_name)
            topic["project_root"] = project_root
            topic["repo_name"] = repo_name
            topic["branch"] = branch
            topic["updated_at"] = datetime.now(timezone.utc).isoformat()
            save_topics_payload(payload)
            return topic

    if not create_if_missing:
        return None

    now = datetime.now(timezone.utc).isoformat()
    topic = {
        "id": str(uuid.uuid4()),
        "name": repo_name,
        "slug": _slugify(repo_name),
        "description": "Workspace topic",
        "kind": "workspace",
        "project_root": project_root,
        "repo_name": repo_name,
        "branch": branch,
        "created_at": now,
        "updated_at": now,
        "session_ids": [],
    }
    payload["topics"] = [topic, *topics]
    save_topics_payload(payload)
    return topic


def _parse_branch_listing(raw_output: str | None, current_branch: str | None) -> list[dict[str, Any]]:
    if not raw_output:
        return []

    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for line in raw_output.splitlines():
        value = line.strip()
        if not value:
            continue

        is_remote = value.startswith("refs/remotes/")
        name = value.removeprefix("refs/heads/").removeprefix("refs/remotes/")
        if name == "origin/HEAD" or name.endswith("/HEAD"):
            continue
        if name in seen:
            continue
        seen.add(name)
        items.append(
            {
                "name": name,
                "short_name": name.split("/", 1)[-1] if is_remote else name,
                "kind": "remote" if is_remote else "local",
                "current": name == current_branch,
            }
        )

    items.sort(
        key=lambda item: (
            0 if item["current"] else 1,
            0 if item["kind"] == "local" else 1,
            item["name"].lower(),
        )
    )
    return items[:MAX_BRANCHES]


def list_git_branches() -> dict[str, Any]:
    context = get_workspace_context()
    project_root = Path(context.get("project_root") or get_project_workspace_root()).resolve()

    if not context.get("is_git_repo"):
        return {
            "items": [],
            "current_branch": None,
            "project_root": str(project_root),
            "repo_name": context.get("repo_name"),
        }

    current_branch = _trimmed(context.get("branch"))
    raw_output = _run_git(
        ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"],
        cwd=project_root,
    )
    return {
        "items": _parse_branch_listing(raw_output, current_branch),
        "current_branch": current_branch,
        "project_root": str(project_root),
        "repo_name": context.get("repo_name"),
    }


def get_workspace_bootstrap() -> dict[str, Any]:
    return {
        "workspace": get_workspace_context(),
        "topic": resolve_workspace_topic(create_if_missing=True),
        "branches": list_git_branches(),
        "topics": list_topics(),
    }


def switch_git_branch(branch_name: str) -> dict[str, Any]:
    normalized_branch = _trimmed(branch_name)
    if not normalized_branch:
        raise ValueError("branch_name is required.")

    context = get_workspace_context()
    project_root = Path(context.get("project_root") or get_project_workspace_root()).resolve()
    if not context.get("is_git_repo"):
        raise ValueError("Current workspace is not a git repository.")

    local_exists = bool(
        _run_git(["show-ref", "--verify", f"refs/heads/{normalized_branch}"], cwd=project_root)
    )
    remote_exists = bool(
        _run_git(["show-ref", "--verify", f"refs/remotes/{normalized_branch}"], cwd=project_root)
    )
    alt_remote_exists = bool(
        _run_git(
            ["show-ref", "--verify", f"refs/remotes/origin/{normalized_branch}"],
            cwd=project_root,
        )
    )

    if local_exists:
        command = ["switch", normalized_branch]
    elif remote_exists:
        command = ["switch", "--track", normalized_branch]
    elif alt_remote_exists:
        command = ["switch", "--track", f"origin/{normalized_branch}"]
    else:
        raise ValueError(f"Branch not found: {normalized_branch}")

    completed = subprocess.run(
        ["git", *command],
        cwd=str(project_root),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if completed.returncode != 0:
        raise ValueError(completed.stderr.strip() or completed.stdout.strip() or "Failed to switch branch.")

    return {
        "workspace": get_workspace_context(),
        "branches": list_git_branches(),
        "topic": resolve_workspace_topic(create_if_missing=True),
        "topics": list_topics(),
    }


def create_git_branch(branch_name: str, start_point: str | None = None, switch: bool = True) -> dict[str, Any]:
    normalized_branch = _trimmed(branch_name)
    normalized_start = _trimmed(start_point)
    if not normalized_branch:
        raise ValueError("branch_name is required.")

    context = get_workspace_context()
    project_root = Path(context.get("project_root") or get_project_workspace_root()).resolve()
    if not context.get("is_git_repo"):
        raise ValueError("Current workspace is not a git repository.")

    command = ["switch", "-c", normalized_branch]
    if normalized_start:
        command.append(normalized_start)
    if not switch:
        command = ["branch", normalized_branch]
        if normalized_start:
            command.append(normalized_start)

    completed = subprocess.run(
        ["git", *command],
        cwd=str(project_root),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if completed.returncode != 0:
        raise ValueError(completed.stderr.strip() or completed.stdout.strip() or "Failed to create branch.")

    return {
        "workspace": get_workspace_context(),
        "branches": list_git_branches(),
        "topic": resolve_workspace_topic(create_if_missing=True),
        "topics": list_topics(),
    }


def _command_exists(command: str) -> bool:
    return shutil.which(command) is not None


def _expand_candidate_path(candidate: str) -> str:
    return os.path.expandvars(candidate).expanduser() if hasattr(os.path, "expandvars") else candidate


def _resolve_launch_target_executable(candidates: list[str]) -> str | None:
    for candidate in candidates:
        expanded = os.path.expandvars(candidate)
        if os.path.isabs(expanded) and Path(expanded).exists():
            return expanded
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    return None


def get_open_with_targets() -> dict[str, Any]:
    windows_targets = [
        {
            "id": "cursor",
            "label": "Cursor",
            "description": "Abrir o workspace no Cursor.",
            "candidates": [
                "cursor",
                "cursor.cmd",
                r"%LOCALAPPDATA%\Programs\Cursor\Cursor.exe",
            ],
        },
        {
            "id": "vscode",
            "label": "VS Code",
            "description": "Abrir o workspace no Visual Studio Code.",
            "candidates": [
                "code",
                "code.cmd",
                r"%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe",
            ],
        },
        {
            "id": "terminal",
            "label": "Terminal",
            "description": "Abrir um terminal local no workspace.",
            "candidates": ["wt.exe", "powershell.exe"],
        },
        {
            "id": "git-bash",
            "label": "Git Bash",
            "description": "Abrir Git Bash no workspace.",
            "candidates": [
                "git-bash.exe",
                r"%ProgramFiles%\Git\git-bash.exe",
                r"%ProgramFiles(x86)%\Git\git-bash.exe",
            ],
        },
        {
            "id": "wsl",
            "label": "WSL",
            "description": "Abrir uma shell WSL posicionada no workspace.",
            "candidates": ["wsl.exe"],
        },
        {
            "id": "explorer",
            "label": "File Explorer",
            "description": "Abrir o diretório no Windows Explorer.",
            "candidates": ["explorer.exe"],
        },
    ]
    unix_targets = [
        {
            "id": "vscode",
            "label": "VS Code",
            "description": "Abrir o workspace no Visual Studio Code.",
            "candidates": ["code"],
        },
        {
            "id": "terminal",
            "label": "Terminal",
            "description": "Abrir um terminal local no workspace.",
            "candidates": ["x-terminal-emulator", "gnome-terminal", "konsole", "wezterm"],
        },
        {
            "id": "finder",
            "label": "Finder",
            "description": "Abrir o diretório no gerenciador de arquivos.",
            "candidates": ["open", "xdg-open"],
        },
    ]

    targets_config = windows_targets if os.name == "nt" else unix_targets
    items: list[dict[str, Any]] = []
    for item in targets_config:
        executable = _resolve_launch_target_executable(item["candidates"])
        items.append(
            {
                "id": item["id"],
                "label": item["label"],
                "description": item["description"],
                "installed": executable is not None,
                "preferred": item["id"] in {"cursor", "vscode", "explorer", "terminal"},
                "executable": executable,
            }
        )
    return {"items": items}


def launch_open_with_target(target_id: str) -> dict[str, Any]:
    normalized_target = _trimmed(target_id)
    if not normalized_target:
        raise ValueError("target_id is required.")

    targets = {item["id"]: item for item in get_open_with_targets()["items"]}
    target = targets.get(normalized_target)
    if not target or not target.get("installed"):
        raise ValueError(f"Launch target is not available: {normalized_target}")

    workspace_root = get_project_workspace_root()
    executable = str(target["executable"])

    if os.name == "nt":
        if normalized_target == "explorer":
            command = [executable, str(workspace_root)]
        elif normalized_target == "terminal":
            if executable.lower().endswith("wt.exe"):
                command = [executable, "-d", str(workspace_root)]
            else:
                command = [
                    executable,
                    "-NoExit",
                    "-Command",
                    f'Set-Location -LiteralPath "{workspace_root}"',
                ]
        elif normalized_target == "git-bash":
            command = [executable, f"--cd={workspace_root}"]
        elif normalized_target == "wsl":
            command = [executable, "--cd", str(workspace_root)]
        else:
            command = [executable, str(workspace_root)]
    else:
        if normalized_target == "finder":
            command = [executable, str(workspace_root)]
        elif normalized_target == "terminal":
            if executable.endswith("wezterm"):
                command = [executable, "start", "--cwd", str(workspace_root)]
            else:
                command = [executable, str(workspace_root)]
        else:
            command = [executable, str(workspace_root)]

    try:
        subprocess.Popen(
            command,
            cwd=str(workspace_root),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception as exc:
        raise ValueError(f"Failed to launch {target['label']}: {exc}") from exc

    return {
        "target": normalized_target,
        "label": target["label"],
        "workspace": str(workspace_root),
    }


def browse_workspace_folder(title: str | None = None) -> dict[str, Any]:
    description = _trimmed(title) or "Selecione uma pasta para criar um topico"
    workspace_root = get_project_workspace_root().resolve()

    if os.name != "nt":
        raise ValueError("Folder picker is only available on Windows in this build.")

    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception as exc:
        raise ValueError(f"Failed to load Windows folder picker: {exc}") from exc

    root = None
    try:
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        root.update_idletasks()
        selected_path = _trimmed(
            filedialog.askdirectory(
                parent=root,
                title=description,
                initialdir=str(workspace_root),
                mustexist=True,
            )
        )
    except Exception as exc:
        raise ValueError(f"Failed to open folder picker: {exc}") from exc
    finally:
        try:
            if root is not None:
                root.destroy()
        except Exception:
            pass

    return {
        "path": selected_path,
        "cancelled": not bool(selected_path),
    }


def complete_terminal_command(command: str) -> dict[str, Any]:
    raw_command = command if isinstance(command, str) else ""
    workspace_root = get_project_workspace_root().resolve()
    payload = load_terminal_history_payload()
    current_cwd = Path(payload.get("cwd") or str(workspace_root)).expanduser().resolve()
    if not current_cwd.exists() or not current_cwd.is_dir():
        current_cwd = workspace_root

    if _has_active_interactive_terminal_session(current_cwd):
        return {
            "cwd": str(current_cwd),
            "replacement_index": 0,
            "replacement_length": 0,
            "matches": [],
        }

    if os.name == "nt":
        script = "\n".join(
            [
                "$ErrorActionPreference = 'SilentlyContinue'",
                f"Set-Location -LiteralPath {json.dumps(str(current_cwd))}",
                f"$__openclaude_input = {json.dumps(raw_command)}",
                "$__openclaude_cursor = $__openclaude_input.Length",
                "$__openclaude_result = TabExpansion2 -inputScript $__openclaude_input -cursorColumn $__openclaude_cursor",
                "$__openclaude_matches = @($__openclaude_result.CompletionMatches | ForEach-Object { $_.CompletionText } | Select-Object -Unique)",
                "$__openclaude_payload = @{",
                "  cwd = (Get-Location).Path",
                "  replacement_index = $__openclaude_result.ReplacementIndex",
                "  replacement_length = $__openclaude_result.ReplacementLength",
                "  matches = $__openclaude_matches",
                "}",
                "[Console]::Out.Write(($__openclaude_payload | ConvertTo-Json -Compress -Depth 4))",
            ]
        )
        completed = subprocess.run(
            [
                "powershell.exe",
                "-NoLogo",
                "-NoProfile",
                "-WindowStyle",
                "Hidden",
                "-Command",
                script,
            ],
            cwd=str(current_cwd),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=20,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if completed.returncode != 0:
            return {
                "cwd": str(current_cwd),
                "replacement_index": 0,
                "replacement_length": 0,
                "matches": [],
            }
        try:
            data = json.loads(completed.stdout or "{}")
        except json.JSONDecodeError:
            data = {}
        matches = data.get("matches")
        return {
            "cwd": _trimmed(data.get("cwd")) or str(current_cwd),
            "replacement_index": int(data.get("replacement_index") or 0),
            "replacement_length": int(data.get("replacement_length") or 0),
            "matches": [str(item) for item in matches] if isinstance(matches, list) else [],
        }

    shell = os.getenv("SHELL") or "/bin/bash"
    escaped = raw_command.replace("'", "'\"'\"'")
    completed = subprocess.run(
        [
            shell,
            "-lc",
            f"cd {json.dumps(str(current_cwd))} && compgen -cdfa -- '{escaped}' | head -50",
        ],
        cwd=str(current_cwd),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=20,
    )
    matches = [line.strip() for line in (completed.stdout or "").splitlines() if line.strip()]
    return {
        "cwd": str(current_cwd),
        "replacement_index": 0,
        "replacement_length": len(raw_command),
        "matches": matches,
    }


def get_terminal_snapshot() -> dict[str, Any]:
    session = _get_active_terminal_session()
    if session is not None:
        _flush_terminal_shell_output(session)
    payload = load_terminal_history_payload()
    return {
        "cwd": payload["cwd"],
        "shell": "PowerShell" if os.name == "nt" else (os.getenv("SHELL") or "sh"),
        "entries": payload["entries"],
        "interactive": bool(session and session.command),
        "active_command": session.command if session and session.command else None,
    }


def resize_terminal(cols: int, rows: int) -> dict[str, Any]:
    if cols < 20 or rows < 5:
        return get_terminal_snapshot()

    session = _get_active_terminal_session()
    if session is None or not session.command:
        return get_terminal_snapshot()

    try:
        session.process.setwinsize(rows, cols)
    except Exception as exc:
        raise ValueError(f"Failed to resize terminal session: {exc}") from exc

    return get_terminal_snapshot()


def send_terminal_input(data: str) -> dict[str, Any]:
    raw_data = data if isinstance(data, str) else ""
    if raw_data == "":
        raise ValueError("data is required.")

    session = _get_active_terminal_session()
    if session is None or not session.command:
        raise ValueError("No interactive terminal session is active.")

    try:
        session.process.write(raw_data)
    except Exception as exc:
        _close_interactive_terminal_session()
        raise ValueError(f"Failed to write to terminal session: {exc}") from exc

    _flush_terminal_shell_output(
        session,
        max_wait_seconds=0.45 if ("\r" in raw_data or "\n" in raw_data) else 0.12,
        min_wait_seconds=0.0,
    )
    return get_terminal_snapshot()


def _is_interactive_terminal_command(command: str) -> bool:
    normalized = (_trimmed(command) or "").lower()
    if not normalized:
        return False

    interactive_commands = (
        "openclaude",
        "claude",
        "powershell",
        "powershell.exe",
        "pwsh",
        "pwsh.exe",
        "cmd",
        "cmd.exe",
        "vim",
        "nvim",
        "nano",
        "less",
        "more",
        "top",
        "htop",
    )
    if normalized in interactive_commands:
        return True
    return normalized.startswith(tuple(f"{entry} " for entry in interactive_commands))


def _run_interactive_terminal_command(command: str, cwd: Path) -> tuple[Path, str, int, bool]:
    global _INTERACTIVE_TERMINAL_SESSION

    session = _INTERACTIVE_TERMINAL_SESSION
    spawned_now = False
    if session and (not session.process.isalive() or session.cwd != cwd):
        _close_interactive_terminal_session()
        session = None

    if session is None:
        session = _spawn_interactive_terminal_session(command, cwd)
        _INTERACTIVE_TERMINAL_SESSION = session
        spawned_now = True
    else:
        session.process.write(command + "\r\n")

    output = _collect_interactive_terminal_output(
        session,
        max_wait_seconds=10.0 if spawned_now else 4.0,
        min_wait_seconds=6.0 if spawned_now else 0.0,
    )
    next_cwd = _extract_prompt_cwd_from_output(output) or cwd
    is_alive = bool(session.process.isalive())
    exit_code = 0 if is_alive else int(getattr(session.process, "exitstatus", 0) or 0)

    if not is_alive:
        _close_interactive_terminal_session()

    return next_cwd, output, exit_code, exit_code == 0 or is_alive


def _has_active_interactive_terminal_session(cwd: Path | None = None) -> bool:
    session = _INTERACTIVE_TERMINAL_SESSION
    if not session:
        return False
    if not session.process.isalive():
        return False
    if cwd is not None and session.cwd != cwd:
        return False
    return True


def run_terminal_command(command: str) -> dict[str, Any]:
    global _INTERACTIVE_TERMINAL_SESSION

    normalized_command = _trimmed(command)
    if not normalized_command:
        raise ValueError("command is required.")

    current_cwd = _resolve_terminal_cwd()

    executed_at = datetime.now(timezone.utc).isoformat()

    if _should_use_interactive_terminal_session(normalized_command):
        _close_interactive_terminal_session()
        direct_session = _spawn_interactive_terminal_session(
            normalized_command, current_cwd
        )
        _INTERACTIVE_TERMINAL_SESSION = direct_session
        _append_terminal_entries(
            {
                "id": str(uuid.uuid4()),
                "kind": "command",
                "text": f"PS {current_cwd}> {normalized_command}",
                "created_at": executed_at,
            },
            cwd=current_cwd,
        )
        _flush_terminal_shell_output(
            direct_session,
            max_wait_seconds=3.5,
            min_wait_seconds=0.5,
        )
        snapshot = get_terminal_snapshot()
        snapshot["last_exit_code"] = 0
        snapshot["success"] = True
        return snapshot

    if _has_active_interactive_terminal_session(current_cwd):
        snapshot = send_terminal_input(normalized_command + "\r")
        snapshot["last_exit_code"] = 0
        snapshot["success"] = True
        return snapshot

    if os.name == "nt":
        cwd_marker = f"__OPENCLAUDE_CWD__{uuid.uuid4().hex}__"
        script = "\n".join(
            [
                "$ErrorActionPreference = 'Continue'",
                f"Set-Location -LiteralPath {json.dumps(str(current_cwd))}",
                f"$__openclaude_command = {json.dumps(normalized_command)}",
                "Invoke-Expression $__openclaude_command",
                f"[Console]::Out.WriteLine('{cwd_marker}' + (Get-Location).Path)",
            ]
        )
        invocation = [
            "powershell.exe",
            "-NoLogo",
            "-NoProfile",
            "-Command",
            script,
        ]
        prompt = f"PS {current_cwd}> {normalized_command}"
    else:
        shell = os.getenv("SHELL") or "/bin/bash"
        cwd_marker = f"__OPENCLAUDE_CWD__{uuid.uuid4().hex}__"
        invocation = [
            shell,
            "-lc",
            f"cd {json.dumps(str(current_cwd))} && {normalized_command}; printf '\\n{cwd_marker}%s' \"$PWD\"",
        ]
        prompt = f"$ {normalized_command}"

    completed = subprocess.run(
        invocation,
        cwd=str(current_cwd),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=120,
    )

    stdout_text = completed.stdout or ""
    stderr_text = completed.stderr or ""
    next_cwd = current_cwd
    stdout_lines = stdout_text.splitlines()
    cleaned_stdout_lines: list[str] = []
    for line in stdout_lines:
        if line.startswith(cwd_marker):
            candidate = _trimmed(line[len(cwd_marker) :])
            if candidate:
                candidate_path = Path(candidate).expanduser().resolve()
                if candidate_path.exists() and candidate_path.is_dir():
                    next_cwd = candidate_path
            continue
        cleaned_stdout_lines.append(line)

    output = "\n".join(cleaned_stdout_lines).strip()
    if stderr_text.strip():
        output = f"{output}\n{stderr_text.strip()}".strip()
    trimmed_output = output.strip() or "(no output)"
    if len(trimmed_output) > MAX_TERMINAL_OUTPUT_CHARS:
        trimmed_output = trimmed_output[:MAX_TERMINAL_OUTPUT_CHARS].rstrip() + "\n... output truncated"

    normalized_lower = normalized_command.lower()
    navigation_command = normalized_lower.startswith("cd") or normalized_lower.startswith("set-location") or normalized_lower.startswith("sl ")
    clear_command = normalized_lower in {"cls", "clear", "clear-host"}

    if clear_command:
        save_terminal_history_payload({"entries": [], "cwd": str(next_cwd)})
        snapshot = get_terminal_snapshot()
        snapshot["last_exit_code"] = completed.returncode
        snapshot["success"] = completed.returncode == 0
        return snapshot

    entries = [
        {
            "id": str(uuid.uuid4()),
            "kind": "command",
            "text": prompt,
            "created_at": executed_at,
        }
    ]
    if not (navigation_command and trimmed_output == "(no output)"):
        entries.append(
            {
                "id": str(uuid.uuid4()),
                "kind": "output",
                "text": trimmed_output,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "exit_code": completed.returncode,
                "success": completed.returncode == 0,
            }
        )

    _append_terminal_entries(
        *entries,
        cwd=next_cwd,
    )

    snapshot = get_terminal_snapshot()
    snapshot["last_exit_code"] = completed.returncode
    snapshot["success"] = completed.returncode == 0
    return snapshot


def get_git_overview() -> dict[str, Any]:
    workspace = _build_workspace_context(max_changed_files=MAX_FULL_CHANGED_FILES)
    gh_available = _command_exists("gh")
    return {
        "workspace": workspace,
        "summary": {
            "changed_file_count": workspace.get("changed_file_count", 0),
            "total_insertions": workspace.get("total_insertions", 0),
            "total_deletions": workspace.get("total_deletions", 0),
            "staged_file_count": workspace.get("staged_file_count", 0),
            "unstaged_file_count": workspace.get("unstaged_file_count", 0),
            "untracked_file_count": workspace.get("untracked_file_count", 0),
        },
        "actions": {
            "can_commit": bool(workspace.get("is_git_repo")) and int(workspace.get("changed_file_count", 0)) > 0,
            "can_push": bool(workspace.get("is_git_repo")) and bool(workspace.get("branch")) and bool(workspace.get("origin_url")),
            "can_create_pr": gh_available and bool(workspace.get("branch")) and bool(workspace.get("origin_url")),
            "gh_available": gh_available,
        },
    }


def _run_git_checked(args: list[str], *, cwd: Path) -> str:
    completed = subprocess.run(
        ["git", *args],
        cwd=str(cwd),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if completed.returncode != 0:
        raise ValueError(completed.stderr.strip() or completed.stdout.strip() or f"git {' '.join(args)} failed.")
    return completed.stdout.strip()


def _default_commit_message(repo_root: Path) -> str:
    changed = _run_git(["diff", "--cached", "--name-only"], cwd=repo_root) or ""
    files = [line.strip() for line in changed.splitlines() if line.strip()]
    if len(files) == 1:
        return f"Update {files[0]}"
    if len(files) > 1:
        return f"Update {len(files)} files"
    return "Update workspace changes"


def _default_pr_base(context: dict[str, Any]) -> str | None:
    upstream = _trimmed(context.get("upstream"))
    if not upstream:
        return "main"
    if "/" in upstream:
        return upstream.split("/", 1)[1]
    return upstream


def _push_current_branch(repo_root: Path, context: dict[str, Any]) -> dict[str, Any]:
    branch = _trimmed(context.get("branch"))
    if not branch:
        raise ValueError("No current branch is available to push.")

    upstream = _trimmed(context.get("upstream"))
    if upstream:
        _run_git_checked(["push"], cwd=repo_root)
    else:
        _run_git_checked(["push", "-u", "origin", branch], cwd=repo_root)

    refreshed = get_workspace_context()
    return {
        "branch": refreshed.get("branch"),
        "upstream": refreshed.get("upstream"),
    }


def _create_pull_request(repo_root: Path, title: str, draft: bool, context: dict[str, Any]) -> dict[str, Any]:
    if not _command_exists("gh"):
        raise ValueError("GitHub CLI is not available on this machine.")

    base_branch = _default_pr_base(context)
    command = ["gh", "pr", "create", "--title", title, "--body", ""]
    if base_branch:
        command.extend(["--base", base_branch])
    if draft:
        command.append("--draft")

    completed = subprocess.run(
        command,
        cwd=str(repo_root),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if completed.returncode != 0:
        raise ValueError(completed.stderr.strip() or completed.stdout.strip() or "Failed to create pull request.")

    return {
        "url": completed.stdout.strip() or None,
        "draft": draft,
        "base": base_branch,
    }


def commit_git_changes(
    message: str | None = None,
    *,
    include_untracked: bool = True,
    action: str = "commit",
    draft: bool = False,
) -> dict[str, Any]:
    normalized_action = _trimmed(action) or "commit"
    allowed_actions = {"commit", "commit_and_push", "commit_and_create_pr"}
    if normalized_action not in allowed_actions:
        raise ValueError(f"Unsupported commit action: {normalized_action}")

    context = get_workspace_context()
    repo_root = Path(context.get("project_root") or get_project_workspace_root()).resolve()
    if not context.get("is_git_repo"):
        raise ValueError("Current workspace is not a git repository.")
    if int(context.get("changed_file_count", 0)) == 0:
        raise ValueError("There are no local changes to commit.")

    _run_git_checked(["add", "-A" if include_untracked else "-u"], cwd=repo_root)
    staged_diff = _run_git(["diff", "--cached", "--name-only"], cwd=repo_root)
    if not staged_diff:
        raise ValueError("There are no staged changes to commit.")

    commit_message = _trimmed(message) or _default_commit_message(repo_root)
    _run_git_checked(["commit", "-m", commit_message], cwd=repo_root)

    push_result = None
    pr_result = None
    refreshed_context = get_workspace_context()

    if normalized_action in {"commit_and_push", "commit_and_create_pr"}:
        push_result = _push_current_branch(repo_root, refreshed_context)
        refreshed_context = get_workspace_context()

    if normalized_action == "commit_and_create_pr":
        pr_result = _create_pull_request(repo_root, commit_message, draft, refreshed_context)
        refreshed_context = get_workspace_context()

    return {
        "commit_message": commit_message,
        "push": push_result,
        "pull_request": pr_result,
        "workspace": refreshed_context,
        "branches": list_git_branches(),
        "topic": resolve_workspace_topic(create_if_missing=True),
        "topics": list_topics(),
        "git": get_git_overview(),
    }


def _probe_ollama(base_url: str) -> tuple[bool, list[str]]:
    service_url = _service_root_from_chat_base(base_url)
    try:
        with httpx.Client(timeout=3.0) as client:
            response = client.get(f"{service_url}/api/tags")
        response.raise_for_status()
        data = response.json()
        models = [
            str(model["name"])
            for model in data.get("models", [])
            if isinstance(model, dict) and model.get("name")
        ]
        return True, models
    except Exception:
        return False, []


def _probe_atomic_chat(base_url: str) -> tuple[bool, list[str]]:
    chat_base = _normalize_chat_base_url("atomic-chat", base_url)
    try:
        with httpx.Client(timeout=3.0) as client:
            response = client.get(f"{chat_base}/models")
        response.raise_for_status()
        data = response.json()
        models = [
            str(model["id"])
            for model in data.get("data", [])
            if isinstance(model, dict) and model.get("id")
        ]
        return True, models
    except Exception:
        return False, []


def get_runtime_profile_snapshot() -> dict[str, Any]:
    profile_file = load_openclaude_profile_file()
    env = merged_runtime_env()
    profile = infer_runtime_profile(env, profile_file)
    claude_oauth = load_claude_code_oauth_tokens()
    runtime_keys = (
        "ANTHROPIC_BASE_URL",
        "ANTHROPIC_MODEL",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "CLAUDE_CODE_OAUTH_TOKEN",
        "OPENAI_BASE_URL",
        "OPENAI_MODEL",
        "OPENAI_API_KEY",
        "GEMINI_BASE_URL",
        "GEMINI_MODEL",
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        "CODEX_API_KEY",
        "CHATGPT_ACCOUNT_ID",
        "CODEX_ACCOUNT_ID",
    )
    runtime_source = (
        "profile-file"
        if profile_file
        else "environment"
        if any(_trimmed(env.get(key)) for key in runtime_keys)
        else "claude-config"
        if claude_oauth
        else "defaults"
    )

    if profile == "anthropic":
        model = _pick(env, "ANTHROPIC_MODEL") or DEFAULT_PROFILE_MODELS["anthropic"]
        base_url = _pick(env, "ANTHROPIC_BASE_URL") or DEFAULT_ANTHROPIC_BASE_URL
        api_key = _resolve_anthropic_api_key(env)
        auth_mode = None
        account_id = None
        api_key_configured = bool(api_key or _resolve_anthropic_auth_token(env))
    elif profile == "gemini":
        model = _pick(env, "GEMINI_MODEL") or DEFAULT_PROFILE_MODELS["gemini"]
        base_url = _pick(env, "GEMINI_BASE_URL") or DEFAULT_GEMINI_BASE_URL
        api_key = _pick(env, "GEMINI_API_KEY", "GOOGLE_API_KEY")
        auth_mode = _pick(env, "GEMINI_AUTH_MODE") or "api-key"
        account_id = None
        api_key_configured = bool(_trimmed(api_key))
    elif profile == "codex":
        model = _pick(env, "OPENAI_MODEL") or DEFAULT_PROFILE_MODELS["codex"]
        base_url = _pick(env, "OPENAI_BASE_URL") or DEFAULT_CODEX_BASE_URL
        api_key = _pick(env, "CODEX_API_KEY")
        auth_mode = None
        account_id = _pick(env, "CHATGPT_ACCOUNT_ID", "CODEX_ACCOUNT_ID")
        api_key_configured = bool(_trimmed(api_key))
    else:
        model = _pick(env, "OPENAI_MODEL") or DEFAULT_PROFILE_MODELS.get(profile, DEFAULT_PROFILE_MODELS["openai"])
        base_url = _pick(env, "OPENAI_BASE_URL") or DEFAULT_PROFILE_BASE_URLS.get(profile, DEFAULT_OPENAI_BASE_URL)
        api_key = _pick(env, "OPENAI_API_KEY")
        auth_mode = None
        account_id = None
        api_key_configured = bool(_trimmed(api_key))

    return {
        "profile": profile,
        "label": PROFILE_LABELS[profile],
        "source": runtime_source,
        "created_at": profile_file.get("createdAt") if profile_file else None,
        "model": model,
        "base_url": base_url,
        "api_key_masked": mask_secret(api_key),
        "api_key_configured": api_key_configured,
        "gemini_auth_mode": auth_mode,
        "chatgpt_account_id": account_id,
    }


def _resolve_router_source(router_config: dict[str, Any], env: dict[str, str]) -> str:
    if router_config.get("mode") == "explicit" and router_config.get("model_id") and router_config.get("base_url"):
        return "router-config"
    if _pick(env, "AGNO_MODEL_ID", "AGNO_MODEL") and _pick(env, "AGNO_BASE_URL"):
        return "environment"
    if load_openclaude_profile_file():
        return "openclaude-profile"
    if load_claude_code_oauth_tokens():
        return "claude-config"
    return "fallback-local"


def _get_model_base_url(model: Any) -> str | None:
    base_url = getattr(model, "base_url", None)
    if isinstance(base_url, str):
        return base_url

    client_params = getattr(model, "client_params", None)
    if isinstance(client_params, dict):
        value = client_params.get("base_url")
        if isinstance(value, str):
            return value

    provider = str(getattr(model, "provider", "") or "").lower()
    if "anthropic" in provider:
        return DEFAULT_ANTHROPIC_BASE_URL

    return None


def get_router_snapshot() -> dict[str, Any]:
    router_config = load_router_config()
    env = merged_runtime_env()
    model = resolve_agno_model()
    return {
        "mode": router_config.get("mode") or "inherit",
        "source": _resolve_router_source(router_config, env),
        "model_id": router_config.get("model_id"),
        "base_url": router_config.get("base_url"),
        "provider_name": router_config.get("provider_name") or "OpenAI-Compatible",
        "api_key_masked": mask_secret(_trimmed(router_config.get("api_key"))),
        "api_key_configured": bool(_trimmed(router_config.get("api_key"))),
        "effective_model_id": getattr(model, "id", None),
        "effective_base_url": _get_model_base_url(model),
        "effective_provider": getattr(model, "provider", None),
    }


def get_provider_statuses() -> list[dict[str, Any]]:
    runtime = get_runtime_profile_snapshot()
    selected_profile = runtime["profile"]
    env = merged_runtime_env()

    ollama_base = runtime["base_url"] if selected_profile == "ollama" else DEFAULT_OLLAMA_BASE_URL
    atomic_base = runtime["base_url"] if selected_profile == "atomic-chat" else DEFAULT_ATOMIC_CHAT_BASE_URL
    anthropic_ready = bool(
        runtime["profile"] == "anthropic"
        and runtime["api_key_configured"]
    ) or bool(
        _resolve_anthropic_api_key(env) or _resolve_anthropic_auth_token(env)
    )
    ollama_connected, ollama_models = _probe_ollama(ollama_base)
    atomic_connected, atomic_models = _probe_atomic_chat(atomic_base)

    providers: list[dict[str, Any]] = []
    for profile in SUPPORTED_RUNTIME_PROFILES:
        active = profile == selected_profile
        default_base_url = DEFAULT_PROFILE_BASE_URLS[profile]
        entry: dict[str, Any] = {
            "id": profile,
            "label": PROFILE_LABELS[profile],
            "active": active,
            "default_base_url": default_base_url,
            "models": [],
            "status": "manual",
        }

        if profile == "ollama":
            entry["status"] = "connected" if ollama_connected else "offline"
            entry["models"] = ollama_models
            entry["base_url"] = ollama_base
        elif profile == "anthropic" and anthropic_ready and not active:
            entry["status"] = "connected"
            entry["models"] = [runtime["model"]] if runtime["profile"] == "anthropic" and runtime["model"] else []
            entry["base_url"] = runtime["base_url"] if runtime["profile"] == "anthropic" else default_base_url
        elif profile == "atomic-chat":
            entry["status"] = "connected" if atomic_connected else "offline"
            entry["models"] = atomic_models
            entry["base_url"] = atomic_base
        elif active:
            entry["status"] = "active"
            entry["models"] = [runtime["model"]] if runtime["model"] else []
            entry["base_url"] = runtime["base_url"]
        else:
            entry["base_url"] = default_base_url

        providers.append(entry)

    return providers


def get_native_settings_snapshot() -> dict[str, Any]:
    settings_path = get_openclaude_settings_path()
    settings = load_openclaude_settings()
    agent_models = _normalize_agent_models(settings.get("agentModels"))
    agent_routing = _normalize_agent_routing(settings.get("agentRouting"))

    return {
        "config_home": str(get_openclaude_config_home_dir()),
        "settings_path": str(settings_path),
        "exists": settings_path.exists(),
        "source": "user-settings",
        "cowork_mode": settings_path.name == "cowork_settings.json",
        "agent_models": [
            {
                "name": name,
                "base_url": config["base_url"],
                "api_key_masked": mask_secret(config.get("api_key")),
                "api_key_configured": bool(_trimmed(config.get("api_key"))),
            }
            for name, config in agent_models.items()
        ],
        "agent_routing": [
            {"key": key, "model": model_name}
            for key, model_name in agent_routing.items()
        ],
        "recommended_routing_keys": list(
            dict.fromkeys([*STANDARD_AGENT_ROUTING_KEYS, *agent_routing.keys()])
        ),
    }


def persist_native_settings(config: dict[str, Any]) -> dict[str, Any]:
    existing_settings = load_openclaude_settings()
    existing_models = _normalize_agent_models(existing_settings.get("agentModels"))
    raw_agent_models = config.get("agent_models")
    raw_agent_routing = config.get("agent_routing")

    next_models: dict[str, dict[str, str]] = {}
    if isinstance(raw_agent_models, list):
        for raw_entry in raw_agent_models:
            if not isinstance(raw_entry, dict):
                continue

            name = _trimmed(raw_entry.get("name"))
            base_url = _trimmed(raw_entry.get("base_url"))
            if not name or not base_url:
                continue

            incoming_api_key = raw_entry.get("api_key")
            api_key = incoming_api_key.strip() if isinstance(incoming_api_key, str) else None
            if api_key:
                resolved_api_key = api_key
            else:
                resolved_api_key = existing_models.get(name, {}).get("api_key", "")

            next_models[name] = {
                "base_url": base_url,
                "api_key": resolved_api_key,
            }

    next_routing: dict[str, str] = {}
    if isinstance(raw_agent_routing, dict):
        next_routing = _normalize_agent_routing(raw_agent_routing)

    available_model_names = set(next_models)
    if not available_model_names:
        available_model_names = set(existing_models)

    for routing_key, model_name in next_routing.items():
        if available_model_names and model_name not in available_model_names:
            raise ValueError(
                f"Routing target `{routing_key}` points to unknown model `{model_name}`."
            )

    next_settings = dict(existing_settings)
    if isinstance(raw_agent_models, list):
        if next_models:
            next_settings["agentModels"] = next_models
        else:
            next_settings.pop("agentModels", None)

    if isinstance(raw_agent_routing, dict):
        if next_routing:
            next_settings["agentRouting"] = next_routing
        else:
            next_settings.pop("agentRouting", None)

    save_openclaude_settings(next_settings)
    return get_native_settings_snapshot()


def _infer_runtime_profile_from_agent_model(base_url: str) -> str:
    normalized_base_url = _trimmed(base_url) or DEFAULT_OPENAI_BASE_URL
    lowered = normalized_base_url.lower()

    if "generativelanguage.googleapis.com" in lowered:
        return "gemini"
    if _looks_like_codex_base_url(normalized_base_url):
        return "codex"
    if _is_atomic_chat_base_url(normalized_base_url):
        return "atomic-chat"
    if _is_ollama_base_url(normalized_base_url):
        return "ollama"
    return "openai"


def activate_named_model(model_name: str) -> dict[str, Any]:
    normalized_name = _trimmed(model_name)
    if not normalized_name:
        raise ValueError("model_name is required.")

    settings = load_openclaude_settings()
    agent_models = _normalize_agent_models(settings.get("agentModels"))
    target = agent_models.get(normalized_name)
    if not target:
        raise ValueError(f"Agent model not found: {normalized_name}")

    profile = _infer_runtime_profile_from_agent_model(target["base_url"])
    runtime_payload: dict[str, Any] = {
        "profile": profile,
        "model": normalized_name,
        "base_url": target["base_url"],
        "api_key": target.get("api_key") or None,
    }
    if profile == "gemini":
        runtime_payload["gemini_auth_mode"] = "api-key"

    persist_runtime_profile(runtime_payload)
    return get_runtime_profile_snapshot()


def _fallback_slash_catalog() -> dict[str, Any]:
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "commands": [
            {
                "id": "help",
                "name": "help",
                "slash": "/help",
                "kind": "command",
                "source": "builtin",
                "loaded_from": None,
                "description": "Show available slash commands.",
                "aliases": [],
            },
            {
                "id": "skills",
                "name": "skills",
                "slash": "/skills",
                "kind": "command",
                "source": "builtin",
                "loaded_from": None,
                "description": "List available skills.",
                "aliases": [],
            },
            {
                "id": "plugin",
                "name": "plugin",
                "slash": "/plugin",
                "kind": "command",
                "source": "builtin",
                "loaded_from": None,
                "description": "Manage plugins.",
                "aliases": ["plugins"],
            },
        ],
        "skills": [],
        "plugins": [],
    }


def get_slash_catalog() -> dict[str, Any]:
    if not OPENCLAUDE_WEB_CATALOG_PATH.exists():
        return _fallback_slash_catalog()

    try:
        completed = subprocess.run(
            ["bun", str(OPENCLAUDE_WEB_CATALOG_PATH)],
            cwd=str(WORKSPACE_ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=20,
        )
    except Exception:
        return _fallback_slash_catalog()

    if completed.returncode != 0:
        return _fallback_slash_catalog()

    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError:
        return _fallback_slash_catalog()

    if not isinstance(payload, dict):
        return _fallback_slash_catalog()

    return payload


def get_integration_snapshot() -> dict[str, Any]:
    tools = list_openclaude_tools()
    runtime = get_runtime_profile_snapshot()
    router = get_router_snapshot()
    return {
        "status": workspace_status(),
        "runtime": runtime,
        "router": router,
        "native_settings": get_native_settings_snapshot(),
        "providers": get_provider_statuses(),
        "tools": {
            "count": len(tools),
            "access_mode": "openclaude_session",
            "summary": "Todo trabalho real de shell, arquivos, MCP, web e automação é delegado ao runtime nativo do OpenClaude.",
            "items": tools,
        },
        "platform_features": PLATFORM_FEATURES,
    }


def workspace_status() -> dict[str, Any]:
    runtime = get_runtime_profile_snapshot()
    router = get_router_snapshot()
    tools = list_openclaude_tools()
    workspace = get_workspace_context()
    topics = list_topics()
    return {
        "workspace_root": str(get_project_workspace_root()),
        "agno_state_dir": str(AGNO_STATE_DIR),
        "agentos_db": str(AGNO_DB_PATH),
        "openclaude_built": OPENCLAUDE_DIST_PATH.exists(),
        "profile_detected": runtime.get("source") != "defaults",
        "resolved_model": router.get("effective_model_id"),
        "resolved_base_url": router.get("effective_base_url"),
        "runtime_profile": runtime.get("profile"),
        "router_mode": router.get("mode"),
        "tool_count": len(tools),
        "repo_name": workspace.get("repo_name"),
        "branch": workspace.get("branch"),
        "is_dirty": workspace.get("is_dirty"),
        "changed_file_count": workspace.get("changed_file_count"),
        "topic_count": len(topics),
    }


def check_local_endpoint(url: str) -> bool:
    try:
        with httpx.Client(timeout=2.0) as client:
            response = client.get(url)
        return response.is_success
    except Exception:
        return False
