/**
 * Setu — SIH 2026 (PS SIH26136, Team Skill_Forge!, T041)
 * Express REST API backend.
 *
 * Storage: in-memory (challenges[], applications[], sessions Map).
 * This is a hackathon-grade backend — good enough to demonstrate real
 * server-side auth, role enforcement, and eligibility logic. For a
 * production deployment you would swap the in-memory store for a real
 * database and hash/verify real passwords against stored user records.
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------
// In-memory "database"
// ---------------------------------------------------------------------
let challenges = [];
let applications = [];
const sessions = new Map(); // token -> { email, role, createdAt }

const SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

function uid() {
  return crypto.randomBytes(4).toString('hex');
}

function cleanExpiredSessions() {
  const now = Date.now();
  for (const [token, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) sessions.delete(token);
  }
}

// ---------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------
function getSessionFromHeader(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (!token) return null;
  cleanExpiredSessions();
  const session = sessions.get(token);
  return session ? { ...session, token } : null;
}

function requireAuth(req, res, next) {
  const session = getSessionFromHeader(req);
  if (!session) {
    return res.status(401).json({ error: 'Not authenticated. Please log in.' });
  }
  req.session = session;
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    const session = getSessionFromHeader(req);
    if (!session) {
      return res.status(401).json({ error: 'Not authenticated. Please log in.' });
    }
    if (session.role !== role) {
      return res.status(403).json({ error: `This action requires a "${role}" session.` });
    }
    req.session = session;
    next();
  };
}

// ---------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------
app.post('/api/auth/login', (req, res) => {
  const { email, password, role } = req.body || {};

  if (typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'A valid email is required.' });
  }
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  if (role !== 'gov' && role !== 'startup') {
    return res.status(400).json({ error: 'Role must be "gov" or "startup".' });
  }

  // Hackathon-grade auth: any well-formed credential pair is accepted and
  // bound to the chosen role for this session. Swap in a real user store
  // + password hash comparison (e.g. bcrypt) before any real deployment.
  const token = crypto.randomUUID();
  sessions.set(token, { email, role, createdAt: Date.now() });

  res.json({ token, role, email });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  sessions.delete(req.session.token);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------
// Data read (any authenticated user, either role)
// ---------------------------------------------------------------------
app.get('/api/data', requireAuth, (req, res) => {
  res.json({
    challenges,
    applications,
    you: { email: req.session.email, role: req.session.role }
  });
});

// ---------------------------------------------------------------------
// Government: post a challenge
// ---------------------------------------------------------------------
app.post('/api/challenges', requireRole('gov'), (req, res) => {
  const b = req.body || {};
  const required = ['title', 'dept', 'sector', 'desc', 'budget', 'timeline', 'maxYears', 'minTurnover'];
  for (const k of required) {
    if (b[k] === undefined || b[k] === '') {
      return res.status(400).json({ error: `Missing field: ${k}` });
    }
  }
  const maxYears = Number(b.maxYears);
  const minTurnover = Number(b.minTurnover);
  if (!Number.isFinite(maxYears) || maxYears < 0) {
    return res.status(400).json({ error: 'maxYears must be a non-negative number.' });
  }
  if (!Number.isFinite(minTurnover) || minTurnover < 0) {
    return res.status(400).json({ error: 'minTurnover must be a non-negative number.' });
  }

  const challenge = {
    id: uid(),
    title: String(b.title),
    dept: String(b.dept),
    sector: String(b.sector),
    desc: String(b.desc),
    budget: String(b.budget),
    timeline: String(b.timeline),
    maxYears,
    minTurnover,
    status: 'open',
    postedBy: req.session.email
  };
  challenges.push(challenge);
  res.status(201).json(challenge);
});

// ---------------------------------------------------------------------
// Startup: submit an application (server-side eligibility check)
// ---------------------------------------------------------------------
app.post('/api/applications', requireRole('startup'), (req, res) => {
  const b = req.body || {};
  const required = ['challengeId', 'startup', 'dpiit', 'years', 'turnover', 'proposal', 'target'];
  for (const k of required) {
    if (b[k] === undefined || b[k] === '') {
      return res.status(400).json({ error: `Missing field: ${k}` });
    }
  }
  const challenge = challenges.find(c => c.id === b.challengeId);
  if (!challenge) {
    return res.status(404).json({ error: 'Challenge not found.' });
  }

  const years = Number(b.years);
  const turnover = Number(b.turnover);
  const target = Number(b.target);
  if (!Number.isFinite(years) || !Number.isFinite(turnover) || !Number.isFinite(target)) {
    return res.status(400).json({ error: 'years, turnover and target must be numbers.' });
  }

  // Server-side eligibility check — never trust a client-computed flag.
  const eligible = years <= challenge.maxYears && turnover >= challenge.minTurnover;

  const application = {
    id: uid(),
    challengeId: challenge.id,
    startup: String(b.startup),
    dpiit: String(b.dpiit),
    years,
    turnover,
    proposal: String(b.proposal),
    target,
    eligible,
    status: 'applied',
    kpi: 0,
    paid: [false, false, false],
    audit: 'pending',
    ownerEmail: req.session.email
  };
  applications.push(application);
  res.status(201).json(application);
});

// ---------------------------------------------------------------------
// Government: update application status (shortlist / reject / scale / close)
// ---------------------------------------------------------------------
app.post('/api/applications/status', requireRole('gov'), (req, res) => {
  const { id, status } = req.body || {};
  const allowed = ['shortlisted', 'rejected', 'scaled', 'closed'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
  }
  const application = applications.find(a => a.id === id);
  if (!application) {
    return res.status(404).json({ error: 'Application not found.' });
  }
  application.status = status;
  if (status === 'shortlisted' && !application.kpi) {
    application.kpi = 10;
    application.audit = 'pending';
  }
  res.json(application);
});

// ---------------------------------------------------------------------
// Government: toggle a milestone payment (Kickoff 30% / Mid-Pilot 40% / Completion 30%)
// ---------------------------------------------------------------------
app.post('/api/applications/payment', requireRole('gov'), (req, res) => {
  const { id, index } = req.body || {};
  const application = applications.find(a => a.id === id);
  if (!application) {
    return res.status(404).json({ error: 'Application not found.' });
  }
  if (![0, 1, 2].includes(index)) {
    return res.status(400).json({ error: 'Milestone index must be 0 (Kickoff), 1 (Mid-Pilot) or 2 (Completion).' });
  }
  application.paid[index] = !application.paid[index];
  if (application.paid[1]) application.audit = 'pass'; // mid-pilot release implies audit clearance in this demo
  res.json(application);
});

// ---------------------------------------------------------------------
// Startup: update live KPI progress (only the owning startup may update it)
// ---------------------------------------------------------------------
app.post('/api/applications/kpi', requireRole('startup'), (req, res) => {
  const { id, kpi } = req.body || {};
  const application = applications.find(a => a.id === id);
  if (!application) {
    return res.status(404).json({ error: 'Application not found.' });
  }
  if (application.ownerEmail !== req.session.email) {
    return res.status(403).json({ error: 'You can only update KPI progress on your own application.' });
  }
  const value = Number(kpi);
  if (!Number.isFinite(value)) {
    return res.status(400).json({ error: 'kpi must be a number.' });
  }
  application.kpi = Math.max(0, Math.min(100, value));
  res.json(application);
});

// ---------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Setu server running at http://localhost:${PORT}`);
});
