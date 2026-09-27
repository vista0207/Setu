/* ---------------------------------------------------------------------
 * Setu frontend — talks to the Express API instead of localStorage.
 * Every write is also re-checked server-side (see server.js); this file
 * just shapes requests/responses and renders the UI.
 * ------------------------------------------------------------------- */

async function apiFetch(path, opts = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  const token = sessionStorage.getItem('setu_token');
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(path, Object.assign({}, opts, { headers }));
  let data = {};
  try { data = await res.json(); } catch (e) { /* empty body is fine */ }
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

function showError(elId, message) {
  const el = document.getElementById(elId);
  if (el) el.innerHTML = `<div class="error-banner">${message}</div>`;
}
function clearError(elId) {
  const el = document.getElementById(elId);
  if (el) el.innerHTML = '';
}

function logout() {
  const token = sessionStorage.getItem('setu_token');
  sessionStorage.removeItem('setu_token');
  sessionStorage.removeItem('setu_role');
  sessionStorage.removeItem('setu_email');
  if (token) {
    fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token } }).catch(() => {});
  }
  window.location.href = 'index.html';
}

/* ---------- home page: workflow steps (static content) ---------- */
const STEPS = [
  "Challenge identification & posting — a department publishes a need with budget and eligibility limits.",
  "Discovery & application — startups browse live challenges and apply.",
  "Automated eligibility screening — the server checks turnover and registration years.",
  "Expert evaluation & shortlisting — reviewers approve eligible applicants for a pilot.",
  "Sandbox / pilot setup — a scoped pilot project begins.",
  "Live KPI tracking — both sides watch pilot progress in real time.",
  "Milestone-based payments — funds release in three tranches as work is delivered.",
  "Independent validation & audit — an auditor signs off on pilot results.",
  "Full procurement / scale-up decision — the department scales the solution or closes the project."
];
const stepList = document.getElementById('stepList');
if (stepList) {
  stepList.innerHTML = STEPS.map((s, i) => `<div class="step"><em>${i + 1}</em><div>${s}</div></div>`).join('');
}

/* ---------- auth page ---------- */
let chosenRole = null;
function selectRole(r) {
  chosenRole = r;
  document.querySelectorAll('.role').forEach(el => el.classList.toggle('active', el.dataset.role === r));
}
document.querySelectorAll('.tabs button[data-tab]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button[data-tab]').forEach(x => x.classList.remove('on'));
  b.classList.add('on');
}));

const authForm = document.getElementById('authForm');
if (authForm) {
  authForm.addEventListener('submit', async e => {
    e.preventDefault();
    clearError('authError');
    if (!chosenRole) {
      showError('authError', 'Please select Government Portal or Startup Portal.');
      return;
    }
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    try {
      const data = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, role: chosenRole })
      });
      sessionStorage.setItem('setu_token', data.token);
      sessionStorage.setItem('setu_role', data.role);
      sessionStorage.setItem('setu_email', data.email);
      window.location.href = data.role === 'gov' ? 'government.html' : 'startup.html';
    } catch (err) {
      showError('authError', err.message);
    }
  });
}

