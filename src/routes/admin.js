'use strict';

const express = require('express');
const { db } = require('../db');
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

router.get('/services', (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, name, duration_min, price_eur, description, image,
              active, created_at
       FROM services ORDER BY active DESC, name`
    )
    .all();
  res.json(rows);
});

router.post('/services', (req, res) => {
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

  const info = db
    .prepare(
      `INSERT INTO services (name, duration_min, price_eur, description, image)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(name, duration, Math.round(price * 100) / 100, description, image);

  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

router.patch('/services/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Neveljaven ID.' });
  }
  const existing = db.prepare('SELECT * FROM services WHERE id = ?').get(id);
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

  db.prepare(
    `UPDATE services
     SET name = ?, duration_min = ?, price_eur = ?,
         description = ?, image = ?, active = ?
     WHERE id = ?`
  ).run(
    name,
    duration,
    Math.round(price * 100) / 100,
    description,
    image,
    active,
    id
  );

  res.json({ ok: true });
});

router.delete('/services/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Neveljaven ID.' });
  }
  const used = db
    .prepare('SELECT COUNT(*) AS c FROM bookings WHERE service_id = ?')
    .get(id).c;

  if (used > 0) {
    // Storitev ima rezervacije — je ne brišemo, le deaktiviramo.
    db.prepare('UPDATE services SET active = 0 WHERE id = ?').run(id);
    return res.json({ ok: true, deactivated: true });
  }
  db.prepare('DELETE FROM services WHERE id = ?').run(id);
  res.json({ ok: true, deleted: true });
});

/* ---------- Razpoložljivost (delovna okna) ---------- */

function rangeWhere(from, to) {
  const cond = [];
  const args = [];
  if (isValidDate(from)) {
    cond.push('date >= ?');
    args.push(from);
  }
  if (isValidDate(to)) {
    cond.push('date <= ?');
    args.push(to);
  }
  return { sql: cond.length ? 'WHERE ' + cond.join(' AND ') : '', args };
}

router.get('/availability', (req, res) => {
  const { sql, args } = rangeWhere(req.query.from, req.query.to);
  const rows = db
    .prepare(
      `SELECT id, date, start_time, end_time
       FROM availability ${sql}
       ORDER BY date, start_time`
    )
    .all(...args);
  res.json(rows);
});

router.post('/availability', (req, res) => {
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
    const info = db
      .prepare(
        `INSERT INTO availability (date, start_time, end_time)
         VALUES (?, ?, ?)`
      )
      .run(date, start, end);
    res.status(201).json({
      id: Number(info.lastInsertRowid),
      date,
      start_time: start,
      end_time: end,
    });
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) {
      return res.status(409).json({ error: 'To okno že obstaja.' });
    }
    console.error('Napaka pri ustvarjanju okna:', err);
    res.status(500).json({ error: 'Prišlo je do napake.' });
  }
});

router.patch('/availability/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Neveljaven ID.' });
  }
  const row = db
    .prepare('SELECT id, date, start_time, end_time FROM availability WHERE id = ?')
    .get(id);
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
    db.prepare(
      `UPDATE availability SET start_time = ?, end_time = ? WHERE id = ?`
    ).run(start, end, id);
    res.json({ ok: true, id, date: row.date, start_time: start, end_time: end });
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) {
      return res.status(409).json({ error: 'To okno že obstaja.' });
    }
    console.error('Napaka pri urejanju okna:', err);
    res.status(500).json({ error: 'Prišlo je do napake.' });
  }
});

router.delete('/availability/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Neveljaven ID.' });
  }
  const row = db.prepare('SELECT id FROM availability WHERE id = ?').get(id);
  if (!row) {
    return res.status(404).json({ error: 'Okno ne obstaja.' });
  }
  db.prepare('DELETE FROM availability WHERE id = ?').run(id);
  res.json({ ok: true });
});

/* ---------- Koledar (razpoložljivost + rezervacije) ---------- */

router.get('/calendar', (req, res) => {
  const { sql, args } = rangeWhere(req.query.from, req.query.to);
  const availability = db
    .prepare(
      `SELECT id, date, start_time, end_time
       FROM availability ${sql}
       ORDER BY date, start_time`
    )
    .all(...args);

  const bSql = sql.replace(/\bdate\b/g, 'b.date');
  const bookings = db
    .prepare(
      `SELECT b.id, b.service_id, srv.name AS service_name,
              b.date, b.start_time, b.end_time,
              b.customer_name, b.customer_phone, b.customer_email,
              b.note, b.created_at
       FROM bookings b
       JOIN services srv ON srv.id = b.service_id
       ${bSql}
       ORDER BY b.date, b.start_time`
    )
    .all(...args);

  res.json({ availability, bookings });
});

/* ---------- Rezervacije ---------- */

router.get('/bookings', (req, res) => {
  const rows = db
    .prepare(
      `SELECT b.id, b.customer_name, b.customer_phone, b.customer_email,
              b.note, b.created_at,
              b.date, b.start_time, b.end_time,
              srv.name AS service_name, srv.price_eur
       FROM bookings b
       JOIN services srv ON srv.id = b.service_id
       ORDER BY b.date DESC, b.start_time`
    )
    .all();
  res.json(rows);
});

module.exports = router;
