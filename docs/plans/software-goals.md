# Software Goals & Technical Specification
**Project:** Telegram Calorie, Macro & Exercise Tracking Agent  
**Framework:** `eve` (Vercel Agent Framework)  
**Date:** October 2026  

---

## 1. Vision & Core Purpose

The primary goal is to build a **24/7 personal nutrition and fitness assistant agent accessible via Telegram**. The agent eliminates the friction of traditional, manual tracking apps (e.g., MyFitnessPal) by enabling natural, conversational logging via **text, photos of meals/nutrition labels, and voice notes**.

The system deterministically computes the **net daily caloric balance** by subtracting exercise-burned calories from food consumption, providing an **instant visual summary after every interaction**.

> [!IMPORTANT]
> **Localization & Defaults:**
> - **User-Facing Language:** **Spanish** (`es-AR` / neutral friendly Spanish). The agent speaks, responds, and renders summaries in Spanish.
> - **Default Timezone:** **`America/Argentina/Buenos_Aires` (UTC-3)**. All daily date boundaries, midnight resets, and timestamps are computed relative to Buenos Aires time.

---

## 2. Core Functional Requirements

### 2.1. Intelligent Multimodal Input
1. **Natural Text Input (in Spanish):**
   - Parse everyday food descriptions (*"Me comí dos porciones de tarta de jamón y queso y una manzana"*).
   - Parse workout activities (*"Jugué al fútbol 1 hora"* or *"Salí a correr 30 min a 5:30 min/km"*).
2. **Voice Note Input:**
   - Intercept Telegram voice notes (`message.voice`), transcribe them in real time with AssemblyAI Speech-to-Text (STT), and forward the transcribed text directly to the model.
3. **Image / Photo Input:**
   - Allow users to send photos of their plates or nutrition label stickers to estimate ingredients, portions, and calories using multimodal vision capabilities.

### 2.2. Mandatory & Blocking Onboarding Setup
When a user begins using the bot for the first time (`configured = 0` / `setup_complete = false`), **the setup is strictly mandatory and blocking**:
1. **Strict Blocker:** The bot **refuses to log any food or exercise** until the user completes onboarding. Any attempt to log prior to setup triggers a friendly refusal prompting for setup data.
2. **Setup Questionnaire:** The agent asks for:
   - **Current Weight** (e.g., in kg).
   - **Target Weight / Goal** (e.g., lose fat, maintain, or gain muscle / target kg).
   - **Daily Physical Activity Level** (sedentary, light, moderate, intense).
   - *(Optional: age, height, and biological sex for maximum formula accuracy).*
3. **Deterministic Calculation via Tool:** The agent calls `calculate_macro_goals` (Mifflin-St Jeor BMR + TDEE + Deficit/Surplus + Macro Allocation).
4. **Proposal & Confirmation:** The agent explains the calculated maintenance expenditure (TDEE), suggested calorie goal, and macro split. Upon confirmation, `set_user_goals` is executed to save the profile and set `configured = 1`, unlocking logging capabilities.

### 2.3. Real Food & Nutrition Database
To eliminate LLM hallucinations and inconsistent calorie estimates, the system integrates a **two-tier real nutritional database**:
1. **Tier 1: Local Curated Food Catalog (SQLite `foods_catalog` table):**
   - Pre-populated with baseline staples and everyday Latin American / Argentine foods (chicken breast, eggs, beef cuts, white/brown rice, potatoes, oats, olive oil, empanadas, etc.) with exact verified calories, proteins, carbohydrates, and fats per 100g.
   - Ultra-fast retrieval (<5ms) and 100% offline reliability.
2. **Tier 2: Open Food Facts API (Global Packaged Products):**
   - Access to >3,000,000 branded and commercial products (dairy, snacks, beverages, cookies, alfajores, yogurts).
   - Free, open-source REST API without API key restrictions.
   - Products fetched from Open Food Facts are automatically cached locally in SQLite for instant future recall.
