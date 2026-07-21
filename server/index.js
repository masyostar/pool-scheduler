// Springhaven Pool Scheduler — backend
// Simple Express API backed by a JSON file on disk. Good fit for a small
// single-pool deployment; if this ever needs to run more than one club
// or survive frequent redeploys on an ephemeral filesystem, swap
// readData/writeData for a real database (see README).

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;
// DATA_FILE can be pointed at a mounted persistent disk in production
// (see render.yaml) so data survives redeploys; defaults to a local file
// for development, where nothing is mounted.
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const ROLES = ['operator', 'manager', 'lifeguard', 'gateperson'];

const EMPTY_STORE = () => ({
  users: [],
  workers: [],
  shifts: [],
  availability_requests: [],
  availability: [],
  shift_requests: []
});

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ---------- data access ----------

function readData() {
  if (!fs.existsSync(DATA_FILE)) return EMPTY_STORE();
  let data;
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    console.error('Failed to read/parse data.json — starting from an empty store.', err);
    return EMPTY_STORE();
  }
  // Backfill fields that may be missing from an older data.json.
  const empty = EMPTY_STORE();
  for (const key of Object.keys(empty)) {
    if (!Array.isArray(data[key])) data[key] = empty[key];
  }
  data.users.forEach(u => { if (typeof u.confirmed === 'undefined') u.confirmed = true; });
  return data;
}

function writeData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Failed to write data.json', err);
    throw err;
  }
}

