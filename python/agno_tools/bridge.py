from __future__ import annotations

import json
import os
import re
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
OPENCLAUDE_DIST_PATH = WORKSPACE_ROOT / "dist" / "cli.mjs"
OPENCLAUDE_PROFILE_PATH = WORKSPACE_ROOT / ".openclaude-profile.json"

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


def get_integration_snapshot() -> dict[str, Any]:
    tools = list_openclaude_tools()
    runtime = get_runtime_profile_snapshot()
    router = get_router_snapshot()
    return {
        "status": workspace_status(),
        "runtime": runtime,
        "router": router,
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
    }


def check_local_endpoint(url: str) -> bool:
    try:
        with httpx.Client(timeout=2.0) as client:
            response = client.get(url)
        return response.is_success
    except Exception:
        return False