3. **Lookup Tool (`search_food_database`):**
   - The agent consults verified nutritional values before logging meals to ensure real-world scientific accuracy.

### 2.4. Deterministic Accounting & Metrics
1. **Exact Calorie Calculation:**
   $$\text{Net Calories} = \text{Consumed Calories} - \text{Burned Calories (Exercise)}$$
   $$\text{Remaining Calories} = \text{Daily Goal} - \text{Net Calories}$$
2. **Macronutrient Tracking:**
   - Cumulative tracking for Protein (g), Carbohydrates (g), and Fat (g).
   - Comparison against daily user-configured targets.
3. **Calculations in Code, Not LLM Memory:**
   - Sums, subtractions, and daily aggregations are calculated strictly via SQL queries inside agent tools, ensuring 100% mathematical precision.

### 2.5. Immediate Feedback Loop (Proactive UX)
1. **Automatic Post-Response Summary:**
   - Every time a meal or workout is logged, the bot returns an updated visual card in Spanish showing the daily balance and remaining calories.
2. **On-Demand Queries:**
   - Instant responses to queries like *"¿Cómo vengo hoy?"*, *"¿Qué me queda para cenar?"*, or *"Mostrame el resumen de hoy"*.

### 2.6. Multi-Tenant Architecture (Multi-User)
1. **Strict User Data Isolation:**
   - Multiple users can interact with the bot concurrently.
   - Each user is uniquely identified by their Telegram `user_id` / `principalId`.
   - All tables (`food_logs`, `exercise_logs`, `users`) are partitioned by `user_id`, preventing data cross-contamination.

---

## 3. Scientific Calculation Formula (Nutrition & Macro Methodology)

The calculator tool `calculate_macro_goals` utilizes the peer-reviewed **Mifflin-St Jeor** framework combined with sports nutrition macronutrient allocation:

### Step 1: Basal Metabolic Rate (BMR)
$$\text{BMR (Men)} = (10 \times \text{weight}_{kg}) + (6.25 \times \text{height}_{cm}) - (5 \times \text{age}) + 5$$
$$\text{BMR (Women)} = (10 \times \text{weight}_{kg}) + (6.25 \times \text{height}_{cm}) - (5 \times \text{age}) - 161$$
*(If height/age/sex are omitted, an average baseline of $\approx 22 \times \text{weight}_{kg}$ or neutral population constants height = 170cm, age = 30 are used as defaults).*

### Step 2: Total Daily Energy Expenditure (TDEE / Maintenance)
$$\text{TDEE} = \text{BMR} \times \text{Activity Factor}$$

| Activity Level | Description | Multiplier |
|---|---|---|
| `sedentary` | Desk job, little or no exercise | $\times\ 1.2$ |
| `light` | Light exercise 1–3 days/week | $\times\ 1.375$ |
| `moderate` | Moderate exercise 3–5 days/week | $\times\ 1.55$ |
| `intense` | Hard exercise 6–7 days/week | $\times\ 1.725$ |

### Step 3: Calorie Goal Adjustment (Current vs. Target Weight)
- **Weight Loss (Target < Current):** Moderate deficit of **400–500 kcal/day** (or $\approx 15-20\%$ reduction from TDEE). Minimum safety threshold: 1,200 kcal/day.
- **Weight Gain / Muscle Building (Target > Current):** Controlled surplus of **250–350 kcal/day** (or $\approx 10\%$ above TDEE).
- **Maintenance (Target = Current):** Exact TDEE.

### Step 4: Macronutrient Split
- **Protein (4 kcal/g):**
  - Deficit / Fat Loss: $1.8 - 2.0\text{ g/kg}$ of body weight (preserves lean mass).
  - Maintenance / Surplus: $1.8\text{ g/kg}$.
  - $\text{Protein Calories} = \text{Grams of Protein} \times 4$.
- **Fat (9 kcal/g):**
  - Essential hormone support: $25\%$ of total target calories.
  - $\text{Grams of Fat} = (\text{Target Calories} \times 0.25) / 9$.
