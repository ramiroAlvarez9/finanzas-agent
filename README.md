# finanzas-agent

Agente de Telegram para gestionar gastos personales, construido con [eve](https://eve.dev).

## Qué hace

- Anota gastos por texto o nota de voz.
- Antes de escribir en SQLite, manda una tarjeta de confirmación con botones **✅ Confirmar** y **❌ Cancelar**.
- Guarda el gasto con fecha, concepto, monto, moneda y categoría.
- Permite eliminar un gasto (con confirmación) y muestra los totales actualizados.
- Consulta gastos por día, semana, mes, mes pasado, año o rango personalizado.
- Maneja varias monedas ISO 4217 y **nunca mezcla monedas** en un mismo total.
- No procesa fotos: solo texto y audio.

## Categorías

`supermercado`, `comida`, `vivienda`, `servicios`, `transporte`, `salud`, `ocio`, `compras`, `educacion`, `mascotas`, `familia`, `trabajo`, `suscripciones_ia`, `impuestos`, `deudas`, `ahorro`, `viajes`, `otros`.

## Requisitos

- Node.js 24.
- pnpm 11.
- Un bot de Telegram.
- Una API key de OpenRouter.
- Una API key de AssemblyAI para el modo voz.
- Un `ACCESS_CODE` para que el bot sea privado.

## Desarrollo

Si usás nvm:

```bash
nvm use
```

Después:

```bash
pnpm install
cp .env.example .env
# completá las variables
pnpm dev
```

El TUI de eve permite probar el agente sin Telegram. Para probar los botones y el modo voz necesitás el webhook de Telegram.

## Variables de entorno

```env
OPENROUTER_API_KEY=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_BOT_USERNAME=...
TELEGRAM_WEBHOOK_SECRET_TOKEN=...
ASSEMBLYAI_API_KEY=...
ASSEMBLYAI_LANGUAGE_CODE=es
ACCESS_CODE=...
DATABASE_URL=file:data/finanzas.db
DOMAIN=finanzas.mi-dominio.com
```

La base SQLite se guarda en `data/finanzas.db` por defecto.

## Webhook de Telegram

El webhook tiene que aceptar `message` y `callback_query` para que funcionen los botones:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url":"https://finanzas.mi-dominio.com/eve/v1/telegram",
    "secret_token":"'"$TELEGRAM_WEBHOOK_SECRET_TOKEN"'",
    "allowed_updates":["message","callback_query"]
  }'
```

En desarrollo podés usar un túnel (Cloudflare Tunnel, ngrok) y apuntar el webhook a la URL pública.

## Primer uso

1. Mandá `/start <ACCESS_CODE>` al bot.
2. Probá: “Gasté 12.500 en el almuerzo”.
3. Confirmá la tarjeta.
4. Consultá: “¿Cuánto gasté este mes?”.
5. Borrá un gasto: “Restá el gasto del almuerzo”.

## Tests

```bash
pnpm test
pnpm typecheck
pnpm build
```

## Deploy

El proyecto incluye `Dockerfile`, `docker-compose.yml` y `Caddyfile`.

```bash
docker compose up -d --build
```

Asegurate de tener un volumen persistente para `./data` y de registrar el webhook después del deploy.

> SQLite necesita un filesystem persistente. Vercel serverless no es una buena opción para esta app; si querés usar Vercel, usá Turso (libSQL) o Postgres.

## Estructura

```text
agent/
  agent.ts                 modelo y configuración del agente
  instructions.md          identidad y reglas del asistente
  channels/telegram.ts     Telegram, voz, rechazo de fotos y tarjetas de confirmación
  lib/
    categories.ts          catálogo de categorías
    db.ts                  SQLite, usuarios, gastos y reportes
    money.ts               monedas, unidades mínimas y formato
    periods.ts             fechas y períodos
    approval-message.ts    texto de las tarjetas de confirmación
    presentation.ts        formato de gastos y resúmenes
  tools/
    log_expense.ts         anotar gasto (con approval)
    list_expenses.ts       listar/buscar gastos
    delete_expense.ts      eliminar gasto (con approval)
    get_spending_summary.ts resumen por período
    list_categories.ts     catálogo de categorías
    get_user_profile.ts    perfil del usuario
    update_user_settings.ts moneda/zona horaria
```
