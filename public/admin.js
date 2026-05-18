'use strict';

const el = (id) => document.getElementById(id);
const TOKEN_KEY = 'booking_admin_token';

const state = {
  token: localStorage.getItem(TOKEN_KEY) || null,
  services: [],
  pendingTimes: [],
};

const dateFmt = new Intl.DateTimeFormat('sl-SI', {
  weekday: 'short',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
function formatDay(iso) {
  return dateFmt.format(new Date(iso + 'T00:00:00'));
}
function eur(n) {
  return Number(n).toFixed(2).replace('.', ',') + ' €';
}

function showMsg(container, text, kind) {
  container.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'msg ' + (kind === 'ok' ? 'ok' : 'err');
  div.textContent = text;
  container.appendChild(div);
}

async function api(path, options = {}) {
  const opts = { ...options, headers: { ...(options.headers || {}) } };
  if (state.token) opts.headers.Authorization = 'Bearer ' + state.token;
  const res = await fetch(path, opts);
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* brez telesa */
  }
  if (res.status === 401) {
    logout();
    throw new Error('Seja je potekla. Prijavite se znova.');
  }
  if (!res.ok) {
    throw new Error((data && data.error) || 'Prišlo je do napake.');
  }
  return data;
}

/* ---------- Auth ---------- */

async function doLogin(e) {
  e.preventDefault();
  try {
    const out = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: el('password').value }),
    });
    const data = await out.json().catch(() => ({}));
    if (!out.ok) throw new Error(data.error || 'Napačno geslo.');
    state.token = data.token;
    localStorage.setItem(TOKEN_KEY, data.token);
    el('password').value = '';
    enterDashboard();
  } catch (err) {
    showMsg(el('loginMsg'), err.message, 'err');
  }
}

function logout() {
  state.token = null;
  localStorage.removeItem(TOKEN_KEY);
  el('dashboard').classList.add('hidden');
  el('loginCard').classList.remove('hidden');
}

async function enterDashboard() {
  el('loginCard').classList.add('hidden');
  el('dashboard').classList.remove('hidden');
  await Promise.all([loadServices(), loadSlots(), loadBookings()]);
}

/* ---------- Zavihki ---------- */

function setupTabs() {
  document.querySelectorAll('.tab[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document
        .querySelectorAll('.tab[data-tab]')
        .forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      for (const name of ['slots', 'services', 'bookings']) {
        el('tab-' + name).classList.toggle('hidden', name !== tab);
      }
    });
  });
}

/* ---------- Storitve ---------- */

async function loadServices() {
  state.services = await api('/api/admin/services');

  const sel = el('slotService');
  sel.innerHTML = '';
  for (const s of state.services.filter((x) => x.active)) {
    const opt = document.createElement('option');
    opt.value = String(s.id);
    opt.textContent = `${s.name} (${s.duration_min} min, ${eur(s.price_eur)})`;
    sel.appendChild(opt);
  }

  const tbody = el('servicesTable').querySelector('tbody');
  tbody.innerHTML = '';
  for (const s of state.services) {
    const tr = document.createElement('tr');
    tr.append(
      td(s.name),
      td(s.duration_min + ' min'),
      td(eur(s.price_eur)),
      badgeCell(s.active ? 'Aktivna' : 'Neaktivna', s.active ? 'free' : 'off')
    );

    const actions = document.createElement('td');
    const toggle = mkBtn(
      s.active ? 'Deaktiviraj' : 'Aktiviraj',
      'secondary small',
      async () => {
        await api('/api/admin/services/' + s.id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: s.active ? 0 : 1 }),
        });
        await loadServices();
      }
    );
    const del = mkBtn('Izbriši', 'danger small', async () => {
      if (!confirm(`Izbrisati storitev "${s.name}"?`)) return;
      await api('/api/admin/services/' + s.id, { method: 'DELETE' });
      await loadServices();
      await loadSlots();
    });
    actions.append(toggle, document.createTextNode(' '), del);
    tr.appendChild(actions);
    tbody.appendChild(tr);
  }
}

async function addService(e) {
  e.preventDefault();
  try {
    await api('/api/admin/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: el('svcName').value,
        duration_min: Number(el('svcDuration').value),
        price_eur: Number(el('svcPrice').value),
      }),
    });
    el('serviceForm').reset();
    showMsg(el('serviceMsg'), 'Storitev dodana.', 'ok');
    await loadServices();
  } catch (err) {
    showMsg(el('serviceMsg'), err.message, 'err');
  }
}

/* ---------- Termini ---------- */

