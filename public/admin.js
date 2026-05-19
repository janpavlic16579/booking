'use strict';

const el = (id) => document.getElementById(id);
const TOKEN_KEY = 'booking_admin_token';

// Zaledni API je lahko na drugem originu (npr. Render), ko admin frontend
// teče na GitHub Pages. window.API_BASE nastaviš v config.js.
function apiUrl(p) {
  return (window.API_BASE || '') + p;
}

const state = {
  token: localStorage.getItem(TOKEN_KEY) || null,
  services: [],
  editingId: null,
  calendar: null,
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
  const res = await fetch(apiUrl(path), opts);
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
    const out = await fetch(apiUrl('/api/admin/login'), {
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
  await Promise.all([loadServices(), loadBookings()]);
  initCalendar();
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
      // Koledar se mora prerisati, ko postane viden.
      if (tab === 'slots' && state.calendar) {
        state.calendar.updateSize();
        state.calendar.refetchEvents();
      }
    });
  });
}

/* ---------- Koledar ---------- */

function initCalendar() {
  if (state.calendar) {
    state.calendar.refetchEvents();
    return;
  }
  if (!window.FullCalendar) {
    el('calFallback').classList.remove('hidden');
    return;
  }
  state.calendar = new FullCalendar.Calendar(el('calendar'), {
    initialView: 'timeGridWeek',
    locale: 'sl',
    firstDay: 1,
    allDaySlot: false,
    slotMinTime: '07:00:00',
    slotMaxTime: '21:00:00',
    nowIndicator: true,
    height: 'auto',
    selectable: true,
    selectMirror: true,
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'timeGridWeek,timeGridDay',
    },
    select: onSelectCreate,
    eventClick: onEventClick,
    events: fetchFeed,
  });
  state.calendar.render();
}

async function fetchFeed(info, success, failure) {
  try {
    const from = info.startStr.slice(0, 10);
    const to = info.endStr.slice(0, 10);
    const data = await api(`/api/admin/calendar?from=${from}&to=${to}`);
    const events = [];
    for (const a of data.availability) {
      events.push({
        id: 'a' + a.id,
        title: 'Prosto',
        start: a.date + 'T' + a.start_time,
        end: a.date + 'T' + a.end_time,
        backgroundColor: '#5e7355',
        borderColor: '#4f6147',
        extendedProps: { kind: 'availability', realId: a.id },
      });
    }
    for (const b of data.bookings) {
      events.push({
        id: 'b' + b.id,
        title: `${b.service_name} — ${b.customer_name}`,
        start: b.date + 'T' + b.start_time,
        end: b.date + 'T' + b.end_time,
        backgroundColor: '#a8998b',
        borderColor: '#8c7d6f',
        editable: false,
        extendedProps: { kind: 'booking', phone: b.customer_phone },
      });
    }
    success(events);
  } catch (err) {
    showMsg(el('calMsg'), err.message, 'err');
    failure(err);
  }
}

async function onSelectCreate(sel) {
  const date = sel.startStr.slice(0, 10);
  const start_time = sel.startStr.slice(11, 16);
  let end_time = sel.endStr.slice(11, 16);
  if (sel.endStr.slice(0, 10) !== date) end_time = '23:59';
  try {
    await api('/api/admin/availability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, start_time, end_time }),
    });
    showMsg(el('calMsg'), 'Delovno okno dodano.', 'ok');
  } catch (err) {
    showMsg(el('calMsg'), err.message, 'err');
  } finally {
    state.calendar.unselect();
    state.calendar.refetchEvents();
  }
}

async function onEventClick(info) {
  const p = info.event.extendedProps;
  if (p.kind === 'availability') {
    if (!confirm('Izbrisati to delovno okno?')) return;
    try {
      await api('/api/admin/availability/' + p.realId, { method: 'DELETE' });
      showMsg(el('calMsg'), 'Okno izbrisano.', 'ok');
    } catch (err) {
      showMsg(el('calMsg'), err.message, 'err');
    } finally {
      state.calendar.refetchEvents();
    }
  } else if (p.kind === 'booking') {
    alert(`${info.event.title}\nTelefon: ${p.phone || '—'}`);
  }
}