/* ---------- government portal ---------- */
const challengeForm = document.getElementById('challengeForm');
if (challengeForm) {
  challengeForm.addEventListener('submit', async e => {
    e.preventDefault();
    clearError('govError');
    const c = id => document.getElementById(id).value;
    try {
      await apiFetch('/api/challenges', {
        method: 'POST',
        body: JSON.stringify({
          title: c('c-title'), dept: c('c-dept'), sector: c('c-sector'), desc: c('c-desc'),
          budget: c('c-budget'), timeline: c('c-timeline'),
          maxYears: Number(document.getElementById('c-maxyears').value),
          minTurnover: Number(document.getElementById('c-minturnover').value)
        })
      });
      challengeForm.reset();
      document.getElementById('c-maxyears').value = 10;
      document.getElementById('c-minturnover').value = 500000;
      alert('Challenge posted. Startups can now discover and apply.');
    } catch (err) {
      showError('govError', err.message);
    }
  });

  document.querySelectorAll('.tabs button[data-gtab]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button[data-gtab]').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    document.querySelectorAll('[data-gpanel]').forEach(p => p.style.display = (p.dataset.gpanel === b.dataset.gtab) ? 'block' : 'none');
    renderGov();
  }));

  async function renderGov() {
    let state;
    try {
      state = await apiFetch('/api/data');
    } catch (err) {
      showError('govError', err.message);
      return;
    }
    const { challenges, applications } = state;

    const ev = document.getElementById('evalPanel');
    ev.innerHTML = applications.length ? applications.map(a => {
      const ch = challenges.find(x => x.id === a.challengeId);
      return `<div class="card">
        <div class="row"><h4>${a.startup} → ${ch ? ch.title : '—'}</h4>
        <span class="badge ${a.eligible ? 'ok' : 'bad'}">${a.eligible ? 'Eligible' : 'Ineligible'}</span></div>
        <p style="margin:4px 0;font-size:.88em;color:var(--grey)">Turnover ₹${a.turnover} · ${a.years} yrs in operation</p>
        <div class="row"><span class="badge ${a.status === 'shortlisted' ? 'ok' : a.status === 'rejected' ? 'bad' : 'pending'}">${a.status}</span>
        ${a.status === 'applied' && a.eligible ? `<span><button class="btn-sm primary" onclick="setAppStatus('${a.id}','shortlisted')">Shortlist for pilot</button>
        <button class="btn-sm danger" onclick="setAppStatus('${a.id}','rejected')">Reject</button></span>` : ''}</div>
      </div>`;
    }).join('') : '<p class="empty">No applications yet.</p>';

    const pil = document.getElementById('pilotPanel');
    const pilots = applications.filter(a => a.status === 'shortlisted' || a.status === 'scaled' || a.status === 'closed');
    pil.innerHTML = pilots.length ? pilots.map(a => {
      const ch = challenges.find(x => x.id === a.challengeId);
      return `<div class="card">
        <h4>${a.startup} — ${ch ? ch.title : '—'}</h4>
        <label style="margin-top:8px">KPI progress: ${a.kpi || 0}%</label>
        <div class="bar"><i style="width:${a.kpi || 0}%"></i></div>
        <label>Milestones (30/40/30)</label>
        <div class="mile">
          ${['Kickoff', 'Mid-Pilot', 'Completion'].map((m, i) =>
            `<span class="${a.paid[i] ? 'paid' : ''}" onclick="togglePay('${a.id}',${i})" style="cursor:pointer">${m} ${a.paid[i] ? '✓' : ''}</span>`).join('')}
        </div>
        <div class="row" style="margin-top:8px">
          <span class="badge ${a.audit === 'pass' ? 'ok' : a.audit === 'fail' ? 'bad' : 'pending'}">Audit: ${a.audit || 'pending'}</span>
          ${a.status === 'shortlisted' ? `<button class="btn-sm primary" onclick="scaleUp('${a.id}')">Approve scale-up</button>
          <button class="btn-sm" onclick="closeProj('${a.id}')">Close project</button>` : `<span class="badge ${a.status === 'scaled' ? 'ok' : 'bad'}">${a.status}</span>`}
        </div>
      </div>`;
    }).join('') : '<p class="empty">No shortlisted pilots yet.</p>';
  }

  window.setAppStatus = async function (id, status) {
    try { await apiFetch('/api/applications/status', { method: 'POST', body: JSON.stringify({ id, status }) }); renderGov(); }
    catch (err) { showError('govError', err.message); }
  };
  window.togglePay = async function (id, index) {
    try { await apiFetch('/api/applications/payment', { method: 'POST', body: JSON.stringify({ id, index }) }); renderGov(); }
    catch (err) { showError('govError', err.message); }
  };
  window.scaleUp = function (id) { window.setAppStatus(id, 'scaled'); };
  window.closeProj = function (id) { window.setAppStatus(id, 'closed'); };

  renderGov();
}

