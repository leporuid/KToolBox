# Agent Guide (`ktoolbox`)

Asynchronous CLI, typed Python client, FastMCP server, and React WebUI for Pawchive (`leporuid/KToolBox`, packaged with `uv2nix`).

---

## 1. Repository Layout

| Directory / File | Responsibility |
| :--- | :--- |
| `ktoolbox/` | Core Python CLI (`cyclopts`), API client (`httpx`), job runner, and downloader engine. |
| `ktoolbox/webui/` | FastAPI backend, task store, SQLite persistence, and FastMCP bridge (`mcp_server.py`). |
| `webui/` | React 19, TypeScript 5.9, Vite 8, HeroUI (`@heroui/react`) frontend SPA (`webui/src/`). |
| `k_generator/` | OpenAPI normalization and Python client/model code generators. |
| `scripts/` | Build & contract utilities (`export_webui_openapi.py`, `generate_config_locale_catalogs.py`, `check_webui_wheel.py`, `smoke_test_executable.py`). |
| `tests/` | `pytest` suites covering CLI, downloader, WebUI APIs, task scheduler, and FastMCP. |
| `flake.nix` | `pyproject-nix` + `uv2nix` packaging (`lib.genAttrs`, no `flake-utils`), `packages.ktoolbox`, `devShells.ktoolbox`, `overlays.default`. |
| `pyproject.toml` | Python package metadata, optional/dependency groups (`webui`, `urwid`, `uvloop`, `dev`, `test`), `ruff`, `mypy`, `pytest`, and coverage (`fail_under = 85`). |

---

## 2. Invariants & Guardrails

- **Lockfile Hygiene**: NEVER read or output `flake.lock` or `uv.lock` wholesale. Inspect `pyproject.toml`, `flake.nix`, and `webui/package.json` instead.
- **Generated Code Boundaries**:
  - NEVER hand-edit files under `ktoolbox/api/generated/` or `webui/src/generated/api.ts`.
  - Regenerate contracts via the documented scripts whenever API schemas change.
- **Upstream Sync (`uv-pawchive` / `uv2nix`)**:
  - Sync with upstream `master`/`devel` via `git rebase` (never manual file copying).
  - Leave upstream legacy modules excluded by `.github/workflows/quality.yml` (such as `ktoolbox/_cli_zh.py`, `ktoolbox/model.py`, and package `__init__.py` star-imports) untouched unless specifically targeted, to prevent rebase conflicts.
  - Stage only modified target files and use Conventional Commits.

---

## 3. FastMCP & OpenAPI Contract

- **Bridge Route Filtering**: `create_mcp_server` in `ktoolbox/webui/mcp_server.py` builds MCP tools via `FastMCP.from_openapi` over `httpx.ASGITransport(app=app)`.
- **Extension Annotations**: Routes opt into MCP strictly via `x-ktoolbox-mcp` (`enabled == True`, `scope`, `safety`).
- **Auth & Sanitization**: MCP schemas strip `securitySchemes` and `x-csrf-token` parameters; `DatabaseTokenVerifier` validates scoped bearer tokens.

---

## 4. Verification & Testing Gates

### Python Environment (`nix develop` or synced `.venv`)
Inside `nix develop`, `ktoolboxDevEnv` places `pytest`, `ruff`, and `mypy` directly on `PATH` (with `UV_NO_SYNC=1` and `UV_PYTHON_DOWNLOADS=never`). Outside `nix develop`, sync dependencies once (`uv sync --locked --all-groups --extra webui --extra urwid`) before using `uv run --no-sync`.

Run the curated CI scope from `.github/workflows/quality.yml` and the test suite:
```sh
nix develop --command pytest
```
- `pytest` enforces `-W error --disable-socket --allow-unix-socket` (`respx` for HTTP mocking) and `fail_under = 85` branch coverage (`ktoolbox/_cli_zh.py` and `ktoolbox/_configuration_zh.py` omitted in `.coveragerc`).
- **Subprocess TTY Guard**: When testing commands that invoke `getpass.getpass()`, pass `start_new_session=True` to `subprocess.run(...)` so the child process detaches from the controlling `/dev/tty` and reads EOF immediately instead of hanging.

### Quality Scope (`ruff` & `mypy`, matching `.github/workflows/quality.yml`)
Run inside `nix develop --command ...` (or `uv run --no-sync` in a synced venv):
```sh
ruff check scripts k_generator ktoolbox/api ktoolbox/blocker ktoolbox/webui \
  ktoolbox/action/{base,fetch,search}.py ktoolbox/{__main__,_enum,cli,cli_app,configuration,exceptions,project_config,reporting,sync,utils}.py \
  ktoolbox/downloader/downloader.py ktoolbox/job/{runner,stream}.py tests

ruff format --check scripts k_generator ktoolbox/api ktoolbox/blocker ktoolbox/webui \
  ktoolbox/action/{base,fetch,search}.py ktoolbox/{__main__,_enum,cli,cli_app,configuration,exceptions,project_config,reporting,sync,utils}.py \
  ktoolbox/downloader/downloader.py ktoolbox/job/{runner,stream}.py tests

mypy --strict ktoolbox/api/{client,errors,parameters,utils}.py \
  ktoolbox/action/{base,fetch,search}.py ktoolbox/{__main__,cli,cli_app,exceptions,project_config,reporting,sync}.py \
  ktoolbox/blocker ktoolbox/job/stream.py

mypy ktoolbox/webui scripts/export_webui_openapi.py scripts/check_webui_wheel.py scripts/smoke_test_executable.py tests/webui_e2e_server.py
```

### WebUI Frontend (`webui/`)
Run inside `webui/`:
```sh
npm run typecheck    # tsc -b --pretty false
npm run lint         # eslint .
npm run test         # vitest run
npm run build        # tsc -b && vite build
npm run test:e2e     # playwright test (includes @axe-core/playwright)
```

### Schema & Contract Generation
Run whenever backend schemas or settings change:
```sh
npm run generate:api --prefix webui
npm run check:api --prefix webui
nix develop --command python scripts/generate_config_locale_catalogs.py
```
