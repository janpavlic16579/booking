'use strict';

const express = require('express');
const { query, transaction } = require('../db');
const { verifyPassword, createSession, requireAdmin } = require('../auth');
const {
  isValidDate,
  isValidTime,
  isValidHttpUrl,
  cleanStr,
  todayStr,
} = require('../validate');

const router = express.Router();

// Prijava.
router.post('/login', (req, res) => {
  const password = (req.body && req.body.password) || '';
  if (!verifyPassword(password)) {
    return res.status(401).json({ error: 'Napačno geslo.' });
  }
  res.json({ token: createSession() });
});

// Vse nadaljnje poti zahtevajo veljaven žeton.
router.use(requireAdmin);

// Preveri, ali je seja še veljavna (za frontend ob osvežitvi).
router.get('/me', (req, res) => res.json({ ok: true }));

/* ---------- Storitve ---------- */

function validImage(image) {
  return image === '' || isValidHttpUrl(image);
}

router.get('/services', async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, duration_min, price_eur, description, image,
            active, created_at
     FROM services ORDER BY active DESC, name`
  );
  res.json(rows);
});

router.post('/services', async (req, res) => {
  const body = req.body || {};
  const name = cleanStr(body.name, 120);
  const duration = Number(body.duration_min);
  const price = Number(body.price_eur);
  const description = cleanStr(body.description, 2000);
  const image = cleanStr(body.image, 500);

  if (name.length < 2) {
    return res.status(400).json({ error: 'Vnesite ime storitve.' });
  }
  if (!Number.isInteger(duration) || duration <= 0 || duration > 600) {
    return res.status(400).json({ error: 'Trajanje mora biti med 1 in 600 minut.' });
  }
  if (!Number.isFinite(price) || price < 0 || price > 100000) {
    return res.status(400).json({ error: 'Neveljavna cena.' });
  }
  if (!validImage(image)) {
    return res.status(400).json({ error: 'Neveljaven URL slike.' });
  }

  const { rows } = await query(
    `INSERT INTO services (name, duration_min, price_eur, description, image)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [name, duration, Math.round(price * 100) / 100, description, image]
  );

  res.status(201).json({ id: rows[0].id });
});

router.patch('/services/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Neveljaven ID.' });
  }
  const {
    rows: [existing],
  } = await query('SELECT * FROM services WHERE id = $1', [id]);
  if (!existing) {
    return res.status(404).json({ error: 'Storitev ne obstaja.' });
  }

  const body = req.body || {};
  const name =
    body.name !== undefined ? cleanStr(body.name, 120) : existing.name;
  const duration =
    body.duration_min !== undefined
      ? Number(body.duration_min)
      : existing.duration_min;
  const price =
    body.price_eur !== undefined ? Number(body.price_eur) : existing.price_eur;
  const description =
    body.description !== undefined
      ? cleanStr(body.description, 2000)
      : existing.description;
  const image =
    body.image !== undefined ? cleanStr(body.image, 500) : existing.image;
  const active =
    body.active !== undefined ? (body.active ? 1 : 0) : existing.active;

  if (name.length < 2) {
    return res.status(400).json({ error: 'Vnesite ime storitve.' });
  }
  if (!Number.isInteger(duration) || duration <= 0 || duration > 600) {
    return res.status(400).json({ error: 'Neveljavno trajanje.' });
  }
  if (!Number.isFinite(price) || price < 0 || price > 100000) {
    return res.status(400).json({ error: 'Neveljavna cena.' });
  }
  if (!validImage(image)) {
    return res.status(400).json({ error: 'Neveljaven URL slike.' });
  }

  await query(
    `UPDATE services
     SET name = $1, duration_min = $2, price_eur = $3,
         description = $4, image = $5, active = $6
     WHERE id = $7`,
    [name, duration, Math.round(price * 100) / 100, description, image, active, id]
  );

  res.json({ ok: true });
});

router.delete('/services/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Neveljaven ID.' });
  }
  // Zaklep vrstice storitve prepreči, da bi se med štetjem in brisanjem
  // pojavila nova rezervacija (njen tuji ključ bi ob brisanju padel).
  const result = await transaction(async (tx) => {
    await tx.query('SELECT id FROM services WHERE id = $1 FOR UPDATE', [id]);
    const { rows } = await tx.query(
      'SELECT COUNT(*)::int AS c FROM bookings WHERE service_id = $1',
      [id]
    );
    if (rows[0].c > 0) {
      // Storitev ima rezervacije — je ne brišemo, le deaktiviramo.
      await tx.query('UPDATE services SET active = 0 WHERE id = $1', [id]);
      return { ok: true, deactivated: true };
    }
    await tx.query('DELETE FROM services WHERE id = $1', [id]);
    return { ok: true, deleted: true };
  });
  res.json(result);
});

/* ---------- Razpoložljivost (delovna okna) ---------- */

