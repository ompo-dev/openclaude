# OpenClaude Web Workspace

Este documento detalha a arquitetura, motivação e funcionamento do módulo web adicionado ao OpenClaude — uma camada de interface browser-first que expõe o mesmo runtime de codificação da CLI em uma UI local.

---

## Contexto

O OpenClaude nasceu como uma CLI multi-provider para agentes de codificação. Toda a execução — shell, file tools, grep, glob, MCP, agentes, tarefas — acontece no terminal. O objetivo do módulo web não é substituir esse fluxo, mas torná-lo acessível no navegador sem sacrificar nenhuma ferramenta ou comportamento existente.

A premissa central é: **o OpenClaude continua sendo o motor de execução real**. O módulo web é uma casca local que conecta o browser a esse motor.

---

## Componentes

### Python: servidor FastAPI (`python/agno_server.py`)

O backend é um servidor [FastAPI](https://fastapi.tiangolo.com/) que roda localmente em `http://127.0.0.1:7777`. Ele usa a biblioteca [Agno](https://docs.agno.com) como runtime de agente web — mas apenas como camada de orquestração.

O agente principal criado nesse servidor tem `id="openclaude-web"` e suas instruções explícitas são:

- usar `openclaude_session` como ferramenta padrão para qualquer trabalho de repositório
- delegar shell, edição de arquivos, acesso a MCP, web work e tarefas multi-step ao OpenClaude nativo via essa ferramenta
- usar ferramentas diretas do workspace somente para diagnóstico leve da própria camada de integração

O servidor mantém sessões em SQLite (`.agno/agentos.sqlite`) e expõe endpoints REST customizados além da interface padrão do Agno.

### Python: bridge de integração (`python/agno_tools/bridge.py`)

O bridge é o coração da integração. Ele:

- resolve o perfil ativo do OpenClaude (`.openclaude-profile.json`)
- resolve o modelo Agno a usar no orquestrador web (`router.json`)
- descobre provedores locais disponíveis (Ollama, Atomic Chat)
- expõe o catálogo de slash commands e ferramentas nativas do OpenClaude
- gerencia tópicos de projeto (agrupamento de sessões por contexto)
- gerencia branches Git do workspace alvo
- publica o snapshot de integração consumido pelo frontend

### Python: ferramenta de sessão (`python/agno_tools/openclaude_agent_tool.py`)

`OpenClaudeAgentTools` é o adaptador que mantém sessões headless do OpenClaude por chat da web. Cada sessão de chat recebe um processo OpenClaude persistente (`node dist/cli.mjs`) que é reutilizado entre turnos. Assim, o histórico de contexto e as ferramentas ativas ficam estáveis durante toda a conversa.

> **Limitação atual:** o processo OpenClaude headless roda com `--dangerously-skip-permissions` e `--permission-mode bypassPermissions`. O mecanismo de tradução de eventos `control_request` para aprovações no browser ainda não existe.

### Frontend: Agent UI vendorizado (`apps/agent-ui/`)

O frontend é um fork do [Agent UI](https://github.com/agno-agi/agent-ui) adaptado para o OpenClaude. É uma aplicação Next.js servida localmente na porta `3000`.

Superfícies principais:

| Superfície | Função |
|---|---|
| `Chat` | workspace de conversa principal, via runtime OpenClaude |
| `Conversations` | browser de sessões para reabrir runs anteriores |
| `Settings` | painel de configuração de perfis, provedores, roteamento e ferramentas |

O `Settings` mostra em tempo real:
- provedores locais detectados (Ollama, Atomic Chat)
- catálogo de ferramentas nativas descobertas em `src/tools`
- status atual de adaptação das capabilities da plataforma

#### Sincronização de workspace (`ChatSessionSync`, `WorkspaceBootstrapSync`)

Quando a UI é aberta com o parâmetro `?workspace=/caminho/do/projeto`, o componente `WorkspaceBootstrapSync` chama `/integration/workspace-target` para sincronizar o workspace alvo no backend e obter o tópico correspondente. Se um tópico com sessão existente for encontrado, a sessão é restaurada automaticamente via query param.

`ChatSessionSync` mantém o estado de sessão ativo sincronizado entre recargas e abas.

#### Tópicos de projeto (`Sidebar/TopicTree`)

A sidebar exibe uma árvore de tópicos que agrupa sessões por contexto de projeto. Cada tópico pode ter múltiplas sessões associadas, permitindo retomar trabalhos específicos sem perder histórico.

### CLI: comando `/web` (`src/commands/web/web.ts`)

O comando `/web` foi adicionado ao runtime da CLI do OpenClaude. Quando executado dentro da CLI, ele:

1. localiza o workspace root (buscando `package.json` + `scripts/openclaude-web.mjs` na hierarquia de diretórios)
2. verifica se a UI e API já estão rodando — se sim, apenas exibe as URLs sem reiniciar
3. encontra portas livres próximas às padrão (7777 para API, 3000 para UI)
4. executa o launcher `scripts/openclaude-web.mjs` com `--json` para obter o resultado da inicialização
5. aguarda health checks de API (`/healthz` com CORS) e UI (`/healthz` + título + stylesheet)
6. exibe as URLs e status de saúde; em caso de falha, mostra as últimas linhas dos logs

### Launcher Node.js (`scripts/openclaude-web.mjs`)

Script de inicialização cross-platform que:

- detecta o workspace root subindo a hierarquia de diretórios
- verifica se a stack já está rodando antes de reiniciar
- encontra portas disponíveis
- no Windows: spawn de dois processos PowerShell hidden (servidor e UI separados) via `start-agno.ps1`
- no Unix: spawn de `start-agno.sh` em background
- abre o browser apontando para `/?workspace=<cwd>` após 3 segundos
- suporta `--dry-run`, `--no-browser`, `--json` para uso programático

### Scripts de plataforma (`scripts/start-agno.ps1`, `scripts/start-agno.sh`)

Scripts específicos de plataforma que iniciam o servidor Python e o servidor Next.js com as variáveis de ambiente corretas (`AGNO_PORT`, `AGNO_UI_PORT`, `OPENCLAUDE_WEB_WORKSPACE`, `OPENCLAUDE_TARGET_WORKSPACE`).

---

## Modelo de execução

```
Browser
  └─→ Next.js (porta 3000)
        └─→ FastAPI AgentOS (porta 7777)
              └─→ Agno Agent (orquestrador)
                    └─→ openclaude_session (ferramenta)
                          └─→ node dist/cli.mjs (processo headless)
                                └─→ OpenClaude runtime completo
                                      (shell, file tools, grep, glob,
                                       MCP, agentes, tarefas, web tools)
```

O browser nunca fala diretamente com o OpenClaude. O Agno faz a orquestração de alto nível e delega o trabalho real via `openclaude_session`. Isso preserva 100% de paridade de ferramentas com o uso em terminal.

---

## Configuração de runtime e router

O módulo web separa dois conceitos:

**Runtime** — o perfil de execução do OpenClaude, compartilhado com o terminal:

| Perfil | Base URL padrão | Modelo padrão |
|---|---|---|
| `openai` | `https://api.openai.com/v1` | `gpt-4.1-mini` |
| `ollama` | `http://localhost:11434/v1` | `qwen2.5-coder:7b` |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.0-flash` |
| `codex` | `https://chatgpt.com/backend-api/codex` | `codexplan` |
| `atomic-chat` | `http://127.0.0.1:1337/v1` | `llama3:8b` |

**Router** — o modelo usado pelo orquestrador Agno para a camada web:

- `inherit`: reutiliza o perfil runtime atual do OpenClaude
- `explicit`: usa um modelo e base URL dedicados para a orquestração web, independentemente do runtime

---

## Endpoints da API

| Método | Rota | Função |
|---|---|---|
| `GET` | `/healthz` | health check + workspace status |
| `GET` | `/integration/status` | status detalhado do workspace |
| `GET` | `/integration/config` | snapshot completo de configuração |
| `PUT` | `/integration/config` | persiste runtime, router e agent models |
| `GET` | `/integration/slash-catalog` | catálogo de slash commands do OpenClaude |
| `POST` | `/integration/activate-model` | ativa um modelo pelo nome |
| `GET` | `/integration/workspace` | contexto do workspace atual |
| `GET` | `/integration/workspace-bootstrap` | dados iniciais de bootstrap |
| `POST` | `/integration/workspace-target` | define workspace alvo e resolve tópico |
| `GET` | `/integration/branches` | lista branches Git |
| `POST` | `/integration/branches/switch` | troca branch |
| `POST` | `/integration/branches/create` | cria branch |
| `GET` | `/integration/topics` | lista tópicos |
| `POST` | `/integration/topics` | cria tópico |
| `POST` | `/integration/topics/{id}/sessions` | associa sessão a tópico |
| `DELETE` | `/integration/topic-links/{session_id}` | desassocia sessão de tópicos |
| `GET` | `/integration/docs` | Swagger UI da API |

---

## Armazenamento local

| Arquivo | Conteúdo |
|---|---|
| `.openclaude-profile.json` | perfil de runtime do OpenClaude (terminal e web compartilham) |
| `.agno/router.json` | configuração do router web |
| `.agno/agentos.sqlite` | sessões AgentOS e histórico de conversas |
| `.agno/topics.json` | tópicos de projeto e seus vínculos de sessão |
| `.agno-server.stdout.log` / `.agno-server.stderr.log` | logs do servidor Python |
| `.agent-ui.stdout.log` / `.agent-ui.stderr.log` | logs do frontend Next.js |

Nenhum dado sai para serviços externos. Tudo é local.

---

## Como iniciar

**Dentro da CLI OpenClaude:**

```
/web
```

**npm (da raiz do repositório):**

```bash
npm run web
```

**PowerShell (Windows):**

```powershell
.\scripts\start-agno.ps1
```

**Shell (macOS / Linux):**

```bash
./scripts/start-agno.sh
```

**Variáveis de ambiente opcionais:**

| Variável | Padrão | Função |
|---|---|---|
| `AGNO_PORT` | `7777` | porta da API Python |
| `AGNO_UI_PORT` | `3000` | porta do frontend Next.js |
| `OPENCLAUDE_TARGET_WORKSPACE` | `cwd` | workspace alvo inicial |
| `OPENCLAUDE_WEB_WORKSPACE` | auto-detectado | raiz do repositório web |

---

## Dependências de sistema

Para rodar o módulo web é necessário:

- **Node.js** — para o frontend Next.js e o launcher
- **Python 3.10+** com `agno`, `fastapi`, `uvicorn`, `httpx`, `pydantic`
- O **build do OpenClaude** disponível em `dist/cli.mjs` (executar `bun run build` antes)

Instalação das dependências Python:

```bash
pip install agno fastapi uvicorn httpx pydantic
```

Instalação do frontend:

```bash
cd apps/agent-ui
npm install
```

---

## Independência do Agno hospedado

O módulo web não depende de nenhum serviço Agno em nuvem:

- a UI está vendorizada neste repositório
- a API é servida localmente por este repositório
- o estado fica em arquivos locais e SQLite
- o OpenClaude permanece o backend de execução
- nenhum dashboard ou control plane Agno externo é necessário

O Agno é tratado como engine embutido e base de UI — não como dono do estado de runtime ou comportamento de produto.
