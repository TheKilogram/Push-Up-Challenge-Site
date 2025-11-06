import http from 'http';
import Database from 'better-sqlite3';
import { promises as fsp } from 'fs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const LEGACY_JSON_PATH = path.join(DATA_DIR, 'db.json');
const SQLITE_PATH = path.join(DATA_DIR, 'pushups.db');
const DEFAULT_WEIGHT_LBS = 180;

let db;
let statements = {};

async function initDatabase() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  db = new Database(SQLITE_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      weight_lbs INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      count INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_entries_user_time ON entries (username, timestamp);
  `);
  prepareStatements();
  await migrateLegacyJson();
}

function prepareStatements() {
  statements = {
    insertUser: db.prepare('INSERT OR IGNORE INTO users (username, weight_lbs, created_at) VALUES (?, ?, ?)'),
    updateWeight: db.prepare('UPDATE users SET weight_lbs = ? WHERE username = ?'),
    touchCreatedAt: db.prepare('UPDATE users SET created_at = ? WHERE username = ? AND (created_at IS NULL OR created_at <= 0)'),
    selectUser: db.prepare('SELECT username, weight_lbs, created_at FROM users WHERE username = ?'),
    selectUserCount: db.prepare('SELECT COUNT(*) AS count FROM users'),
    selectEntryCount: db.prepare('SELECT COUNT(*) AS count FROM entries'),
    insertEntry: db.prepare('INSERT INTO entries (username, count, timestamp) VALUES (?, ?, ?)'),
    selectTotals: db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN timestamp BETWEEN ? AND ? THEN count ELSE 0 END), 0) AS today,
        COALESCE(SUM(count), 0) AS allTime
      FROM entries
      WHERE username = ?
    `),
    selectLastEntry: db.prepare('SELECT id, count, timestamp FROM entries WHERE username = ? ORDER BY timestamp DESC, id DESC LIMIT 1'),
    deleteEntryById: db.prepare('DELETE FROM entries WHERE id = ?'),
    selectLeaderboard: db.prepare(`
      SELECT
        u.username AS user,
        COALESCE(SUM(CASE WHEN e.timestamp BETWEEN ? AND ? THEN e.count ELSE 0 END), 0) AS today,
        COALESCE(SUM(e.count), 0) AS allTime,
        u.weight_lbs AS weight
      FROM users u
      LEFT JOIN entries e ON e.username = u.username
      GROUP BY u.username
      ORDER BY today DESC, u.username ASC
    `),
    selectEntriesFrom: db.prepare('SELECT timestamp, count FROM entries WHERE username = ? AND timestamp >= ? ORDER BY timestamp ASC')
  };
}

async function migrateLegacyJson() {
  if (!fs.existsSync(LEGACY_JSON_PATH)) return;
  const userCount = statements.selectUserCount.get().count;
  const entryCount = statements.selectEntryCount.get().count;
  if (userCount > 0 || entryCount > 0) return;
  let raw;
  try {
    raw = await fsp.readFile(LEGACY_JSON_PATH, 'utf8');
  } catch {
    return;
  }
  if (!raw.trim()) return;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn('Unable to parse legacy db.json:', err);
    return;
  }
  const users = parsed?.users ?? {};
  const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
  const insertUser = db.prepare('INSERT OR IGNORE INTO users (username, weight_lbs, created_at) VALUES (?, ?, ?)');
  const insertEntry = db.prepare('INSERT INTO entries (username, count, timestamp) VALUES (?, ?, ?)');
  const updateWeight = db.prepare('UPDATE users SET weight_lbs = ? WHERE username = ?');
  const tx = db.transaction(() => {
    for (const [key, value] of Object.entries(users)) {
      const username = String(key || '').trim().toLowerCase();
      if (!username) continue;
      const weight = value?.weightLbs != null ? Math.round(Number(value.weightLbs)) : null;
      const createdAt = Number(value?.createdAt || Date.now());
      insertUser.run(username, weight, createdAt);
      if (weight != null) updateWeight.run(weight, username);
    }
    for (const entry of entries) {
      if (!entry) continue;
      const username = String(entry.user || '').trim().toLowerCase();
      if (!username) continue;
      const count = Math.floor(Number(entry.count || 0));
      const timestamp = Number(entry.timestamp || Date.now());
      if (!Number.isFinite(count) || count <= 0) continue;
      insertUser.run(username, null, timestamp);
      insertEntry.run(username, count, timestamp);
    }
  });
  tx();
  console.log('Migrated legacy JSON data into SQLite.');
}

