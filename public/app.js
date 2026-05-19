'use strict';

const state = {
  services: [],
  slots: [],
  selectedSlot: null,
};

const el = (id) => document.getElementById(id);

// Zaledni API je lahko na drugem originu (npr. Render), ko frontend teče
// na GitHub Pages. window.API_BASE nastaviš v config.js.
function apiUrl(p) {
  return (window.API_BASE || '') + p;
}

const dateFmt = new Intl.DateTimeFormat('sl-SI', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

function formatDay(isoDate) {
  const d = new Date(isoDate + 'T00:00:00');
  return dateFmt.format(d);
}

function eur(n) {
  return Number(n).toFixed(2).replace('.', ',') + ' €';
}

function slotKey(s) {
  return `${s.service_id}|${s.date}|${s.start_time}`;
}

function showMsg(container, text, kind) {
  container.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'msg ' + (kind === 'ok' ? 'ok' : 'err');
  div.textContent = text;
  container.appendChild(div);
}

async function api(path, options) {
  const res = await fetch(apiUrl(path), options);
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* brez telesa */
  }
  if (!res.ok) {
    const msg = (data && data.error) || 'Prišlo je do napake.';
    throw new Error(msg);
  }
  return data;
}

async function loadServices() {
  state.services = await api('/api/services');
  const sel = el('serviceFilter');
  for (const s of state.services) {
    const opt = document.createElement('option');
    opt.value = String(s.id);
    opt.textContent = `${s.name} — ${eur(s.price_eur)} (${s.duration_min} min)`;
    sel.appendChild(opt);
  }
}

function selectedService() {
  const filter = el('serviceFilter').value;
  if (!filter) return null;
  return state.services.find((s) => String(s.id) === filter) || null;
}

async function loadSlots() {
  const container = el('slotsContainer');
  const svc = selectedService();

  if (!svc) {
    state.slots = [];
    container.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Najprej izberite storitev.';
    container.appendChild(p);
    return;
  }

  container.textContent = 'Nalaganje terminov…';
  try {
    state.slots = await api('/api/slots?service_id=' + svc.id);
  } catch (err) {
    container.textContent = '';
    showMsg(container, err.message, 'err');
    return;
  }
  renderSlots();
}

function renderSlots() {
  const container = el('slotsContainer');
  container.innerHTML = '';

  const slots = state.slots;
  if (slots.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Trenutno ni prostih terminov. Preverite kasneje.';
    container.appendChild(p);
    return;
  }

  const byDay = new Map();
  for (const s of slots) {
    if (!byDay.has(s.date)) byDay.set(s.date, []);
    byDay.get(s.date).push(s);
  }

  for (const [date, daySlots] of byDay) {
    const group = document.createElement('div');
    group.className = 'day-group';

    const title = document.createElement('div');
    title.className = 'day-title';
    title.textContent = formatDay(date);
    group.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'slot-grid';

    for (const s of daySlots) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slot-btn';
      if (
        state.selectedSlot &&
        slotKey(state.selectedSlot) === slotKey(s)
      ) {
        btn.classList.add('selected');
      }

      const time = document.createElement('div');
      time.className = 'time';
      time.textContent = `${s.start_time}–${s.end_time}`;

      const svc = document.createElement('div');
      svc.className = 'svc';
      svc.textContent = s.service_name;

      const price = document.createElement('div');
      price.className = 'price';
      price.textContent = eur(s.price_eur);

      btn.append(time, svc, price);
      btn.addEventListener('click', () => selectSlot(s));
      grid.appendChild(btn);
    }

    group.appendChild(grid);
    container.appendChild(group);
  }
}

function selectSlot(slot) {
  state.selectedSlot = slot;
  renderSlots();

  const card = el('bookingCard');
  card.classList.remove('hidden');
  el('selectedSummary').textContent =
    `${formatDay(slot.date)} ob ${slot.start_time} · ` +
    `${slot.service_name} · ${eur(slot.price_eur)}`;
  el('formMsg').innerHTML = '';
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelSelection() {
  state.selectedSlot = null;
  el('bookingCard').classList.add('hidden');
  el('bookingForm').reset();
  renderSlots();
}

async function submitBooking(e) {
  e.preventDefault();
  if (!state.selectedSlot) return;

  const btn = el('submitBtn');
  btn.disabled = true;

  const s = state.selectedSlot;
  const payload = {
    service_id: s.service_id,
    date: s.date,
    start_time: s.start_time,
    customer_name: el('name').value,
    customer_phone: el('phone').value,
    customer_email: el('email').value,
    note: el('note').value,
  };

  try {
    const out = await api('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    showMsg(
      el('formMsg'),
      (out && out.message) || 'Rezervacija je potrjena. Se vidimo!',
      'ok'
    );
    el('bookingForm').reset();
    state.selectedSlot = null;
    await loadSlots();
    setTimeout(() => el('bookingCard').classList.add('hidden'), 2500);
  } catch (err) {
    showMsg(el('formMsg'), err.message, 'err');
    await loadSlots();
  } finally {
    btn.disabled = false;
  }
}

function updateServiceInfo() {
  const toggle = el('svcInfoToggle');
  const panel = el('svcInfo');

  panel.classList.add('hidden');
  panel.innerHTML = '';
  toggle.classList.add('hidden');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.textContent = 'Več informacij';

  const svc = selectedService();
  if (!svc) return;

  if (svc.image) {
    const img = document.createElement('img');
    img.src = svc.image;
    img.alt = svc.name;
    img.loading = 'lazy';
    panel.appendChild(img);
  }

  const descText = (svc.description || '').trim();
  if (descText) {
    for (const part of descText.split(/\n{2,}/)) {
      const p = document.createElement('p');
      p.className = 'svc-info-desc';
      p.textContent = part.trim();
      panel.appendChild(p);
    }
  }

  for (const [icon, text] of [
    ['⏳', `Trajanje: ${svc.duration_min} min`],
    ['💶', `Cena: ${eur(svc.price_eur)}`],
  ]) {
    const line = document.createElement('p');
    line.className = 'svc-info-meta';
    line.textContent = `${icon} ${text}`;
    panel.appendChild(line);
  }

  if (svc.image || descText) toggle.classList.remove('hidden');
}

function toggleServiceInfo() {
  const toggle = el('svcInfoToggle');
  const panel = el('svcInfo');
  const willShow = panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !willShow);
  toggle.setAttribute('aria-expanded', String(willShow));
  toggle.textContent = willShow ? 'Manj informacij' : 'Več informacij';
}

function onServiceChange() {
  state.selectedSlot = null;
  el('bookingCard').classList.add('hidden');
  updateServiceInfo();
  loadSlots();
}

el('serviceFilter').addEventListener('change', onServiceChange);
el('svcInfoToggle').addEventListener('click', toggleServiceInfo);
el('bookingForm').addEventListener('submit', submitBooking);
el('cancelBtn').addEventListener('click', cancelSelection);

(async function init() {
  try {
    await loadServices();
  } catch {
    /* storitve niso ključne za prikaz */
  }
  updateServiceInfo();
  await loadSlots();
})();