/* ---------- startup portal ---------- */
const discoverPanel = document.getElementById('discoverPanel');
if (discoverPanel) {
  document.querySelectorAll('.tabs button[data-stab]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button[data-stab]').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    document.querySelectorAll('[data-spanel]').forEach(p => p.style.display = (p.dataset.spanel === b.dataset.stab) ? 'block' : 'none');
    renderStartup();
  }));

  async function renderStartup() {
    let state;
    try {
      state = await apiFetch('/api/data');
    } catch (err) {
      showError('startupError', err.message);
      return;
    }
    const { challenges, applications, you } = state;

    discoverPanel.innerHTML = challenges.length ? challenges.map(ch => `
      <div class="card">
        <h4>${ch.title}</h4>
        <p style="margin:4px 0;font-size:.88em;color:var(--grey)">${ch.dept} · ${ch.sector} · Budget ${ch.budget} · ${ch.timeline}</p>
        <p style="margin:4px 0;font-size:.9em">${ch.desc}</p>
        <p style="margin:4px 0;font-size:.8em;color:var(--grey)">Needs ≤ ${ch.maxYears} yrs registered, ≥ ₹${ch.minTurnover} turnover</p>
        <details><summary style="cursor:pointer;color:var(--emerald);font-weight:600">Apply</summary>
          <form onsubmit="applyTo(event,'${ch.id}')">
            <label>Startup name</label><input class="a-name" required>
            <label>DPIIT registration no.</label><input class="a-dpiit" required>
            <label>Years in operation</label><input class="a-years" type="number" required>
            <label>Annual turnover (₹)</label><input class="a-turnover" type="number" required>
            <label>Technical proposal</label><textarea class="a-prop" rows="2" required></textarea>
            <label>KPI target commitment (%)</label><input class="a-target" type="number" value="90" required>
            <button class="cta" style="margin-top:10px">Submit application</button>
          </form>
        </details>
      </div>`).join('') : '<p class="empty">No open challenges yet — check back soon.</p>';

    const mine = applications.filter(a => a.ownerEmail === you.email);
    const mp = document.getElementById('minePanel');
    mp.innerHTML = mine.length ? mine.map(a => {
      const ch = challenges.find(x => x.id === a.challengeId);
      return `<div class="card">
        <div class="row"><h4>${ch ? ch.title : '—'}</h4><span class="badge ${a.eligible ? 'ok' : 'bad'}">${a.eligible ? 'Eligible' : 'Ineligible'}</span></div>
        <div class="row"><span class="badge ${a.status === 'shortlisted' ? 'ok' : a.status === 'rejected' ? 'bad' : a.status === 'scaled' ? 'ok' : 'pending'}">${a.status}</span></div>
        ${(a.status === 'shortlisted' || a.status === 'scaled' || a.status === 'closed') ? `
        <label style="margin-top:8px">Update KPI progress</label>
        <input type="range" min="0" max="100" value="${a.kpi || 0}" oninput="updateKpi('${a.id}',this.value)">
        <div class="bar"><i style="width:${a.kpi || 0}%"></i></div>
        <div class="mile">${['Kickoff', 'Mid-Pilot', 'Completion'].map((m, i) => `<span class="${a.paid[i] ? 'paid' : ''}">${m} ${a.paid[i] ? '✓ released' : 'pending'}</span>`).join('')}</div>
        <p style="margin-top:6px"><span class="badge ${a.audit === 'pass' ? 'ok' : 'pending'}">Independent audit: ${a.audit || 'pending'}</span></p>` : ''}
      </div>`;
    }).join('') : '<p class="empty">You haven\'t applied to any challenges yet.</p>';
  }

  window.applyTo = async function (e, challengeId) {
    e.preventDefault();
    clearError('startupError');
    const f = e.target;
    try {
      await apiFetch('/api/applications', {
        method: 'POST',
        body: JSON.stringify({
          challengeId,
          startup: f.querySelector('.a-name').value,
          dpiit: f.querySelector('.a-dpiit').value,
          years: Number(f.querySelector('.a-years').value),
          turnover: Number(f.querySelector('.a-turnover').value),
          proposal: f.querySelector('.a-prop').value,
          target: Number(f.querySelector('.a-target').value)
        })
      });
      alert('Application submitted. The server has run the eligibility check — see "My applications & pilots" for the result.');
      renderStartup();
    } catch (err) {
      showError('startupError', err.message);
    }
  };

  window.updateKpi = async function (id, val) {
    try { await apiFetch('/api/applications/kpi', { method: 'POST', body: JSON.stringify({ id, kpi: Number(val) }) }); renderStartup(); }
    catch (err) { showError('startupError', err.message); }
  };

  renderStartup();
}
