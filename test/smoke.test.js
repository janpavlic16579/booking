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

function futureDate(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

const FUT1 = futureDate(3); // okno za rezervacijo
const FUT2 = futureDate(5); // availability CRUD
const FUT3 = futureDate(7); // delni rep
const FUT4 = futureDate(9); // navzkrižno prekrivanje
const FUT5 = futureDate(11); // sočasnost
const FUT6 = futureDate(13); // PATCH okna

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
  const r = await j('/api/admin/availability');
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

test('seeded storitve so na voljo javno (z opisom in sliko)', async () => {
  const r = await j('/api/services');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
  assert.ok(r.body.length >= 3);
  assert.ok('description' in r.body[0]);
  assert.ok('image' in r.body[0]);
  const biab = r.body.find((s) => s.name === 'BIAB');
  assert.ok(biab && biab.description.length > 10);
  assert.ok(biab.image.includes('img/'));
});

let serviceId; // 30-minutna testna storitev
test('admin doda storitev (validacija + uspeh, z opisom/sliko)', async () => {
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
      description: 'Opis testne storitve.',
      image: 'https://example.com/test.jpg',
    }),
  });
  assert.equal(ok.status, 201);
  assert.ok(ok.body.id);
  serviceId = ok.body.id;

  const list = await j('/api/admin/services', { headers: authHeaders() });
  const mine = list.body.find((s) => s.id === serviceId);
  assert.equal(mine.description, 'Opis testne storitve.');
  assert.equal(mine.image, 'https://example.com/test.jpg');
});

test('admin odpre okno razpoložljivosti', async () => {
  const r = await j('/api/admin/availability', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      date: FUT1,
      start_time: '09:00',
      end_time: '12:00',
    }),
  });
  assert.equal(r.status, 201);
  assert.ok(r.body.id);

  const dup = await j('/api/admin/availability', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      date: FUT1,
      start_time: '09:00',
      end_time: '12:00',
    }),
  });
  assert.equal(dup.status, 409);

  const slots = await j('/api/slots?service_id=' + serviceId);
  const mine = slots.body.filter((s) => s.date === FUT1);
  // 30-min storitev v oknu 09:00–12:00 = 6 zaporednih terminov.
  assert.equal(mine.length, 6);
  assert.equal(mine[0].start_time, '09:00');
  assert.equal(mine[0].end_time, '09:30');
  assert.equal(mine[5].start_time, '11:30');
});

test('slots brez service_id vrne 400', async () => {
  const r = await j('/api/slots');
  assert.equal(r.status, 400);
});

test('rezervacija: validacija e-pošte', async () => {
  const r = await j('/api/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: serviceId,
      date: FUT1,
      start_time: '09:00',
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
      service_id: serviceId,
      date: FUT1,
      start_time: '09:00',
      customer_name: 'Ana Novak',
      customer_phone: '041123456',
      customer_email: 'ana@example.com',
      note: 'Francoska manikira',
    }),
  });
  assert.equal(r.status, 201);

  const slots = await j('/api/slots?service_id=' + serviceId);
  const at9 = slots.body.find(
    (s) => s.date === FUT1 && s.start_time === '09:00'
  );
  assert.equal(at9, undefined);
  // Po rezervaciji 09:00 ostane 5 terminov tega dne.
  assert.equal(slots.body.filter((s) => s.date === FUT1).length, 5);
});

test('off-grid termin (neporavnan začetek) vrne 409', async () => {
  const r = await j('/api/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: serviceId,
      date: FUT1,
      start_time: '09:10',
      customer_name: 'Test Oseba',
      customer_phone: '041000000',
      customer_email: 'test@example.com',
    }),
  });
  assert.equal(r.status, 409);
});

test('dvojna rezervacija istega termina vrne 409', async () => {
  const r = await j('/api/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: serviceId,
      date: FUT1,
      start_time: '09:00',
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
  assert.equal(r.body[0].date, FUT1);
  assert.equal(r.body[0].start_time, '09:00');
  assert.equal(r.body[0].service_name, 'Test storitev');
});

test('koledar feed vsebuje e-pošto in opombo rezervacije', async () => {
  const r = await j('/api/admin/calendar?from=' + FUT1 + '&to=' + FUT1, {
    headers: authHeaders(),
  });
  assert.equal(r.status, 200);
  const b = r.body.bookings.find((x) => x.customer_name === 'Ana Novak');
  assert.ok(b);
  assert.equal(b.customer_email, 'ana@example.com');
  assert.equal(b.note, 'Francoska manikira');
});

test('brisanje okna ne izbriše obstoječe rezervacije', async () => {
  const list = await j('/api/admin/availability?from=' + FUT1 + '&to=' + FUT1, {
    headers: authHeaders(),
  });
  const win = list.body.find((w) => w.date === FUT1);
  assert.ok(win);

  const del = await j('/api/admin/availability/' + win.id, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  assert.equal(del.status, 200);

  const bookings = await j('/api/admin/bookings', { headers: authHeaders() });
  assert.equal(bookings.body.length, 1);
});

test('availability CRUD', async () => {
  const create = await j('/api/admin/availability', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      date: FUT2,
      start_time: '13:00',
      end_time: '15:00',
    }),
  });
  assert.equal(create.status, 201);
  const id = create.body.id;

  const list = await j('/api/admin/availability?from=' + FUT2 + '&to=' + FUT2, {
    headers: authHeaders(),
  });
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].start_time, '13:00');

  const del = await j('/api/admin/availability/' + id, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  assert.equal(del.status, 200);

  const after = await j(
    '/api/admin/availability?from=' + FUT2 + '&to=' + FUT2,
    { headers: authHeaders() }
  );
  assert.equal(after.body.length, 0);

  const missing = await j('/api/admin/availability/999999', {
    method: 'DELETE',
    headers: authHeaders(),
  });
  assert.equal(missing.status, 404);
});