function renderChips() {
  const wrap = el('timeChips');
  wrap.innerHTML = '';
  state.pendingTimes.sort();
  for (const t of state.pendingTimes) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'tab';
    chip.textContent = t + '  ✕';
    chip.title = 'Klikni za odstranitev';
    chip.addEventListener('click', () => {
      state.pendingTimes = state.pendingTimes.filter((x) => x !== t);
      renderChips();
    });
    wrap.appendChild(chip);
  }
}

function addTime() {
  const v = el('slotTime').value;
  if (v && !state.pendingTimes.includes(v)) {
    state.pendingTimes.push(v);
    renderChips();
  }
}

async function createSlots(e) {
  e.preventDefault();
  if (state.pendingTimes.length === 0) {
    showMsg(el('slotMsg'), 'Dodajte vsaj eno uro.', 'err');
    return;
  }
  try {
    const out = await api('/api/admin/slots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: Number(el('slotService').value),
        date: el('slotDate').value,
        times: state.pendingTimes,
      }),
    });
    let txt = `Odprtih ${out.created} terminov.`;
    if (out.skipped) txt += ` ${out.skipped} preskočenih (že obstajajo).`;
    showMsg(el('slotMsg'), txt, 'ok');
    state.pendingTimes = [];
    renderChips();
    await loadSlots();
  } catch (err) {
    showMsg(el('slotMsg'), err.message, 'err');
  }
}

async function loadSlots() {
  const rows = await api('/api/admin/slots');
  const tbody = el('slotsTable').querySelector('tbody');
  tbody.innerHTML = '';

  if (rows.length === 0) {
    const tr = document.createElement('tr');
    const c = document.createElement('td');
    c.colSpan = 7;
    c.className = 'muted';
    c.textContent = 'Ni terminov.';
    tr.appendChild(c);
    tbody.appendChild(tr);
    return;
  }

  for (const s of rows) {
    const tr = document.createElement('tr');
    tr.append(
      td(formatDay(s.date)),
      td(`${s.start_time}–${s.end_time}`),
      td(s.service_name),
      td(eur(s.price_eur)),
      badgeCell(
        s.status === 'booked' ? 'Rezervirano' : 'Prosto',
        s.status === 'booked' ? 'booked' : 'free'
      ),
      td(
        s.customer_name
          ? `${s.customer_name} · ${s.customer_phone}`
          : '—'
      )
    );

    const actions = document.createElement('td');
    if (s.status === 'free') {
      actions.appendChild(
        mkBtn('Izbriši', 'danger small', async () => {
          if (!confirm('Izbrisati ta prosti termin?')) return;
          try {
            await api('/api/admin/slots/' + s.id, { method: 'DELETE' });
            await loadSlots();
          } catch (err) {
            alert(err.message);
          }
        })
      );
    } else {
      actions.textContent = '—';
    }
    tr.appendChild(actions);
    tbody.appendChild(tr);
  }
}

/* ---------- Rezervacije ---------- */

async function loadBookings() {
  const rows = await api('/api/admin/bookings');
  const tbody = el('bookingsTable').querySelector('tbody');
  tbody.innerHTML = '';

  if (rows.length === 0) {
    const tr = document.createElement('tr');
    const c = document.createElement('td');
    c.colSpan = 7;
    c.className = 'muted';
    c.textContent = 'Ni rezervacij.';
    tr.appendChild(c);
    tbody.appendChild(tr);
    return;
  }

  for (const b of rows) {
    const tr = document.createElement('tr');
    tr.append(
      td(formatDay(b.date)),
      td(`${b.start_time}–${b.end_time}`),
      td(`${b.service_name} (${eur(b.price_eur)})`),
      td(b.customer_name),
      td(b.customer_phone),
      td(b.customer_email),
      td(b.note || '—')
    );
    tbody.appendChild(tr);
  }
}

/* ---------- Pomožne ---------- */

function td(text) {
  const c = document.createElement('td');
  c.textContent = text;
  return c;
}
function badgeCell(text, kind) {
  const c = document.createElement('td');
  const span = document.createElement('span');
  span.className = 'badge ' + kind;
  span.textContent = text;
  c.appendChild(span);
  return c;
}
function mkBtn(label, cls, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

/* ---------- Init ---------- */

el('loginForm').addEventListener('submit', doLogin);
el('logoutBtn').addEventListener('click', logout);
el('serviceForm').addEventListener('submit', addService);
el('slotForm').addEventListener('submit', createSlots);
el('addTimeBtn').addEventListener('click', addTime);
setupTabs();

(async function init() {
  if (!state.token) return;
  try {
    await api('/api/admin/me');
    await enterDashboard();
  } catch {
    logout();
  }
})();