/* ---------- Storitve ---------- */

async function loadServices() {
  state.services = await api('/api/admin/services');

  const tbody = el('servicesTable').querySelector('tbody');
  tbody.innerHTML = '';
  for (const s of state.services) {
    const tr = document.createElement('tr');

    const imgCell = document.createElement('td');
    if (s.image) {
      const img = document.createElement('img');
      img.src = s.image;
      img.alt = s.name;
      img.className = 'svc-thumb';
      imgCell.appendChild(img);
    } else {
      imgCell.textContent = '—';
    }

    tr.append(
      imgCell,
      td(s.name),
      td(s.duration_min + ' min'),
      td(eur(s.price_eur)),
      badgeCell(s.active ? 'Aktivna' : 'Neaktivna', s.active ? 'free' : 'off')
    );

    const actions = document.createElement('td');
    const edit = mkBtn('Uredi', 'secondary small', () => startEdit(s));
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
        if (state.calendar) state.calendar.refetchEvents();
      }
    );
    const del = mkBtn('Izbriši', 'danger small', async () => {
      if (!confirm(`Izbrisati storitev "${s.name}"?`)) return;
      await api('/api/admin/services/' + s.id, { method: 'DELETE' });
      if (state.editingId === s.id) clearEdit();
      await loadServices();
      if (state.calendar) state.calendar.refetchEvents();
    });
    actions.append(
      edit,
      document.createTextNode(' '),
      toggle,
      document.createTextNode(' '),
      del
    );
    tr.appendChild(actions);
    tbody.appendChild(tr);
  }
}

function updateImagePreview() {
  const url = el('svcImage').value.trim();
  const prev = el('svcImagePreview');
  if (url) {
    prev.src = url;
    prev.classList.remove('hidden');
  } else {
    prev.removeAttribute('src');
    prev.classList.add('hidden');
  }
}

function startEdit(s) {
  state.editingId = s.id;
  el('svcName').value = s.name;
  el('svcDuration').value = s.duration_min;
  el('svcPrice').value = s.price_eur;
  el('svcDesc').value = s.description || '';
  el('svcImage').value = s.image || '';
  updateImagePreview();
  el('serviceFormTitle').textContent = 'Uredi storitev: ' + s.name;
  el('svcSubmitBtn').textContent = 'Shrani spremembe';
  el('svcCancelEdit').classList.remove('hidden');
  el('serviceMsg').innerHTML = '';
  // Preklopi na zavihek Storitve in pokaži obrazec.
  document.querySelector('.tab[data-tab="services"]').click();
  el('serviceFormTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function clearEdit() {
  state.editingId = null;
  el('serviceForm').reset();
  updateImagePreview();
  el('serviceFormTitle').textContent = 'Dodaj storitev';
  el('svcSubmitBtn').textContent = 'Dodaj';
  el('svcCancelEdit').classList.add('hidden');
}

async function saveService(e) {
  e.preventDefault();
  const payload = {
    name: el('svcName').value,
    duration_min: Number(el('svcDuration').value),
    price_eur: Number(el('svcPrice').value),
    description: el('svcDesc').value,
    image: el('svcImage').value.trim(),
  };
  try {
    if (state.editingId) {
      await api('/api/admin/services/' + state.editingId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      showMsg(el('serviceMsg'), 'Storitev posodobljena.', 'ok');
    } else {
      await api('/api/admin/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      showMsg(el('serviceMsg'), 'Storitev dodana.', 'ok');
    }
    clearEdit();
    await loadServices();
    if (state.calendar) state.calendar.refetchEvents();
  } catch (err) {
    showMsg(el('serviceMsg'), err.message, 'err');
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
el('serviceForm').addEventListener('submit', saveService);
el('svcCancelEdit').addEventListener('click', clearEdit);
el('svcImage').addEventListener('input', updateImagePreview);
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
