'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const TMP_DB = path.join(
  os.tmpdir(),
  `booking-test-${process.pid}-${Date.now()}.db`
);

const ALLOWED_ORIGIN = 'https://nohti.example';

process.env.PORT = '0';
process.env.ADMIN_PASSWORD = 'testpass';
process.env.DB_PATH = TMP_DB;
process.env.SESSION_TTL_HOURS = '1';
process.env.ALLOWED_ORIGINS = ALLOWED_ORIGIN;

const { server } = require('../server');

let base;
let token;

test.before(async () => {
  await new Promise((resolve) => {
    if (server.listening) return resolve();
    server.once('listening', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    try {
      fs.unlinkSync(TMP_DB + suffix);
    } catch {
      /* ignore */
    }
  }
});

async function j(pathname, opts = {}) {
  const res = await fetch(base + pathname, opts);
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* ni telesa */
  }
  return { status: res.status, body };
}

function authHeaders(extra = {}) {
  return { Authorization: 'Bearer ' + token, ...extra };
}

test('strani in health delujejo', async () => {
  const health = await fetch(base + '/health');
  assert.equal(health.status, 200);

  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Stiliranje nohtov/);

  const admin = await fetch(base + '/admin');
  assert.equal(admin.status, 200);
  assert.match(await admin.text(), /Skrbniški del/);
});

test('admin poti so zaščitene brez žetona', async () => {
  const r = await j('/api/admin/slots');
  assert.equal(r.status, 401);
});

test('prijava: napačno geslo zavrnjeno, pravilno vrne žeton', async () => {
  const bad = await j('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'napacno' }),
  });
  assert.equal(bad.status, 401);

  const ok = await j('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'testpass' }),
  });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  token = ok.body.token;
});

test('seeded storitve so na voljo javno', async () => {
  const r = await j('/api/services');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
  assert.ok(r.body.length >= 3);
});

let serviceId;
test('admin doda storitev (validacija + uspeh)', async () => {
  const bad = await j('/api/admin/services', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name: 'X', duration_min: -5, price_eur: 10 }),
  });
  assert.equal(bad.status, 400);

  const ok = await j('/api/admin/services', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      name: 'Test storitev',
      duration_min: 30,
      price_eur: 25.5,
    }),
  });
  assert.equal(ok.status, 201);
  assert.ok(ok.body.id);
  serviceId = ok.body.id;
});

let slotId;
test('admin odpre termine', async () => {
  const future = new Date(Date.now() + 3 * 86400000)
    .toISOString()
    .slice(0, 10);

  const r = await j('/api/admin/slots', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      service_id: serviceId,
      date: future,
      times: ['10:00', '11:30'],
    }),
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.created, 2);

  const dup = await j('/api/admin/slots', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      service_id: serviceId,
      date: future,
      times: ['10:00'],
    }),
  });
  assert.equal(dup.body.skipped, 1);

  const slots = await j('/api/slots');
  const mine = slots.body.filter((s) => s.service_id === serviceId);
  assert.equal(mine.length, 2);
  slotId = mine[0].id;
});

test('rezervacija: validacija e-pošte', async () => {
  const r = await j('/api/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slot_id: slotId,
      customer_name: 'Ana Novak',
      customer_phone: '041123456',
      customer_email: 'ni-email',
    }),
  });
  assert.equal(r.status, 400);
});

test('uspešna rezervacija zasede termin', async () => {
  const r = await j('/api/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slot_id: slotId,
      customer_name: 'Ana Novak',
      customer_phone: '041123456',
      customer_email: 'ana@example.com',
      note: 'Francoska manikira',
    }),
  });
  assert.equal(r.status, 201);

  const slots = await j('/api/slots');
  assert.equal(
    slots.body.find((s) => s.id === slotId),
    undefined
  );
});

test('dvojna rezervacija istega termina vrne 409', async () => {
  const r = await j('/api/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slot_id: slotId,
      customer_name: 'Bojan Kovač',
      customer_phone: '031999888',
      customer_email: 'bojan@example.com',
    }),
  });
  assert.equal(r.status, 409);
});

test('admin vidi rezervacijo', async () => {
  const r = await j('/api/admin/bookings', { headers: authHeaders() });
  assert.equal(r.status, 200);
  assert.equal(r.body.length, 1);
  assert.equal(r.body[0].customer_name, 'Ana Novak');
});

test('rezerviranega termina ni mogoče izbrisati', async () => {
  const r = await j('/api/admin/slots/' + slotId, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  assert.equal(r.status, 409);
});

/* ---------- CORS (frontend na drugem originu) ---------- */

test('CORS: preflight OPTIONS vrne 204 z dovoljenimi glavami', async () => {
  const res = await fetch(base + '/api/bookings', {
    method: 'OPTIONS',
    headers: {
      Origin: ALLOWED_ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,authorization',
    },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
  const methods = res.headers.get('access-control-allow-methods') || '';
  assert.match(methods, /POST/);
  assert.match(methods, /OPTIONS/);
  const allowHeaders = (
    res.headers.get('access-control-allow-headers') || ''
  ).toLowerCase();
  assert.match(allowHeaders, /authorization/);
  assert.match(allowHeaders, /content-type/);
});

test('CORS: dovoljen origin dobi Access-Control-Allow-Origin', async () => {
  const res = await fetch(base + '/api/services', {
    headers: { Origin: ALLOWED_ORIGIN },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
});

test('CORS: nedovoljen origin ne dobi dovoljenja zanj', async () => {
  const res = await fetch(base + '/api/services', {
    headers: { Origin: 'https://zlonamerni.example' },
  });
  assert.equal(res.status, 200); // javni API še vedno deluje
  assert.notEqual(
    res.headers.get('access-control-allow-origin'),
    'https://zlonamerni.example'
  );
});
