import http from 'http';
import { promises as fsp } from 'fs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const DEFAULT_WEIGHT_LBS = 180;

// Ensure data folder and db file exist
async function ensureDb() {
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
  } catch {}
  try {
    await fsp.access(DB_PATH);
  } catch {
    const initial = { users: {}, entries: [] };
    await fsp.writeFile(DB_PATH, JSON.stringify(initial, null, 2), 'utf8');
  }
}

async function loadDb() {
  const raw = await fsp.readFile(DB_PATH, 'utf8');
  return JSON.parse(raw || '{"users":{},"entries":[]}');
}

async function saveDb(db) {
  await fsp.writeFile(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

async function serveStatic(req, res) {
  let reqPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  if (reqPath === '/') reqPath = '/index.html';
  const safePath = path.normalize(reqPath).replace(/^([/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return true;
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

function computeTotals(db) {
  const today = dayKey();
  const todayTotals = {};
  const allTotals = {};
  for (const e of db.entries) {
    const d = dayKey(e.timestamp);
    allTotals[e.user] = (allTotals[e.user] || 0) + e.count;
    if (d === today) {
      todayTotals[e.user] = (todayTotals[e.user] || 0) + e.count;
    }
  }
  return { todayTotals, allTotals };
}

function computeHistory(db, username, days = 7) {
  const map = new Map();
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - (days - 1 - i));
    const key = dayKey(d.getTime());
    map.set(key, 0);
  }
  for (const e of db.entries) {
    if (e.user !== username) continue;
    const key = dayKey(e.timestamp);
    if (map.has(key)) map.set(key, map.get(key) + e.count);
  }
  return Array.from(map.entries()).map(([date, total]) => ({ date, label: date, total }));
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

function computeHistoryByHour(db, username, hours = 24) {
  const buckets = new Map();
  const now = new Date();
  const end = new Date(now);
  end.setMinutes(0, 0, 0); // floor to hour
  for (let i = hours - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setHours(end.getHours() - i);
    const { key, label } = hourKey(d.getTime());
    buckets.set(key, { label, total: 0 });
  }
  for (const e of db.entries) {
    if (e.user !== username) continue;
    const { key } = hourKey(e.timestamp);
    if (buckets.has(key)) {
      const obj = buckets.get(key);
      obj.total += e.count;
    }
  }
  return Array.from(buckets.entries()).map(([key, v]) => ({ date: key, label: v.label, total: v.total }));
}

function computeHistoryByMonth(db, username, months = 12) {
  const buckets = new Map();
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(start);
    d.setMonth(start.getMonth() - i);
    const { key, label } = monthKey(d.getTime());
    buckets.set(key, { label, total: 0 });
  }
  for (const e of db.entries) {
    if (e.user !== username) continue;
    const { key } = monthKey(e.timestamp);
    if (buckets.has(key)) {
      const obj = buckets.get(key);
      obj.total += e.count;
    }
  }
  return Array.from(buckets.entries()).map(([key, v]) => ({ date: key, label: v.label, total: v.total }));
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  try {
    if (req.method === 'POST' && pathname === '/api/users') {
      const body = await parseJsonBody(req);
      const username = String(body.username || '').trim().toLowerCase();
      const weightLbsRaw = body.weightLbs ?? body.weight ?? null;
      const weightLbsVal = weightLbsRaw !== null ? Number(weightLbsRaw) : null;
      if (!username) { res.writeHead(400); res.end(JSON.stringify({ error: 'username required' })); return; }
      const db = await loadDb();
      if (!db.users[username]) {
        db.users[username] = { createdAt: Date.now() };
      }
      if (weightLbsVal && Number.isFinite(weightLbsVal) && weightLbsVal > 0) {
        db.users[username].weightLbs = Math.round(weightLbsVal);
      }
      await saveDb(db);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, user: username, weightLbs: db.users[username].weightLbs || null }));
      return;
    }

    if (req.method === 'POST' && pathname === '/api/log') {
      const body = await parseJsonBody(req);
      const username = String(body.username || '').trim().toLowerCase();
      const count = Number(body.count || 0);
      if (!username || !Number.isFinite(count) || count <= 0) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'username and positive count required' })); return;
      }
      const db = await loadDb();
      if (!db.users[username]) {
        db.users[username] = { createdAt: Date.now() };
      }
      db.entries.push({ user: username, count: Math.floor(count), timestamp: Date.now() });
      await saveDb(db);
      const { todayTotals, allTotals } = computeTotals(db);
      const weight = (db.users[username] && db.users[username].weightLbs) || DEFAULT_WEIGHT_LBS;
      const calsToday = Math.round((todayTotals[username] || 0) * 0.0019 * weight * 10) / 10;
      const calsAll = Math.round((allTotals[username] || 0) * 0.0019 * weight * 10) / 10;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, today: todayTotals[username] || 0, allTime: allTotals[username] || 0, todayCalories: calsToday, allTimeCalories: calsAll }));
      return;
    }

    if (req.method === 'POST' && pathname === '/api/undo') {
      const body = await parseJsonBody(req);
      const username = String(body.username || '').trim().toLowerCase();
      if (!username) { res.writeHead(400); res.end(JSON.stringify({ error: 'username required' })); return; }
      const db = await loadDb();
      // Find last entry for this user
      let idx = -1;
      for (let i = db.entries.length - 1; i >= 0; i--) {
        if (db.entries[i].user === username) { idx = i; break; }
      }
      if (idx === -1) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'nothing to undo' }));
        return;
      }
      const removed = db.entries.splice(idx, 1)[0];
      await saveDb(db);
      const { todayTotals, allTotals } = computeTotals(db);
      const weight = (db.users[username] && db.users[username].weightLbs) || DEFAULT_WEIGHT_LBS;
      const calsToday = Math.round((todayTotals[username] || 0) * 0.0019 * weight * 10) / 10;
      const calsAll = Math.round((allTotals[username] || 0) * 0.0019 * weight * 10) / 10;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, undone: removed.count, today: todayTotals[username] || 0, allTime: allTotals[username] || 0, todayCalories: calsToday, allTimeCalories: calsAll }));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/leaderboard') {
      const db = await loadDb();
      const { todayTotals, allTotals } = computeTotals(db);
      const users = Object.keys(db.users).sort();
      const rows = users.map(u => {
        const today = todayTotals[u] || 0;
        const allTime = allTotals[u] || 0;
        const weight = (db.users[u] && db.users[u].weightLbs) || DEFAULT_WEIGHT_LBS;
        const todayCalories = Math.round(today * 0.0019 * weight * 10) / 10;
        const allTimeCalories = Math.round(allTime * 0.0019 * weight * 10) / 10;
        return { user: u, today, allTime, todayCalories, allTimeCalories };
      })
        .sort((a, b) => b.today - a.today || a.user.localeCompare(b.user));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ updatedAt: Date.now(), leaderboard: rows }));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/history') {
      const username = String(url.searchParams.get('username') || '').trim().toLowerCase();
      const mode = String(url.searchParams.get('mode') || 'day');
      if (!username) { res.writeHead(400); res.end(JSON.stringify({ error: 'username required' })); return; }
      const db = await loadDb();
      if (mode === 'hour') {
        const hours = Math.min(72, Math.max(1, Number(url.searchParams.get('hours') || 12)));
        const data = computeHistoryByHour(db, username, hours);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ user: username, mode, hours, data }));
        return;
      } else if (mode === 'month') {
        const months = Math.min(24, Math.max(1, Number(url.searchParams.get('months') || 12)));
        const data = computeHistoryByMonth(db, username, months);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ user: username, mode, months, data }));
        return;
      } else {
        const days = Math.min(30, Math.max(1, Number(url.searchParams.get('days') || 7)));
        const data = computeHistory(db, username, days);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ user: username, mode: 'day', days, data }));
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Server error', message: String(e.message || e) }));
  }
}

async function start() {
  await ensureDb();
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
