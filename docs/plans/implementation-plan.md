# Detailed Implementation Plan: Telegram Calorie, Macro & Exercise Tracking Agent
**Project:** Telegram Agent powered by `eve` + OpenRouter + SQLite (`@libsql/client`)  
**Date:** October 2026  
**Repository Location:** `/Users/ramiro/my-agent`

---

## 1. Architecture & Design Principles

### 1.1. Core System Principles
- **Mathematical Determinism:** The Language Model (LLM) never performs arithmetic sums, subtractions, or cumulative balance calculations in its context window. All arithmetic is delegated strictly to SQL queries in SQLite.
- **Strict Daily Isolation:** Every food and exercise entry is indexed by `date` (`YYYY-MM-DD`). Summary queries filter exclusively by `WHERE user_id = ? AND date = ?`. When midnight strikes in the user's local timezone, the daily balance resets to 0 automatically without data contamination from previous days.
- **Multi-Tenant / Multi-User Isolation:** Each Telegram chat/user has a unique principal identifier propagated through `eve`'s authentication context (`ctx.session.auth.current.principalId`).
- **Immediate Feedback Loop:** Every call to `log_food` or `log_exercise` calculates and returns the consolidated day status within the same step, enabling the agent to output the updated visual summary card in the same turn.
- **Localization & Timezone (Spanish & Buenos Aires):**
  - **User-Facing Language:** **Spanish** (`es-AR` / friendly, natural Spanish). The agent logs, calculates, and talks to users in Spanish.
  - **Default Timezone:** **`America/Argentina/Buenos_Aires` (UTC-3)**. All daily date boundaries, midnight resets, and timestamps are calculated relative to Buenos Aires time.
- **Mandatory & Blocking Onboarding (`configured` flag):**
  - If a user has `configured = 0` (`setup_complete = false`), logging is **completely blocked**.
  - The agent refuses to record meals or workouts until onboarding is completed.
  - Asks for: current weight, target weight (or goal), and physical activity level.
  - Calls `calculate_macro_goals` to scientifically compute maintenance (TDEE), target calories, and macro grams.
  - Confirms proposal with the user before saving with `set_user_goals`.
- **Real Food Database (Two-Tier Architecture):**
  - Eliminates LLM guesswork by providing verified nutritional profiles.
  - **Tier 1 (Local SQLite `foods_catalog`):** Curated whole foods, meats, staples, and Latin American dishes with zero latency.
  - **Tier 2 (Open Food Facts REST API):** Free access to >3,000,000 commercial and packaged products worldwide with automatic local caching.

```
Telegram Message (Text / Photo / Voice Note)
                    │
                    ▼
┌────────────────────────────────────────────────────────┐
│  agent/channels/telegram.ts                            │
│  - Photos: uploadPolicy (image/*)                      │
│  - Audio: hook onMessage -> transcribe.ts (Whisper)    │
└───────────────────┬────────────────────────────────────┘
                    │ Text / Images
                    ▼
┌────────────────────────────────────────────────────────┐
│  agent/agent.ts (OpenRouter: Gemini / Claude / Llama) │
│  + agent/instructions.md (Coach guidelines)            │
└───────────────────┬────────────────────────────────────┘
                    │ Tool Calls
                    ▼
┌────────────────────────────────────────────────────────┐
│  agent/tools/                                          │
│  - get_user_profile (checks setup_complete)            │
│  - calculate_macro_goals (Mifflin-St Jeor + TDEE)     │
│  - set_user_goals (saves goals, marks configured=1)    │
│  - search_food_database (Open Food Facts + local DB)   │
│  - log_food / log_exercise (BLOCKS if not configured)  │
│  - get_daily_summary (on-demand balance query)         │
└───────────────────┬────────────────────────────────────┘
                    │ SQL INSERT / SELECT
                    ▼
┌────────────────────────────────────────────────────────┐
│  agent/lib/db.ts (SQLite via @libsql/client)           │
│  - users table (goals, timezone, configured flag)      │
│  - foods_catalog table (real nutrition data & cache)   │
│  - food_logs table (intake with date YYYY-MM-DD)       │
│  - exercise_logs table (burn with date YYYY-MM-DD)     │
└────────────────────────────────────────────────────────┘
```

---

## 2. Scientific Calorie & Macro Calculation Methodology

The calculator tool `calculate_macro_goals` implements the standard sports science framework:

### 1. Basal Metabolic Rate (BMR) - Mifflin-St Jeor
$$BMR = (10 \times \text{weight}_{kg}) + (6.25 \times \text{height}_{cm}) - (5 \times \text{age}) + s$$
Where $s = +5$ for men, $-161$ for women. If sex, age, or height are not provided by the user, defaults of `age = 30`, `height = 170cm`, and a neutral average constant ($s = -78$) are applied, or roughly $22 \times \text{weight}_{kg}$.

