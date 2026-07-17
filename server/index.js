const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

app.use(cors());
app.use(express.json());

function readData() {
  if (!fs.existsSync(DATA_FILE)) {
    return { users: [], workers: [], shifts: [] };
  }
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!data.users) data.users = [];
  if (data.users.length === 0) {
    return { users: [], workers: [], shifts: [] };
  }
  return data;
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
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

// ============ USERS (Auth) ============

app.post('/api/register', (req, res) => {
  const data = readData();
  const { username, password, name, role } = req.body;
  if (!username || !password || !name || !role) {
    return res.status(400).json({ error: 'All fields required' });
  }
  if (data.users.find(u => u.username === username)) {
    return res.status(400).json({ error: 'Username already taken' });
  }
  const user = {
    id: uid(),
    username,
    password: hashPassword(password),
    name,
    role
  };
  data.users.push(user);
  // Also create a worker entry
  if (!data.workers) data.workers = [];
  data.workers.push({ id: user.id, name, role });
  writeData(data);
  res.json({ id: user.id, username: user.username, name: user.name, role: user.role });
});

app.post('/api/login', (req, res) => {
  const data = readData();
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  const user = data.users.find(u => u.username === username);
  if (!user || !verifyPassword(password, user.password)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  res.json({ id: user.id, username: user.username, name: user.name, role: user.role });
});

// ============ WORKERS ============

app.get('/api/workers', (req, res) => {
  res.json(readData().workers);
});

app.post('/api/workers', (req, res) => {
  const data = readData();
  const worker = { id: uid(), ...req.body };
  data.workers.push(worker);
  writeData(data);
  res.json(worker);
});

app.put('/api/workers/:id', (req, res) => {
  const data = readData();
  const idx = data.workers.findIndex(w => w.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  data.workers[idx] = { ...data.workers[idx], ...req.body };
  writeData(data);
  res.json(data.workers[idx]);
});

app.delete('/api/workers/:id', (req, res) => {
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
});

app.post('/api/workers/bulk', (req, res) => {
  const data = readData();
  const newWorkers = req.body.map(w => ({ id: uid(), ...w }));
  data.workers.push(...newWorkers);
  writeData(data);
  res.json(newWorkers);
});

// ============ SHIFTS ============

app.get('/api/shifts', (req, res) => {
  const data = readData();
  let shifts = data.shifts;
  if (req.query.date) {
    shifts = shifts.filter(s => s.date === req.query.date);
  }
  if (req.query.from && req.query.to) {
    shifts = shifts.filter(s => s.date >= req.query.from && s.date <= req.query.to);
  }
  res.json(shifts);
});

app.post('/api/shifts', (req, res) => {
  const data = readData();
  const shift = { id: uid(), ...req.body };
  if (!shift.status) {
    shift.status = shift.workerId ? 'assigned' : 'open';
  }
  data.shifts.push(shift);
  writeData(data);
  res.json(shift);
});

app.put('/api/shifts/:id', (req, res) => {
  const data = readData();
  const idx = data.shifts.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  data.shifts[idx] = { ...data.shifts[idx], ...req.body };
  writeData(data);
  res.json(data.shifts[idx]);
});

app.delete('/api/shifts/:id', (req, res) => {
  const data = readData();
  data.shifts = data.shifts.filter(s => s.id !== req.params.id);
  writeData(data);
  res.json({ ok: true });
});

// ============ AVAILABILITY REQUESTS ============

app.get('/api/availability-requests', (req, res) => {
  const data = readData();
  res.json(data.availability_requests || []);
});

app.post('/api/availability-requests', (req, res) => {
  const data = readData();
  if (!data.availability_requests) data.availability_requests = [];
  const request = { id: uid(), ...req.body, createdAt: new Date().toISOString() };
  data.availability_requests.push(request);
  writeData(data);
  res.json(request);
});

app.delete('/api/availability-requests/:id', (req, res) => {
  const data = readData();
  data.availability_requests = (data.availability_requests || []).filter(r => r.id !== req.params.id);
  writeData(data);
  res.json({ ok: true });
});

// ============ AVAILABILITY RESPONSES ============

app.get('/api/availability', (req, res) => {
  const data = readData();
  let avail = data.availability || [];
  if (req.query.workerId) {
    avail = avail.filter(a => a.workerId === req.query.workerId);
  }
  if (req.query.from && req.query.to) {
    avail = avail.filter(a => a.date >= req.query.from && a.date <= req.query.to);
  }
  res.json(avail);
});

app.post('/api/availability', (req, res) => {
  const data = readData();
  if (!data.availability) data.availability = [];
  const avail = { id: uid(), ...req.body };
  data.availability.push(avail);
  writeData(data);
  res.json(avail);
});

app.put('/api/availability/:id', (req, res) => {
  const data = readData();
  if (!data.availability) data.availability = [];
  const idx = data.availability.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  data.availability[idx] = { ...data.availability[idx], ...req.body };
  writeData(data);
  res.json(data.availability[idx]);
});

app.delete('/api/availability/:id', (req, res) => {
  const data = readData();
  data.availability = (data.availability || []).filter(a => a.id !== req.params.id);
  writeData(data);
  res.json({ ok: true });
});

// ============ CONFLICTS ============

app.get('/api/conflicts', (req, res) => {
  const data = readData();
  const { from, to } = req.query;
  if (!from || !to) return res.json([]);

  const rangeShifts = data.shifts.filter(s => s.date >= from && s.date <= to && s.workerId);
  const conflicts = [];

  for (let i = 0; i < rangeShifts.length; i++) {
    for (let j = i + 1; j < rangeShifts.length; j++) {
      const a = rangeShifts[i];
      const b = rangeShifts[j];
      if (a.workerId === b.workerId && a.date === b.date) {
        const aStart = timeToMin(a.start);
        const aEnd = timeToMin(a.end);
        const bStart = timeToMin(b.start);
        const bEnd = timeToMin(b.end);
        if (aStart < bEnd && bStart < aEnd) {
          const worker = data.workers.find(w => w.id === a.workerId);
          conflicts.push({
            shiftA: a,
            shiftB: b,
            workerName: worker ? worker.name : 'Unknown',
            message: `${worker?.name || 'Unknown'} has overlapping shifts on ${a.date} (${a.start}-${a.end} vs ${b.start}-${b.end})`
          });
        }
      }
    }
  }

  res.json(conflicts);
});

function timeToMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// ============ RESET ============

app.post('/api/reset', (req, res) => {
  writeData({ users: [], workers: [], shifts: [], availability_requests: [], availability: [] });
  res.json({ ok: true });
});

// ============ SERVE STATIC HTML ============

app.use(express.static(PUBLIC_DIR));
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Pool Scheduler running on http://0.0.0.0:${PORT}`);
});