test('urejanje delovnega okna (PATCH spremeni trajanje)', async () => {
  const create = await j('/api/admin/availability', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      date: FUT6,
      start_time: '09:00',
      end_time: '12:00',
    }),
  });
  assert.equal(create.status, 201);
  const id = create.body.id;

  const patch = await j('/api/admin/availability/' + id, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ start_time: '09:00', end_time: '10:30' }),
  });
  assert.equal(patch.status, 200);
  assert.equal(patch.body.end_time, '10:30');

  const list = await j('/api/admin/availability?from=' + FUT6 + '&to=' + FUT6, {
    headers: authHeaders(),
  });
  assert.equal(list.body[0].end_time, '10:30');

  const badPatch = await j('/api/admin/availability/' + id, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ start_time: '11:00', end_time: '10:00' }),
  });
  assert.equal(badPatch.status, 400);

  const missing = await j('/api/admin/availability/999999', {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ start_time: '09:00', end_time: '10:00' }),
  });
  assert.equal(missing.status, 404);
});

test('delni rep krajši od trajanja se zavrže', async () => {
  await j('/api/admin/availability', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      date: FUT3,
      start_time: '09:00',
      end_time: '10:20',
    }),
  });
  const slots = await j('/api/slots?service_id=' + serviceId);
  const mine = slots.body.filter((s) => s.date === FUT3);
  assert.deepEqual(
    mine.map((s) => s.start_time),
    ['09:00', '09:30']
  );
});

test('navzkrižno prekrivanje rezervacije izloči termin', async () => {
  const svc90 = await j('/api/admin/services', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      name: 'Storitev 90',
      duration_min: 90,
      price_eur: 40,
    }),
  });
  const svc90Id = svc90.body.id;

  await j('/api/admin/availability', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      date: FUT4,
      start_time: '09:00',
      end_time: '12:00',
    }),
  });

  // Rezerviraj 30-min storitev ob 10:00 (10:00–10:30).
  const book = await j('/api/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: serviceId,
      date: FUT4,
      start_time: '10:00',
      customer_name: 'Cilka Test',
      customer_phone: '040111222',
      customer_email: 'cilka@example.com',
    }),
  });
  assert.equal(book.status, 201);

  const slots = await j('/api/slots?service_id=' + svc90Id);
  const mine = slots.body.filter((s) => s.date === FUT4);
  const starts = mine.map((s) => s.start_time);
  // 09:00 (09:00–10:30) se prekriva z 10:00–10:30 -> izločen.
  assert.ok(!starts.includes('09:00'));
  // 10:30 (10:30–12:00) ostane.
  assert.ok(starts.includes('10:30'));
});

test('sočasna dvojna rezervacija: en uspeh, en 409', async () => {
  await j('/api/admin/availability', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      date: FUT5,
      start_time: '09:00',
      end_time: '10:00',
    }),
  });

  const payload = (n) =>
    JSON.stringify({
      service_id: serviceId,
      date: FUT5,
      start_time: '09:00',
      customer_name: 'Tekma ' + n,
      customer_phone: '041555' + n,
      customer_email: `tekma${n}@example.com`,
    });

  const [a, b] = await Promise.all([
    j('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload(1),
    }),
    j('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload(2),
    }),
  ]);

  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [201, 409]);
});

test('validacija URL slike pri storitvi', async () => {
  for (const bad of ['javascript:alert(1)', 'notaurl']) {
    const r = await j('/api/admin/services', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        name: 'Slaba slika',
        duration_min: 30,
        price_eur: 10,
        image: bad,
      }),
    });
    assert.equal(r.status, 400);
  }

  const good = await j('/api/admin/services', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      name: 'Dobra slika',
      duration_min: 30,
      price_eur: 10,
      image: 'https://example.com/a.jpg',
    }),
  });
  assert.equal(good.status, 201);

  const patch = await j('/api/admin/services/' + good.body.id, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ description: 'Posodobljen opis.' }),
  });
  assert.equal(patch.status, 200);

  const list = await j('/api/admin/services', { headers: authHeaders() });
  const row = list.body.find((s) => s.id === good.body.id);
  assert.equal(row.description, 'Posodobljen opis.');
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
