# samimi-taskboard

Personal task manager: static site + Cloudflare Worker API + Telegram bot with reminders.

- Site: https://mar-mir.github.io/samimi-taskboard/
- Bot: https://t.me/samimitodobot

## Layout

- `public/index.html` — source of the single-page UI (dark theme, RTL). `API_BASE` is empty here.
- `docs/index.html` — built copy served by GitHub Pages, with `API_BASE` pointing at the Worker.
- `src/worker.js` — Worker: auth (password + sessions), tasks REST API, Telegram webhook, cron reminders, backup export.
- `src/_site.js` — generated embed of the UI into the Worker bundle (do not edit, built by `build.mjs`).
- `build.mjs` — builds `src/_site.js` and the Pages copy under `docs/`.
- `wrangler.toml` — Worker config: TASK_KV (sessions, auth, link codes), TASK_DB (D1, tasks table), cron `* * * * *`.
- `.github/workflows/nightly-backup.yml` — nightly export of tasks to `tasks-backup.json`.

## Backend

Worker URL: `https://samimi-taskboard.samimirn20.workers.dev`

Storage:

- D1 `taskboard-db`, table `tasks (id, title, descr, due, priority, done, r10, rdue, created_at, updated_at)`.
- KV `taskboard-kv`: `cfg:auth` (salt + sha256), `sess:<token>`, `cfg:tg_chat`, `link:<code>`.

Secrets (set via `wrangler secret put`): `BOT_TOKEN`, `INIT_PASSWORD`, `BACKUP_TOKEN`.
Repo secrets for the backup workflow: `BACKUP_TOKEN`, `WORKER_URL`.

## Build and deploy

```bash
node build.mjs --pages "https://samimi-taskboard.samimirn20.workers.dev"
wrangler deploy
```

Flow: edit `public/index.html`, run `build.mjs` (regenerates `src/_site.js` and `docs/index.html`), deploy the Worker, commit and push (Pages serves `docs/`).

## Backup

GitHub Action runs nightly at 23:00 UTC and on manual dispatch. It calls `GET /api/export` with the backup token and commits `tasks-backup.json` when changed.
