# Pilot Tutor Platform

All-in-one study platform: participants open a personal link, complete a short intro, then do the **same task block once in each language condition** (L1 English only, L2 French only, Mixed English and French) in a counterbalanced order, and finish with demographic questions. Each task block can contain a timed tutor chat (Claude, speaking that condition's language) and questions: **sliders** (single dot, starting in the middle), **multiple choice**, **text answers** and **information text**. Researchers build the study, monitor participants and export the data from `/admin`.

Stack: Next.js (Vercel) - Turso / libSQL (SQLite) - Claude API (or any OpenAI-compatible provider).

## 1. Setup

| Variable | Purpose |
|---|---|
| `TURSO_DATABASE_URL` | `libsql://…turso.io` (unset locally → `file:local.db`) |
| `TURSO_AUTH_TOKEN` | Turso database token |
| `ANTHROPIC_API_KEY` | Claude API key — server only, never sent to the browser |
| `ADMIN_PASSWORD` | Researcher dashboard password |
| `ADMIN_SESSION_SECRET` | Long random string used to sign admin cookies |
| `LLM_BASE_URL`, `LLM_API_KEY` | Only for provider `openai_compatible` |
| `LLM_MOCK` | `1` = simulated tutor replies (testing only) |

Local: `npm install && ADMIN_PASSWORD=x LLM_MOCK=1 npm run dev`. Tables are created automatically on first request.

## 2. Building the study (Admin, Study design)

- **Conditions**: ID, name, tutor language rule and opening message for each condition. Order: counterbalanced (all possible orders used equally, in shuffled blocks) or fixed.
- **Sections**: 1. Start (shown once), 2. Task block (repeated once per condition), 3. End (demographics). Each section has pages; each page has questions.
- **Question types**: information text, slider (min, max, start, step, end labels), multiple choice (single or several answers), text answer, tutor chat (length in minutes, task/topic for the tutor). Any question text can differ per condition.
- The page shows the **estimated total time** (target: 20 minutes or less).
- Saving creates a frozen version. Participants keep the version that was active when they first opened their link.

## 3. Data

Exports: answers (one row per participant, columns like `understanding_L1`, `understanding_L2`, `understanding_MIX`), answers (one row per answer), participant summary, chats summary, chat messages (CSV/JSON), event log, invitation list, full backup. All UTF-8.

## 4. Tests

`tests/acceptance.py` (40 checks) runs in GitHub Actions on every push: approval, counterbalancing across 12 simultaneous arrivals, chat timer and expiry, duplicate-click protection, required-answer validation, per-condition text and tutor rules, demographics at the end, exports, stop and delete.
