Push-up Challenge Site
======================

A tiny, no-auth website to track daily push-ups for a group of friends. Users pick a username, add push-ups in small increments, and everyone can see a shared leaderboard and a simple 7-day history chart.

How it works
------------
- Backend: small Node.js HTTP server (no dependencies) serving static files and a JSON API.
- Storage: a local JSON file at `data/db.json` (created automatically on first run).
- Frontend: a static single page app in `public/` using Chart.js from a CDN.

Run locally
-----------
1. Ensure Node.js 18+ is installed and available on PATH.
2. From the project folder, run: `node server.js`
3. Open: `http://localhost:3000`

Deploy options
--------------
- Home server: run `node server.js` as a service (e.g., with NSSM on Windows or systemd on Linux). Reverse-proxy via your router if needed.
- GitHub Pages: static hosting only; you’ll need a backend for shared data. You can deploy this whole repo to a small VPS or a free-tier service that allows a Node server. For pure GitHub Pages, consider wiring the frontend to a third-party backend (e.g., Firebase, Supabase) instead of `server.js`.

API overview
------------
- `POST /api/users` body `{ username }` → creates the user if it doesn’t exist.
- `POST /api/log` body `{ username, count }` → logs a push-up entry for that user.
- `POST /api/undo` body `{ username }` → removes that user’s most recent log entry.
- `GET /api/leaderboard` → `[{ user, today, allTime }]` sorted by today’s total.
- `GET /api/history?username=<u>&days=7` → last N days totals for a user.
  - Optional: `mode=hour&hours=12` for last N hours, `mode=month&months=12` for last N months.

Notes
-----
- No accounts or passwords. The first person to use a name “claims” it informally.
- Data is stored locally; back it up by copying `data/db.json`.
- If you restart the server, the data persists.