function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function hourKey(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  return { key: `${y}-${m}-${day} ${h}:00`, label: `${m}/${day} ${h}:00` };
}

function monthKey(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return { key: `${y}-${m}`, label: `${y}-${m}` };
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfHourRange(hours) {
  const end = new Date();
  end.setMinutes(0, 0, 0);
  return { start: end.getTime() - (hours - 1) * 60 * 60 * 1000, end: end.getTime() };
}

function startOfMonthRange(months) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  return start.getTime();
}

function ensureUserRecord(username) {
  const now = Date.now();
  statements.insertUser.run(username, null, now);
  statements.touchCreatedAt.run(now, username);
}

function updateWeightIfProvided(username, weightLbsVal) {
  if (weightLbsVal && Number.isFinite(weightLbsVal) && weightLbsVal > 0) {
    statements.updateWeight.run(Math.round(weightLbsVal), username);
  }
}

function getUser(username) {
  return statements.selectUser.get(username);
}

function getUserTotals(username) {
  const start = startOfToday();
  const end = start + 24 * 60 * 60 * 1000 - 1;
  const row = statements.selectTotals.get(start, end, username) || {};
  return {
    today: row.today ?? 0,
    allTime: row.allTime ?? 0,
  };
}

function calcCalories(pushups, weightLbs) {
  return Math.round(pushups * 0.0019 * weightLbs * 10) / 10;
}

function computeHistory(username, days = 7) {
  const map = new Map();
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  for (let i = 0; i < days; i++) {
    const d = new Date(end);
    d.setDate(end.getDate() - (days - 1 - i));
    const key = dayKey(d.getTime());
    map.set(key, 0);
  }
  const start = new Date(end);
  start.setDate(end.getDate() - (days - 1));
  const rows = statements.selectEntriesFrom.all(username, start.getTime());
  for (const row of rows) {
    const key = dayKey(row.timestamp);
    if (map.has(key)) {
      map.set(key, map.get(key) + row.count);
    }
  }
  return Array.from(map.entries()).map(([date, total]) => ({ date, label: date, total }));
}

function computeHistoryByHour(username, hours = 24) {
  const { start, end } = startOfHourRange(hours);
  const buckets = new Map();
  const endDate = new Date(end);
  for (let i = hours - 1; i >= 0; i--) {
    const d = new Date(endDate);
    d.setHours(endDate.getHours() - i);
    const { key, label } = hourKey(d.getTime());
    buckets.set(key, { label, total: 0 });
  }
  const rows = statements.selectEntriesFrom.all(username, start);
  for (const row of rows) {
    const { key } = hourKey(row.timestamp);
    if (buckets.has(key)) {
      buckets.get(key).total += row.count;
    }
  }
  return Array.from(buckets.entries()).map(([key, value]) => ({ date: key, label: value.label, total: value.total }));
}

function computeHistoryByMonth(username, months = 12) {
  const start = startOfMonthRange(months);
  const buckets = new Map();
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const { key, label } = monthKey(d.getTime());
    buckets.set(key, { label, total: 0 });
  }
  const rows = statements.selectEntriesFrom.all(username, start);
  for (const row of rows) {
    const { key } = monthKey(row.timestamp);
    if (buckets.has(key)) {
      buckets.get(key).total += row.count;
    }
  }
  return Array.from(buckets.entries()).map(([key, value]) => ({ date: key, label: value.label, total: value.total }));
}

function getLeaderboardRows() {
  const start = startOfToday();
  const end = start + 24 * 60 * 60 * 1000 - 1;
  const rows = statements.selectLeaderboard.all(start, end);
  return rows.map(row => {
    const today = row.today ?? 0;
    const allTime = row.allTime ?? 0;
    const weight = row.weight != null ? row.weight : DEFAULT_WEIGHT_LBS;
    return {
      user: row.user,
      today,
      allTime,
      todayCalories: calcCalories(today, weight),
      allTimeCalories: calcCalories(allTime, weight),
    };
  });
}