- **Carbohydrates (4 kcal/g):**
  - Supplies the remaining daily energy.
  - $\text{Remaining Calories} = \text{Target Calories} - (\text{Protein Calories} + \text{Fat Calories})$.
  - $\text{Grams of Carbohydrates} = \text{Remaining Calories} / 4$.

---

## 4. Architecture & Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Agent & Orchestration** | `eve` Framework | Native Telegram channel, durable sessions, typed tool execution, and scheduling. |
| **Messaging Channel** | `eve/channels/telegram` | Official Telegram Bot API webhook support with attachments and message lifecycle hooks. |
| **Language Model (LLM)** | OpenRouter (`@openrouter/ai-sdk-provider`) | Flexibility to use fast, cost-effective multimodal models (e.g., Gemini 2.5 Flash, Claude 3.5 Sonnet, Llama 3.3). |
| **Real Food Database** | SQLite `foods_catalog` + Open Food Facts API | Two-tier verified nutrition: local staples + 3M+ packaged items worldwide. |
| **Audio Transcription** | AssemblyAI STT | Transcribes Telegram `.ogg` Opus audio to Spanish text in ~300 ms. |
| **Database** | SQLite via `@libsql/client` | Lightweight relational DB, zero-config local file storage for local dev and VPS, drop-in compatible with Turso if serverless is needed. |
| **Deployment & Ops** | Docker + Docker Compose + Caddy | Isolated containerization, persistent volume mounts for SQLite, and automated HTTPS via `sslip.io` or DuckDNS. |

---

## 5. Database Schema (SQLite)

```sql
-- User goals, onboarding state, and timezone preferences
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  daily_calorie_goal INTEGER DEFAULT 2000,
  protein_goal INTEGER DEFAULT 150,
  carbs_goal INTEGER DEFAULT 200,
  fat_goal INTEGER DEFAULT 65,
  timezone TEXT DEFAULT 'America/Argentina/Buenos_Aires',
  configured INTEGER NOT NULL DEFAULT 0, -- 0: Pending onboarding (BLOCKING), 1: Setup completed
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Real food nutrition catalog & cache
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

-- Food consumption logs
CREATE TABLE IF NOT EXISTS food_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL, -- Formatted as ISO YYYY-MM-DD (Buenos Aires time)
  name TEXT NOT NULL,
  calories INTEGER NOT NULL,
  protein REAL DEFAULT 0,
  carbs REAL DEFAULT 0,
  fat REAL DEFAULT 0,
  meal_type TEXT,     -- desayuno, almuerzo, merienda, cena, snack
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);
CREATE INDEX IF NOT EXISTS idx_food_logs_user_date ON food_logs (user_id, date);

-- Exercise & physical activity logs
CREATE TABLE IF NOT EXISTS exercise_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL, -- Formatted as ISO YYYY-MM-DD (Buenos Aires time)
  activity TEXT NOT NULL,
  duration_minutes INTEGER,
  calories_burned INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);
CREATE INDEX IF NOT EXISTS idx_exercise_logs_user_date ON exercise_logs (user_id, date);
```

---

## 6. Agent Tools (`agent/tools/`)

1. **`get_user_profile.ts`**
   - **Input:** `{}`
   - **Action:** Retrieves user profile, goals, and `setup_complete` (`configured === 1`).
   - **Output:** Current goals + setup status.

2. **`calculate_macro_goals.ts` (Calculator Tool)**
   - **Input:** `{ currentWeightKg: number, targetWeightKg: number, activityLevel: "sedentary" | "light" | "moderate" | "intense", gender?: "male" | "female", heightCm?: number, age?: number }`
   - **Action:** Computes BMR, TDEE, recommended daily calorie intake (deficit/surplus), and macro breakdown (protein, carbs, fat in grams).
   - **Output:** `{ bmr, tdee, calorieGoal, proteinGoal, carbsGoal, fatGoal, explanation }`.

