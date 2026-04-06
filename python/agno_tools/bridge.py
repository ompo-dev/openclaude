from __future__ import annotations

import json
import os
import re
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from agno.models.openai.chat import OpenAIChat
from agno.models.openai.like import OpenAILike

from .openclaude_model import OpenClaudeModel

WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
AGNO_STATE_DIR = WORKSPACE_ROOT / ".agno"
AGNO_DB_PATH = AGNO_STATE_DIR / "agentos.sqlite"
AGNO_ROUTER_CONFIG_PATH = AGNO_STATE_DIR / "router.json"
AGNO_TOPICS_PATH = AGNO_STATE_DIR / "topics.json"
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
MAX_PATCH_CHARS = 2400
MAX_UNTRACKED_PREVIEW_LINES = 80
STANDARD_AGENT_ROUTING_KEYS = (
    "default",
    "Explore",
    "Plan",
    "general-purpose",
    "frontend-dev",
)


def ensure_state_dir() -> Path:
    AGNO_STATE_DIR.mkdir(parents=True, exist_ok=True)
    return AGNO_STATE_DIR


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
            workspace_root=WORKSPACE_ROOT,
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
    root = (base_dir or WORKSPACE_ROOT).resolve()
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
            cwd=str((cwd or WORKSPACE_ROOT).resolve()),
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


def get_workspace_context() -> dict[str, Any]:
    repo_root_value = _run_git(["rev-parse", "--show-toplevel"])
    topics = list_topics()

    if not repo_root_value:
        return {
            "workspace_root": str(WORKSPACE_ROOT),
            "project_root": str(WORKSPACE_ROOT),
            "project_label": WORKSPACE_ROOT.name,
            "repo_root": None,
            "repo_name": WORKSPACE_ROOT.name,
            "origin_url": None,
            "branch": None,
            "head": None,
            "upstream": None,
            "ahead": 0,
            "behind": 0,
            "is_git_repo": False,
            "is_dirty": False,
            "changed_file_count": 0,
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
        if len(changed_files) >= MAX_CHANGED_FILES:
            break

        if len(line) < 3:
            continue

        staged_status = line[0]
        unstaged_status = line[1]
        relative_path = line[3:].strip().rsplit(" -> ", 1)[-1]
        if not relative_path:
            continue

        kind = _status_to_kind(staged_status, unstaged_status)
        stats = _merge_file_stats(
            cached_numstat.get(relative_path),
            numstat.get(relative_path),
        )
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
        "workspace_root": str(WORKSPACE_ROOT),
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
        "is_dirty": bool(changed_files),
        "changed_file_count": len(status_lines),
        "topic_count": len(topics),
        "changed_files": changed_files,
    }


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
                "project_root": _trimmed(item.get("project_root")) or str(WORKSPACE_ROOT),
                "repo_name": _trimmed(item.get("repo_name")) or WORKSPACE_ROOT.name,
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
        "project_root": context.get("project_root") or str(WORKSPACE_ROOT),
        "repo_name": context.get("repo_name") or WORKSPACE_ROOT.name,
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
        "workspace_root": str(WORKSPACE_ROOT),
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