async function serveStatic(req, res) {
  let reqPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  if (reqPath === '/') reqPath = '/index.html';
  const safePath = path.normalize(reqPath).replace(/^([/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return true;
  }
  try {
    const data = await fsp.readFile(filePath);
    res.writeHead(200, { 'Content-Type': getContentType(filePath) });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=UTF-8';
    case '.js': return 'application/javascript; charset=UTF-8';
    case '.css': return 'text/css; charset=UTF-8';
    case '.json': return 'application/json; charset=UTF-8';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.svg': return 'image/svg+xml';
    default: return 'application/octet-stream';
  }
}

async function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1e6) {
        req.destroy();
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      try {
        const obj = data ? JSON.parse(data) : {};
        resolve(obj);
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  try {
    if (req.method === 'GET' && pathname === '/api/users') {
      const username = String(url.searchParams.get('username') || '').trim().toLowerCase();
      if (!username) { res.writeHead(400); res.end(JSON.stringify({ error: 'username required' })); return; }
      const user = getUser(username);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ exists: !!user, user: user ? { username, weightLbs: user.weight_lbs ?? null, createdAt: user.created_at ?? null } : null }));
      return;
    }

    if (req.method === 'POST' && pathname === '/api/users') {
      const body = await parseJsonBody(req);
      const username = String(body.username || '').trim().toLowerCase();
      const weightLbsRaw = body.weightLbs ?? body.weight ?? null;
      const weightLbsVal = weightLbsRaw !== null ? Number(weightLbsRaw) : null;
      const createOnly = Boolean(body.createOnly);
      if (!username) { res.writeHead(400); res.end(JSON.stringify({ error: 'username required' })); return; }
      const existing = getUser(username);
      if (existing && createOnly) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'username already exists' }));
        return;
      }
      const now = Date.now();
      statements.insertUser.run(username, weightLbsVal && Number.isFinite(weightLbsVal) && weightLbsVal > 0 ? Math.round(weightLbsVal) : null, now);
      statements.touchCreatedAt.run(now, username);
      updateWeightIfProvided(username, weightLbsVal);
      const user = getUser(username);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, user: username, weightLbs: user?.weight_lbs ?? null }));
      return;
    }

    if (req.method === 'POST' && pathname === '/api/log') {
      const body = await parseJsonBody(req);
      const username = String(body.username || '').trim().toLowerCase();
      const count = Number(body.count || 0);
      if (!username || !Number.isFinite(count) || count <= 0) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'username and positive count required' })); return;
      }
      ensureUserRecord(username);
      const now = Date.now();
      statements.insertEntry.run(username, Math.floor(count), now);
      const totals = getUserTotals(username);
      const user = getUser(username);
      const weight = user?.weight_lbs ?? DEFAULT_WEIGHT_LBS;
      const calsToday = calcCalories(totals.today, weight);
      const calsAll = calcCalories(totals.allTime, weight);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, today: totals.today, allTime: totals.allTime, todayCalories: calsToday, allTimeCalories: calsAll }));
      return;
    }

    if (req.method === 'POST' && pathname === '/api/undo') {
      const body = await parseJsonBody(req);
      const username = String(body.username || '').trim().toLowerCase();
      if (!username) { res.writeHead(400); res.end(JSON.stringify({ error: 'username required' })); return; }
      const last = statements.selectLastEntry.get(username);
      if (!last) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'nothing to undo' }));
        return;
      }
      statements.deleteEntryById.run(last.id);
      const totals = getUserTotals(username);
      const user = getUser(username);
      const weight = user?.weight_lbs ?? DEFAULT_WEIGHT_LBS;
      const calsToday = calcCalories(totals.today, weight);
      const calsAll = calcCalories(totals.allTime, weight);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, undone: last.count, today: totals.today, allTime: totals.allTime, todayCalories: calsToday, allTimeCalories: calsAll }));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/leaderboard') {
      const leaderboard = getLeaderboardRows();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ updatedAt: Date.now(), leaderboard }));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/history') {
      const username = String(url.searchParams.get('username') || '').trim().toLowerCase();
      const mode = String(url.searchParams.get('mode') || 'day');
      if (!username) { res.writeHead(400); res.end(JSON.stringify({ error: 'username required' })); return; }
      if (mode === 'hour') {
        const hours = Math.min(72, Math.max(1, Number(url.searchParams.get('hours') || 12)));
        const data = computeHistoryByHour(username, hours);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ user: username, mode, hours, data }));
        return;
      } else if (mode === 'month') {
        const months = Math.min(24, Math.max(1, Number(url.searchParams.get('months') || 12)));
        const data = computeHistoryByMonth(username, months);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ user: username, mode, months, data }));
        return;
      } else {
        const days = Math.min(30, Math.max(1, Number(url.searchParams.get('days') || 7)));
        const data = computeHistory(username, days);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ user: username, mode: 'day', days, data }));
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  } catch (e) {
    console.error('API error', e);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Server error', message: String(e.message || e) }));
  }
}

async function start() {
  await initDatabase();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      return handleApi(req, res);
    }
    const served = await serveStatic(req, res);
    if (!served) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
      res.end('Not Found');
    }
  });
  server.listen(PORT, () => {
    console.log(`Push-up challenge server running at http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start server', err);
  process.exit(1);
});