function rangeWhere(from, to, column = 'date') {
  const cond = [];
  const args = [];
  if (isValidDate(from)) {
    args.push(from);
    cond.push(`${column} >= $${args.length}`);
  }
  if (isValidDate(to)) {
    args.push(to);
    cond.push(`${column} <= $${args.length}`);
  }
  return { sql: cond.length ? 'WHERE ' + cond.join(' AND ') : '', args };
}

router.get('/availability', async (req, res) => {
  const { sql, args } = rangeWhere(req.query.from, req.query.to);
  const { rows } = await query(
    `SELECT id, date, start_time, end_time
     FROM availability ${sql}
     ORDER BY date, start_time`,
    args
  );
  res.json(rows);
});

router.post('/availability', async (req, res) => {
  const body = req.body || {};
  const date = cleanStr(body.date, 10);
  const start = cleanStr(body.start_time, 5);
  const end = cleanStr(body.end_time, 5);

  if (!isValidDate(date)) {
    return res.status(400).json({ error: 'Neveljaven datum.' });
  }
  if (!isValidTime(start) || !isValidTime(end)) {
    return res.status(400).json({ error: 'Neveljaven čas.' });
  }
  if (start >= end) {
    return res
      .status(400)
      .json({ error: 'Konec mora biti za začetkom.' });
  }
  if (date < todayStr()) {
    return res.status(400).json({ error: 'Okno ne sme biti v preteklosti.' });
  }

  try {
    const { rows } = await query(
      `INSERT INTO availability (date, start_time, end_time)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [date, start, end]
    );
    res.status(201).json({
      id: rows[0].id,
      date,
      start_time: start,
      end_time: end,
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'To okno že obstaja.' });
    }
    console.error('Napaka pri ustvarjanju okna:', err);
    res.status(500).json({ error: 'Prišlo je do napake.' });
  }
});

router.patch('/availability/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Neveljaven ID.' });
  }
  const {
    rows: [row],
  } = await query(
    'SELECT id, date, start_time, end_time FROM availability WHERE id = $1',
    [id]
  );
  if (!row) {
    return res.status(404).json({ error: 'Okno ne obstaja.' });
  }

  const body = req.body || {};
  const start =
    body.start_time !== undefined
      ? cleanStr(body.start_time, 5)
      : row.start_time;
  const end =
    body.end_time !== undefined ? cleanStr(body.end_time, 5) : row.end_time;

  if (!isValidTime(start) || !isValidTime(end)) {
    return res.status(400).json({ error: 'Neveljaven čas.' });
  }
  if (start >= end) {
    return res.status(400).json({ error: 'Konec mora biti za začetkom.' });
  }
  if (row.date < todayStr()) {
    return res.status(400).json({ error: 'Okno je v preteklosti.' });
  }

  try {
    await query(
      'UPDATE availability SET start_time = $1, end_time = $2 WHERE id = $3',
      [start, end, id]
    );
    res.json({ ok: true, id, date: row.date, start_time: start, end_time: end });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'To okno že obstaja.' });
    }
    console.error('Napaka pri urejanju okna:', err);
    res.status(500).json({ error: 'Prišlo je do napake.' });
  }
});

router.delete('/availability/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Neveljaven ID.' });
  }
  const { rowCount } = await query('DELETE FROM availability WHERE id = $1', [id]);
  if (rowCount === 0) {
    return res.status(404).json({ error: 'Okno ne obstaja.' });
  }
  res.json({ ok: true });
});

/* ---------- Koledar (razpoložljivost + rezervacije) ---------- */

router.get('/calendar', async (req, res) => {
  const { sql, args } = rangeWhere(req.query.from, req.query.to);
  const { rows: availability } = await query(
    `SELECT id, date, start_time, end_time
     FROM availability ${sql}
     ORDER BY date, start_time`,
    args
  );

  const b = rangeWhere(req.query.from, req.query.to, 'b.date');
  const { rows: bookings } = await query(
    `SELECT b.id, b.service_id, srv.name AS service_name,
            b.date, b.start_time, b.end_time,
            b.customer_name, b.customer_phone, b.customer_email,
            b.note, b.created_at
     FROM bookings b
     JOIN services srv ON srv.id = b.service_id
     ${b.sql}
     ORDER BY b.date, b.start_time`,
    b.args
  );

  res.json({ availability, bookings });
});

/* ---------- Rezervacije ---------- */

router.get('/bookings', async (req, res) => {
  const { rows } = await query(
    `SELECT b.id, b.customer_name, b.customer_phone, b.customer_email,
            b.note, b.created_at,
            b.date, b.start_time, b.end_time,
            srv.name AS service_name, srv.price_eur
     FROM bookings b
     JOIN services srv ON srv.id = b.service_id
     ORDER BY b.date DESC, b.start_time`
  );
  res.json(rows);
});

module.exports = router;
