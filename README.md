# Pilot Tutor Platform

Web platform for the pilot study: participants open a link (or enter an access code), are randomly assigned server-side to **control** (English-only tutor) or **treatment** (English–French support), chat with an LLM tutor for a fixed time, and then continue to the external final assessment. Researchers monitor and export everything from `/admin`.

Stack: Next.js (Vercel) · Turso / libSQL (SQLite) · Claude API (or any OpenAI-compatible provider, e.g. hosted Llama).

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

## 2. Configuration before launch (Admin → Study settings)

Replace the placeholders with the research team's approved text: task title and instructions, **common teaching prompt** (topic, objectives, examples, tone, length, off-topic handling), **control** and **treatment** language instructions, opening messages, duration (600 or 900 s), model ID, final assessment URL and the participant-ID parameter name agreed with the questionnaire teammate.

Each save creates a frozen version (`v1`, `v2`, …). A session copies its prompts, model, duration and final URL when it is created, so later edits never change sessions already allocated. **Freeze the configuration before collecting pilot data.**

Default treatment rule: complete English reply followed by a complete French translation (`FR:` line). The brief asks the team to confirm this vs. alternating sentences — edit the treatment instruction if needed.

## 3. Running a session (researchers)

1. `/admin` → log in with your name (recorded on every admin action) and the password.
2. **Generate invitations** — a number (IDs `P001…`), or paste the IDs agreed with the questionnaire team. Tick *Test sessions* for rehearsals (IDs `T001…`, separate allocation sequence, excluded from participant exports).
3. Download **Invitation list** (CSV with codes and personal links) and give each participant their own link or code.
4. After checking the external preliminary stage, select participants → **Mark selected ready** (or *Mark all pending in view ready*). Unapproved participants see a waiting screen that updates automatically; the timer does not start.
5. Monitor the table (refreshes every 5 s). Open a row for the full transcript, model/prompt version, event log, **Stop session** (with reason) and **deadline adjustment** (logged with old/new deadline, who and why).
6. Exports: session summary CSV, messages CSV/JSON, event log, per-session transcript, full backup JSON.

## 4. Participant journey

Link `/p/<code>` or the home page + code → (waiting for approval) → task instructions + **Start task** → chat with countdown, Send, Finish task → ended screen → **Continue to final assessment** (opens `FINAL_URL?pid=<participant_id>`).

## 5. How the brief's rules are enforced

- **Allocation:** permuted blocks of 4 (2 control, 2 treatment, shuffled) kept on the server; the next slot is consumed and the session created in one database transaction when an approved participant first opens the link. Refresh / second tab / repeat link → same session. No reassignment for dropouts; the dashboard reports assigned and ended counts per group separately.
- **Timer:** server stores `started_at` / `expires_at`; the browser only displays remaining time (monotonic clock, unaffected by changing the computer clock). After expiry chat requests are rejected; a reply that finishes after the deadline is saved as `discarded_after_expiry`, not shown, and logged.
- **Statuses:** `ready → active → ended` (+ `blocked`); end reasons `time_limit`, `participant_finished`, `researcher_stopped`, `technical_failure`, `withdrawn`. Final-assessment *link opened* is tracked; completion is always reported as `unknown`.
- **Reliability:** one outstanding LLM request per session; unique request IDs prevent duplicate turns on double-click or retry; the user message is saved before the provider call; failures are marked, flagged on the dashboard and offered a Retry; no automatic fallback model.
- **Privacy:** codes are random (10 characters) and stored as SHA-256 hashes for lookup; the plaintext code is kept only for the invitation list and never appears in data exports or backups. Participants never see their group, prompts or keys.

## 6. Backup

Download *Full database backup (JSON)* from the dashboard after each lab session. Turso also keeps point-in-time restore for the database.

## 7. Acceptance tests

`/tmp`-style script results (local run with mock tutor, 12 simultaneous participants): invalid code rejected; unapproved participant cannot start; 36 parallel entries → exactly 12 sessions, 6 control / 6 treatment; participant state never reveals group; parallel Start → one deadline; reconnect keeps deadline; duplicate request ID → no duplicate turn; concurrent sends → one accepted, one "busy"; independent histories; reply in progress at expiry → discarded, session ended `time_limit`; ended session cannot restart; final link carries `pid=P001`; early finish → `participant_finished` with link available; dashboard shows link opened and end reason. Re-run on the deployed site with test sessions before the pilot.
