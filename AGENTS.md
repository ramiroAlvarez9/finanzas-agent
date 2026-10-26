# eve Agent App

This project uses the eve framework: an agent is a directory of files under `agent/`, and eve compiles and runs it.

For a content-only change to the root agent's identity, purpose, tone, or response guidelines, edit its existing authored instructions. Fresh projects use `agent/instructions.md`; a project may instead use `agent/instructions.ts` or files under `agent/instructions/`. You do not need to read the framework docs for a content-only instructions change. A fresh project already has its selected model in `agent/agent.ts`; preserve that file unless the user asks to change the model.

## Proyecto: finanzas-agent

Este repo es un agente de Telegram para **gastos personales**, no la app de calorías. El bot habla español rioplatense y vive en `agent/instructions.md`; este archivo es la guía para agentes que programan el repo.

### Entorno y comandos

- Node 24 es obligatorio. El shell por defecto de la máquina puede tener Node 20: usar `nvm use` (hay `.nvmrc`).
- `pnpm install`
- `pnpm test` — tests de `node:test` con `tsx`.
- `pnpm typecheck`
- `pnpm build`
- `pnpm dev`

Antes de dar un cambio por terminado, correr como mínimo `pnpm typecheck` y `pnpm test`; si se tocó el agente o el canal, también `pnpm build`.

### Arquitectura

- `agent/instructions.md`: comportamiento del bot (finanzas, español rioplatense). No confundir con este `AGENTS.md`.
- `agent/channels/telegram.ts`: acceso por `ACCESS_CODE`, voz con AssemblyAI, rechazo de fotos/archivos y tarjetas de aprobación personalizadas.
- `agent/lib/db.ts`: SQLite vía `@libsql/client` (`data/finanzas.db`), usuarios, gastos, soft delete y agregaciones.
- `agent/lib/categories.ts`: 18 categorías; `suscripciones_ia` es parte del catálogo.
- `agent/lib/money.ts`: monedas ISO 4217, unidad mínima y formato con código (`ARS`, `USD`, etc.).
- `agent/lib/periods.ts`: fechas, semanas, meses y rangos en la zona horaria del usuario.
- `agent/lib/approval-message.ts`: texto de las tarjetas y opciones `✅ Confirmar` / `❌ Cancelar`.
- `agent/tools/`: `log_expense` y `delete_expense` usan `approval: always()`; las lecturas (`list_expenses`, `get_spending_summary`, etc.) no piden aprobación.
- `tests/`: cubren DB, tools, monedas, fechas, categorías y la tarjeta de aprobación.

### Reglas del dominio

- **Nunca escribir en SQLite sin aprobación humana.** Toda tool de escritura debe tener `approval: always()`.
- Cada gasto guarda `currency` y `amount_minor` (unidad mínima). No usar floats para montos.
- **Nunca sumar monedas distintas.** Los reportes se agrupan por moneda.
- `spent_on` es la fecha del gasto (`YYYY-MM-DD`); `created_at` es cuándo se anotó. No mezclarlos.
- Si no se indica fecha, usar hoy en la zona horaria del usuario; rechazar fechas futuras.
- No procesar fotos ni archivos: solo texto y audio.
- No registrar ingresos; el alcance v1 es solo gastos.
- Los mensajes del bot son texto plano, sin Markdown, con emojis y viñetas.
- No tocar `agent/agent.ts` (modelo y contexto) salvo pedido explícito.

### Deploy y secretos

- No commitear `.env`, `data/`, `.eve/`, `.output/` ni `node_modules/`.
- El webhook de Telegram debe incluir `allowed_updates: ["message", "callback_query"]`; sin `callback_query` no funcionan los botones.
- SQLite necesita filesystem persistente. Vercel serverless no es apto para esta app; usar VPS con volumen o Turso.
- El deploy de VPS está documentado en `docs/plans/setup-vps-ubuntu.sh`.
- Para Oracle Cloud con Ubuntu, la guía completa está en `docs/plans/deploy-oracle-ubuntu.md` (Security List/NSG, iptables, DNS, Tailscale SSH/Funnel y backups).
- Si se usa Tailscale Funnel, no levantar Caddy: `docker compose -f docker-compose.yml -f docker-compose.tailscale.yml up -d` y `tailscale funnel --bg 3000`.
- Si se cambia el esquema o el contrato de una tool, actualizar tests, `README.md` y estas notas.

## Read the docs before writing code

```sh
ls node_modules/eve/docs
```

Start with `docs/README.md`: it maps each task to the page that covers it. Read that page before authoring tools, connections, channels, skills, subagents, schedules, or deployment. In a workspace or local package install, resolve the installed `eve` package location first. If the package docs are missing, use https://eve.dev/docs.

Use a bounded authoring loop:

1. Read the relevant page and inspect only files you will modify or need to imitate.
2. Stop discovery once the file location, imports, and definition shape are clear. Implement the smallest complete behavior the user requested.
3. Run one narrow verification. Expand investigation only when it fails or the request needs project-specific details.

Follow links or inspect public types only when the routed page leaves the task unanswered. Do not recursively glob `node_modules`, enumerate the entire docs tree, or read unrelated scaffold files when the direct path is known. Package-manager links can hide files from recursive glob tools even though direct reads work.

## Prefer an existing integration

When a task names an external product or service, search the registry before implementing its integration. For a generic capability, author a tool instead.

```sh
eve registry search <query> --json
eve registry view <item>
```

Prefer items whose `implementation` is `native`; use Chat SDK adapters when no native channel fits. `registry view` links the item's documentation.

Install without driving interactive prompts:

```sh
eve add <item> --non-interactive
```

Exit code 0 means setup completed, 1 failed, and 2 needs an answer or a prerequisite. On exit 2, run the `next.command` from the final NDJSON event. For a non-secret question, replace its `<JSON value>` answer placeholder with the answer you collected; string values need JSON quotes. Never pass a secret in `--answer`. See `docs/install-integrations.mdx` for setup prerequisites.

## Use eve for Vercel operations

Use eve to link and deploy Vercel projects:

```sh
eve link --non-interactive --project <name-or-id> [--team <team-id-or-slug>]
eve deploy --non-interactive --yes [--project <name-or-id>]
```

A setup may report `eve link` as a prerequisite; run it, then retry the continuation. When a completed setup event has `deploymentRequired: true`, run the `next` command it reports.

## Validate the change

Run the validation the task requests. When it does not establish the behavior you changed, run the narrowest relevant check.