### 2. Total Daily Energy Expenditure (TDEE)
$$\text{TDEE} = \text{BMR} \times \text{Activity Factor}$$
- `sedentary`: $\times\ 1.200$ (Desk work, little/no intentional training)
- `light`: $\times\ 1.375$ (Light workouts 1–3 days/week)
- `moderate`: $\times\ 1.550$ (Moderate lifting/cardio 3–5 days/week)
- `intense`: $\times\ 1.725$ (Intense training 6–7 days/week)

### 3. Caloric Goal Adjustment (Current vs. Target Weight)
- **Weight Loss (Target < Current):** $\text{Deficit} = 400 - 500\text{ kcal}$ (or $-15\%$ to $-20\%$ of TDEE). Minimum safety threshold: $1,200\text{ kcal/day}$.
- **Weight Gain / Muscle Building (Target > Current):** $\text{Surplus} = +250\text{ to } +350\text{ kcal}$ (or $+10\%$ of TDEE).
- **Maintenance (Target = Current):** Equal to TDEE.

### 4. Macro Allocation
- **Protein (4 kcal/g):**
  - Fat loss: $2.0\text{ g/kg}$ of body weight (preserves lean muscle mass in deficit).
  - Maintenance / Surplus: $1.8\text{ g/kg}$.
  - $\text{Protein Calories} = \text{Grams of Protein} \times 4$.
- **Fats (9 kcal/g):**
  - $25\%$ of total daily calories for hormonal health.
  - $\text{Grams of Fat} = \frac{\text{Total Calories} \times 0.25}{9}$.
- **Carbohydrates (4 kcal/g):**
  - Fills the remainder of daily calories.
  - $\text{Remaining Calories} = \text{Total Calories} - (\text{Protein Calories} + \text{Fat Calories})$.
  - $\text{Grams of Carbohydrates} = \frac{\text{Remaining Calories}}{4}$.

---

## 3. Technical Specification by Phase

---

### PHASE 1: Database, Date Management & Persistence *(Status: Implemented ✅)*

- **Package Dependencies:** `@libsql/client`, `@openrouter/ai-sdk-provider`.
- **Date Module (`agent/lib/date.ts`):** `getUserToday(timezone)` formats `YYYY-MM-DD` in Buenos Aires timezone.
- **Database Module (`agent/lib/db.ts`):** 
  - `users` table with `user_id`, `daily_calorie_goal`, `protein_goal`, `carbs_goal`, `fat_goal`, `timezone`, and `configured INTEGER DEFAULT 0`.
  - `food_logs` and `exercise_logs` tables with composite indexes on `(user_id, date)`.
  - Helper functions: `getDailySummary`, `saveFoodLog`, `saveExerciseLog`, `getOrCreateUser`, `updateUserGoals`.

---

### PHASE 2: Core Tools & Mandatory Setup Blocker *(Status: Implemented ✅)*

#### 2.1. `agent/tools/get_user_profile.ts` *(Implemented ✅)*
- Returns current goals and `setup_complete` (`configured === 1`).

#### 2.2. `agent/tools/calculate_macro_goals.ts` *(Implemented ✅)*
- Calculates BMR (Mifflin-St Jeor), TDEE, suggested calorie goal (deficit/surplus), and macro distribution (protein, carbs, fat).

#### 2.3. `agent/tools/set_user_goals.ts` *(Implemented ✅)*
- Saves goals and marks `configured = 1` in the database.

#### 2.4. `agent/tools/log_food.ts` *(Implemented ✅)*
- **Strict Guard:** Checks `user.configured`. If `false`, returns `{ setup_required: true, error: "..." }` and refuses insertion.
- When configured, inserts into `food_logs` and returns updated daily summary.

#### 2.5. `agent/tools/log_exercise.ts` *(Implemented ✅)*
- **Strict Guard:** Checks `user.configured`. If `false`, returns `{ setup_required: true, error: "..." }` and refuses insertion.
- When configured, inserts into `exercise_logs` and returns updated daily summary with calories subtracted.

#### 2.6. `agent/tools/get_daily_summary.ts` *(Implemented ✅)*
- On-demand query for the day's calorie and macro status.

---

### PHASE 3: Real Food & Nutrition Database (`foods_catalog` & API) *(Status: Pending Implementation ⏳)*