function uid() {
  return crypto.randomBytes(6).toString('hex');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  return hash === test;
}

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function asyncRoute(fn) {
  return (req, res) => {
    try {
      fn(req, res);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

// ---------- health ----------

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---------- auth ----------

app.post('/api/register', asyncRoute((req, res) => {
  const data = readData();
  const { username, password, name, role } = req.body || {};
  if (!username || !password || !name) {
    return res.status(400).json({ error: 'All fields required' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }
  if (data.users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: 'Username already taken' });
  }
  const isFirst = data.users.length === 0;
  const finalRole = isFirst ? 'operator' : role;
  const user = {
    id: uid(),
    username,
    password: hashPassword(password),
    name,
    role: finalRole,
    confirmed: isFirst
  };
  data.users.push(user);
  data.workers.push({ id: user.id, name, role: finalRole });
  writeData(data);
  res.json({ id: user.id, username: user.username, name: user.name, role: finalRole, confirmed: user.confirmed });
}));

app.post('/api/login', asyncRoute((req, res) => {
  const data = readData();
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  const user = data.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user || !verifyPassword(password, user.password)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  if (!user.confirmed) {
    return res.status(403).json({ error: 'Account pending operator approval. Please wait to be confirmed.' });
  }
  res.json({ id: user.id, username: user.username, name: user.name, role: user.role });
}));

// ---------- user management ----------

app.get('/api/users', asyncRoute((req, res) => {
  const data = readData();
  res.json(data.users.map(u => ({ id: u.id, username: u.username, name: u.name, role: u.role, confirmed: u.confirmed })));
}));

app.put('/api/users/:id/confirm', asyncRoute((req, res) => {
  const data = readData();
  const user = data.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  user.confirmed = true;
  writeData(data);
  res.json({ id: user.id, username: user.username, name: user.name, role: user.role, confirmed: true });
}));

app.put('/api/users/:id/role', asyncRoute((req, res) => {
  const data = readData();
  const user = data.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const { role } = req.body || {};
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  user.role = role;
  const worker = data.workers.find(w => w.id === req.params.id);
  if (worker) worker.role = role;
  writeData(data);
  res.json({ id: user.id, username: user.username, name: user.name, role: user.role, confirmed: user.confirmed });
}));

app.put('/api/users/:id/password', asyncRoute((req, res) => {
  const data = readData();
  const user = data.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  if (!verifyPassword(currentPassword, user.password)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  if (newPassword.length < 4) {
    return res.status(400).json({ error: 'New password must be at least 4 characters' });
  }
  user.password = hashPassword(newPassword);
  writeData(data);
  res.json({ ok: true });
}));

app.delete('/api/users/:id', asyncRoute((req, res) => {
  const data = readData();
  data.users = data.users.filter(u => u.id !== req.params.id);
  data.workers = data.workers.filter(w => w.id !== req.params.id);
  writeData(data);
  res.json({ ok: true });
}));

// ---------- workers ----------

app.get('/api/workers', asyncRoute((req, res) => {
  res.json(readData().workers);
}));

app.post('/api/workers', asyncRoute((req, res) => {
  const data = readData();
  const worker = { id: uid(), ...req.body };
  data.workers.push(worker);
  writeData(data);
  res.json(worker);
}));

app.put('/api/workers/:id', asyncRoute((req, res) => {
  const data = readData();
  const idx = data.workers.findIndex(w => w.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  data.workers[idx] = { ...data.workers[idx], ...req.body };
  writeData(data);
  res.json(data.workers[idx]);
}));

app.delete('/api/workers/:id', asyncRoute((req, res) => {
  const data = readData();
  data.shifts.forEach(s => {
    if (s.workerId === req.params.id) {
      s.workerId = null;
      s.status = 'open';
    }
  });
  data.workers = data.workers.filter(w => w.id !== req.params.id);
  writeData(data);
  res.json({ ok: true });
}));

app.post('/api/workers/bulk', asyncRoute((req, res) => {
  const data = readData();
  const newWorkers = (req.body || []).map(w => ({ id: uid(), ...w }));
  data.workers.push(...newWorkers);
  writeData(data);
  res.json(newWorkers);
}));

// ---------- shifts ----------

app.get('/api/shifts', asyncRoute((req, res) => {
  const data = readData();
  let shifts = data.shifts;
  if (req.query.date) {
    shifts = shifts.filter(s => s.date === req.query.date);
  } else if (req.query.from && req.query.to) {
    shifts = shifts.filter(s => s.date >= req.query.from && s.date <= req.query.to);
  }
  res.json(shifts);
}));

app.post('/api/shifts', asyncRoute((req, res) => {
  const data = readData();
  const shift = { id: uid(), ...req.body };
  if (!shift.status) shift.status = shift.workerId ? 'assigned' : 'open';
  data.shifts.push(shift);
  writeData(data);
  res.json(shift);
}));

app.put('/api/shifts/:id', asyncRoute((req, res) => {
  const data = readData();
  const idx = data.shifts.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  data.shifts[idx] = { ...data.shifts[idx], ...req.body };
  writeData(data);
  res.json(data.shifts[idx]);
}));

app.delete('/api/shifts/:id', asyncRoute((req, res) => {
  const data = readData();
  data.shifts = data.shifts.filter(s => s.id !== req.params.id);
  writeData(data);
  res.json({ ok: true });
}));

// ---------- availability requests ----------

app.get('/api/availability-requests', asyncRoute((req, res) => {
  res.json(readData().availability_requests);
}));

app.post('/api/availability-requests', asyncRoute((req, res) => {
  const data = readData();
  const request = { id: uid(), ...req.body, createdAt: new Date().toISOString() };
  data.availability_requests.push(request);
  writeData(data);
  res.json(request);
}));

app.delete('/api/availability-requests/:id', asyncRoute((req, res) => {
  const data = readData();
  data.availability_requests = data.availability_requests.filter(r => r.id !== req.params.id);
  writeData(data);
  res.json({ ok: true });
}));

// ---------- availability responses ----------

app.get('/api/availability', asyncRoute((req, res) => {
  const data = readData();
  let avail = data.availability;
  if (req.query.workerId) avail = avail.filter(a => a.workerId === req.query.workerId);
  if (req.query.from && req.query.to) avail = avail.filter(a => a.date >= req.query.from && a.date <= req.query.to);
  res.json(avail);
}));

app.post('/api/availability', asyncRoute((req, res) => {
  const data = readData();
  const avail = { id: uid(), ...req.body };
  data.availability.push(avail);
  writeData(data);
  res.json(avail);
}));

app.put('/api/availability/:id', asyncRoute((req, res) => {
  const data = readData();
  const idx = data.availability.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  data.availability[idx] = { ...data.availability[idx], ...req.body };
  writeData(data);
  res.json(data.availability[idx]);
}));

app.delete('/api/availability/:id', asyncRoute((req, res) => {
  const data = readData();
  data.availability = data.availability.filter(a => a.id !== req.params.id);
  writeData(data);
  res.json({ ok: true });
}));

// ---------- conflicts ----------

app.get('/api/conflicts', asyncRoute((req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.json([]);
  const data = readData();
  const rangeShifts = data.shifts.filter(s => s.date >= from && s.date <= to && s.workerId);
  const conflicts = [];

  for (let i = 0; i < rangeShifts.length; i++) {
    for (let j = i + 1; j < rangeShifts.length; j++) {
      const a = rangeShifts[i];
      const b = rangeShifts[j];
      if (a.workerId !== b.workerId || a.date !== b.date) continue;
      const overlaps = timeToMinutes(a.start) < timeToMinutes(b.end) && timeToMinutes(b.start) < timeToMinutes(a.end);
      if (!overlaps) continue;
      const worker = data.workers.find(w => w.id === a.workerId);
      const workerName = worker ? worker.name : 'Unknown';
      conflicts.push({
        shiftA: a,
        shiftB: b,
        workerName,
        message: `${workerName} has overlapping shifts on ${a.date} (${a.start}-${a.end} vs ${b.start}-${b.end})`
      });
    }
  }
  res.json(conflicts);
}));

// ---------- shift requests (trade/drop claims) ----------

app.get('/api/shift-requests', asyncRoute((req, res) => {
  res.json(readData().shift_requests);
}));

app.post('/api/shift-requests', asyncRoute((req, res) => {
  const data = readData();
  const request = { id: uid(), ...req.body, status: 'pending', createdAt: new Date().toISOString() };
  data.shift_requests.push(request);
  writeData(data);
  res.json(request);
}));

app.put('/api/shift-requests/:id', asyncRoute((req, res) => {
  const data = readData();
  const idx = data.shift_requests.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  data.shift_requests[idx] = { ...data.shift_requests[idx], ...req.body };
  writeData(data);
  res.json(data.shift_requests[idx]);
}));

app.delete('/api/shift-requests/:id', asyncRoute((req, res) => {
  const data = readData();
  data.shift_requests = data.shift_requests.filter(r => r.id !== req.params.id);
  writeData(data);
  res.json({ ok: true });
}));

// ---------- reset (operator "wipe everything" escape hatch) ----------

app.post('/api/reset', asyncRoute((req, res) => {
  writeData(EMPTY_STORE());
  res.json({ ok: true });
}));

// ---------- static client ----------

app.use(express.static(PUBLIC_DIR));
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Springhaven Pool Scheduler running on http://0.0.0.0:${PORT}`);
});