3. **`set_user_goals.ts`**
   - **Input:** `{ calorieGoal?: number, proteinGoal?: number, carbsGoal?: number, fatGoal?: number, timezone?: string }`
   - **Action:** Updates user goals and marks `configured = 1` (`setup_complete = true`).
   - **Output:** Updated user goals and confirmation.

4. **`search_food_database.ts` (Real Nutritional Database Tool)**
   - **Input:** `{ query: string, amountGrams?: number, barcode?: string }`
   - **Action:** Searches local SQLite `foods_catalog` first; falls back to Open Food Facts API. Scales calories and macros to the requested weight.
   - **Output:** Exact verified nutritional values (calories, protein, carbs, fat) and food source.

5. **`log_food.ts`**
   - **Input:** `{ name: string, calories: number, protein?: number, carbs?: number, fat?: number, mealType?: string, date?: string }`
   - **Action:** Refuses if `configured === 0`. If configured, inserts into `food_logs` and executes daily aggregation query.
   - **Output:** Logged item details + updated `daily_summary`.

6. **`log_exercise.ts`**
   - **Input:** `{ activity: string, durationMinutes?: number, caloriesBurned: number, date?: string }`
   - **Action:** Refuses if `configured === 0`. If configured, inserts into `exercise_logs` and executes daily aggregation query.
   - **Output:** Logged workout details + updated `daily_summary`.

7. **`get_daily_summary.ts`**
   - **Input:** `{ date?: string }` (defaults to user's today in Buenos Aires timezone).
   - **Action:** Aggregates food intake, exercise burn, net calories, and goal deltas.
   - **Output:** Complete calorie breakdown and macro stats.

---

## 7. Visual Telegram Report Format (Spanish User Experience)

Every bot response that logs or queries fitness data concludes with this standardized summary card:

```text
Anotado: Pechuga de pollo (200g) con arroz (150g) (~520 kcal) 🍗🍚

📊 Balance de Hoy:
• Ingesta: 1.420 kcal
• Ejercicio: -350 kcal (Running 30m) 🏃
• Neto: 1.070 kcal / 2.000 kcal
• Restantes: 930 kcal disponibles ✅

🥩 Macros de Hoy:
• Proteína: 115g / 150g
• Carbohidratos: 140g / 200g
• Grasas: 38g / 65g
```

---

## 8. Implementation Roadmap

- [x] **Phase 1: Database & Date Layer**
  - Installed `@libsql/client` and initialized migrations in `agent/lib/db.ts` and `agent/lib/date.ts`.
  - Implemented daily aggregation and timezone-aware queries (defaulting to `America/Argentina/Buenos_Aires`).
- [x] **Phase 2: Core Tools & Mandatory Setup Blocker**
  - Implemented `log_food` and `log_exercise` with strict `configured` blocking checks.
  - Implemented `get_daily_summary`, `get_user_profile`, and `set_user_goals`.
- [x] **Phase 3: Setup Onboarding & Macro Calculator**
  - Implemented `calculate_macro_goals.ts` using Mifflin-St Jeor & TDEE.
  - Updated `agent/instructions.md` with blocking onboarding workflow.
- [ ] **Phase 4: Real Food Database & Lookup Tool**
  - Create table `foods_catalog` with baseline seed data (staple whole foods).
  - Implement Open Food Facts REST API client with local SQLite caching.
  - Implement `agent/tools/search_food_database.ts`.
- [x] **Phase 5: Model & Telegram Channel Setup**
  - Configured OpenRouter in `agent/agent.ts`.
  - Configured `agent/channels/telegram.ts` with image support and Spanish voice transcription in `onMessage`.
- [ ] **Phase 6: Local Testing & Validation**
  - Verify calculator tool and onboarding dialogue.
  - Verify real food database queries.
  - Verify date boundary isolation (Buenos Aires midnight reset) and multi-user isolation with `eve dev`.
- [ ] **Phase 7: Containerization & VPS Deployment**
  - Create `Dockerfile` and `docker-compose.yml`.
  - Configure Caddy with automatic SSL (`sslip.io` / DuckDNS).
  - Register webhook with Telegram Bot API.