#### 3.1. Database Schema (`foods_catalog` Table in SQLite)
```sql
CREATE TABLE IF NOT EXISTS foods_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  brand TEXT,
  calories_per_100g REAL NOT NULL,
  protein_per_100g REAL NOT NULL DEFAULT 0,
  carbs_per_100g REAL NOT NULL DEFAULT 0,
  fat_per_100g REAL NOT NULL DEFAULT 0,
  serving_size_grams REAL DEFAULT 100,
  source TEXT DEFAULT 'curated', -- 'curated' | 'open_food_facts'
  barcode TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_foods_catalog_name ON foods_catalog (name);
CREATE INDEX IF NOT EXISTS idx_foods_catalog_barcode ON foods_catalog (barcode);
```

#### 3.2. Curated Seed Data
Seed database with common staples (per 100g):
- Pechuga de pollo cocida: 165 kcal, 31g P, 0g C, 3.6g G
- Arroz blanco cocido: 130 kcal, 2.7g P, 28g C, 0.3g G
- Huevo entero (unidad ~50g): 72 kcal, 6.3g P, 0.4g C, 4.8g G
- Carne vacuna magra (lomo/cuadril): 143 kcal, 26g P, 0g C, 3.5g G
- Papa hervida: 87 kcal, 1.9g P, 20g C, 0.1g G
- Avena: 389 kcal, 16.9g P, 66.3g C, 6.9g G
- Manzana: 52 kcal, 0.3g P, 14g C, 0.2g G
- Banana: 89 kcal, 1.1g P, 23g C, 0.3g G
- Empanada de carne al horno (unidad ~100g): 250 kcal, 10g P, 26g C, 11g G
- Porción pizza muzzarella (~120g): 320 kcal, 14g P, 34g C, 14g G

#### 3.3. Open Food Facts REST Client (`agent/lib/nutrition-api.ts`)
- Query endpoint: `https://world.openfoodfacts.org/cgi/search.pl?search_terms={query}&search_simple=1&action=process&json=1&page_size=5`
- Barcode endpoint: `https://world.openfoodfacts.org/api/v2/product/{barcode}.json`
- Extracts: `product_name`, `brands`, `nutriments["energy-kcal_100g"]`, `proteins_100g`, `carbohydrates_100g`, `fat_100g`.
- Caches results automatically in `foods_catalog` table.

#### 3.4. Lookup Tool (`agent/tools/search_food_database.ts`)
- **Input Schema:**
  ```ts
  z.object({
    query: z.string().describe("Nombre del alimento o producto comercial a buscar (ej. 'pechuga de pollo', 'alfajor havanna', 'coca zero')"),
    amountGrams: z.number().positive().optional().describe("Cantidad en gramos si se conoce (ej. 150)"),
    barcode: z.string().optional().describe("Código de barras numérico si fue proporcionado"),
  })
  ```
- **Action:** Searches local catalog first; queries Open Food Facts API if needed. Calculates exact portions.
- **Output:** Returns list of matches with exact nutritional values.

---

### PHASE 4: Onboarding Workflow & Model Instructions *(Status: Implemented ✅)*

- Updated [agent/instructions.md](file:///Users/ramiro/my-agent/agent/instructions.md) with:
  1. Strict blocking setup rule: when `setup_complete: false`, no logging allowed.
  2. Clear onboarding conversation steps.
  3. Guidance to use `search_food_database` before logging meals to ensure real nutritional accuracy.

---

### PHASE 5: Model & Telegram Channel Setup *(Status: Implemented ✅)*

- **OpenRouter (`agent/agent.ts`):** Configured with `@openrouter/ai-sdk-provider`.
- **Telegram Channel (`agent/channels/telegram.ts`):** 
  - Photos enabled via `uploadPolicy`.
  - Voice notes intercepted in `onMessage`, downloaded, and transcribed in Spanish via Whisper (`agent/lib/transcribe.ts`).

---

### PHASE 6: Testing & Verification *(Status: Pending ⏳)*

- Test `calculate_macro_goals` and setup blocker.
- Test `search_food_database` with local staples and commercial Open Food Facts products.
- Verify date isolation across midnight Buenos Aires time.

---

### PHASE 7: Containerization & Deployment *(Status: Pending ⏳)*

- `Dockerfile` multi-stage build.
- `docker-compose.yml` with persistent volume `./data:/app/data`.
- Caddy reverse proxy with automatic SSL (`sslip.io` / DuckDNS).
- Register Telegram webhook.
- Ubuntu VPS bootstrap script: `docs/plans/setup-vps-ubuntu.sh`.

Run it from a clean Ubuntu VPS after cloning or by providing the repository URL:

```bash
REPO_URL=https://github.com/<org>/<repo>.git \\
  bash docs/plans/setup-vps-ubuntu.sh
```

The script installs Docker, prepares persistent directories, creates `.env` from
`.env.example` when needed, starts the Compose stack, and registers the Telegram
webhook. It never generates or prints secrets; complete `.env` before rerunning.
