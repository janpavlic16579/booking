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
        extendedProps: {
          kind: 'availability',
          realId: a.id,
          date: a.date,
          start_time: a.start_time,
          end_time: a.end_time,
        },
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
        extendedProps: { kind: 'booking', booking: b },
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

function onEventClick(info) {
  const p = info.event.extendedProps;
  if (p.kind === 'availability') {
    openAvailabilityModal(p);
  } else if (p.kind === 'booking') {
    openBookingModal(p.booking);
  }
}

/* ---------- Modalno okno ---------- */

function openModal(title) {
  el('modalTitle').textContent = title;
  el('modalBody').innerHTML = '';
  el('modalOverlay').classList.remove('hidden');
  return el('modalBody');
}

function closeModal() {
  el('modalOverlay').classList.add('hidden');
  el('modalBody').innerHTML = '';
}

function defRow(label, value) {
  const wrap = document.createElement('div');
  wrap.className = 'def-row';
  const dt = document.createElement('span');
  dt.className = 'def-label';
  dt.textContent = label;
  const dd = document.createElement('span');
  dd.className = 'def-value';
  dd.textContent = value || '—';
  wrap.append(dt, dd);
  return wrap;
}

function openBookingModal(b) {
  const body = openModal('Podatki o rezervaciji');
  body.append(
    defRow('Storitev', b.service_name),
    defRow('Datum', formatDay(b.date)),
    defRow('Ura', `${b.start_time}–${b.end_time}`),
    defRow('Ime in priimek', b.customer_name),
    defRow('Telefon', b.customer_phone),
    defRow('E-pošta', b.customer_email),
    defRow('Opomba', b.note)
  );

  const tel = document.createElement('a');
  tel.href = 'tel:' + (b.customer_phone || '');
  tel.className = 'secondary small';
  tel.style.display = 'inline-block';
  tel.style.marginTop = '6px';
  tel.textContent = 'Pokliči stranko';

  const mail = document.createElement('a');
  mail.href = 'mailto:' + (b.customer_email || '');
  mail.className = 'secondary small';
  mail.style.display = 'inline-block';
  mail.style.marginTop = '6px';
  mail.style.marginLeft = '8px';
  mail.textContent = 'Pošlji e-pošto';

  const actions = document.createElement('div');
  actions.style.marginTop = '16px';
  actions.append(tel, mail);
  body.appendChild(actions);
}

function openAvailabilityModal(p) {
  const body = openModal('Delovno okno · ' + formatDay(p.date));
  const msg = document.createElement('div');

  const grid = document.createElement('div');
  grid.className = 'row';

  const mkField = (labelText, value) => {
    const box = document.createElement('div');
    const lab = document.createElement('label');
    lab.textContent = labelText;
    const inp = document.createElement('input');
    inp.type = 'time';
    inp.value = value;
    box.append(lab, inp);
    grid.appendChild(box);
    return inp;
  };
  const startInp = mkField('Začetek', p.start_time);
  const endInp = mkField('Konec', p.end_time);

  const save = mkBtn('Shrani spremembe', '', async () => {
    save.disabled = true;
    try {
      await api('/api/admin/availability/' + p.realId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_time: startInp.value,
          end_time: endInp.value,
        }),
      });
      closeModal();
      showMsg(el('calMsg'), 'Delovno okno posodobljeno.', 'ok');
      state.calendar.refetchEvents();
    } catch (err) {
      showMsg(msg, err.message, 'err');
      save.disabled = false;
    }
  });

  const del = mkBtn('Izbriši okno', 'danger', async () => {
    if (!confirm('Izbrisati to delovno okno?')) return;
    del.disabled = true;
    try {
      await api('/api/admin/availability/' + p.realId, { method: 'DELETE' });
      closeModal();
      showMsg(el('calMsg'), 'Okno izbrisano.', 'ok');
      state.calendar.refetchEvents();
    } catch (err) {
      showMsg(msg, err.message, 'err');
      del.disabled = false;
    }
  });

  const cancel = mkBtn('Prekliči', 'secondary', closeModal);

  const actions = document.createElement('div');
  actions.className = 'row';
  actions.style.marginTop = '16px';
  actions.append(save, del, cancel);

  body.append(grid, msg, actions);
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
el('modalClose').addEventListener('click', closeModal);
el('modalOverlay').addEventListener('click', (e) => {
  if (e.target === el('modalOverlay')) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !el('modalOverlay').classList.contains('hidden')) {
    closeModal();
  }
});
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
