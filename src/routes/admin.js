'use strict';

const express = require('express');
const { db, addMinutes } = require('../db');
const { verifyPassword, createSession, requireAdmin } = require('../auth');
const { isValidDate, isValidTime, cleanStr } = require('../validate');

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

router.get('/services', (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, name, duration_min, price_eur, active
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

  if (name.length < 2) {
    return res.status(400).json({ error: 'Vnesite ime storitve.' });
  }
  if (!Number.isInteger(duration) || duration <= 0 || duration > 600) {
    return res.status(400).json({ error: 'Trajanje mora biti med 1 in 600 minut.' });
  }
  if (!Number.isFinite(price) || price < 0 || price > 100000) {
    return res.status(400).json({ error: 'Neveljavna cena.' });
  }

  const info = db
    .prepare(
      `INSERT INTO services (name, duration_min, price_eur)
       VALUES (?, ?, ?)`
    )
    .run(name, duration, Math.round(price * 100) / 100);

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

  db.prepare(
    `UPDATE services
     SET name = ?, duration_min = ?, price_eur = ?, active = ?
     WHERE id = ?`
  ).run(name, duration, Math.round(price * 100) / 100, active, id);

  res.json({ ok: true });
});

router.delete('/services/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Neveljaven ID.' });
  }
  const used = db
    .prepare('SELECT COUNT(*) AS c FROM slots WHERE service_id = ?')
    .get(id).c;

  if (used > 0) {
    // Storitev ima termine — je ne brišemo, le deaktiviramo.
    db.prepare('UPDATE services SET active = 0 WHERE id = ?').run(id);
    return res.json({ ok: true, deactivated: true });
  }
  db.prepare('DELETE FROM services WHERE id = ?').run(id);
  res.json({ ok: true, deleted: true });
});

/* ---------- Termini ---------- */

router.get('/slots', (req, res) => {
  const rows = db
    .prepare(
      `SELECT s.id, s.date, s.start_time, s.end_time, s.status,
              srv.name AS service_name, srv.price_eur, srv.duration_min,
              b.customer_name, b.customer_phone, b.customer_email, b.note
       FROM slots s
       JOIN services srv ON srv.id = s.service_id
       LEFT JOIN bookings b ON b.slot_id = s.id
       ORDER BY s.date DESC, s.start_time`
    )
    .all();
  res.json(rows);
});

// Odpre enega ali več prostih terminov za isti datum in storitev.
router.post('/slots', (req, res) => {
  const body = req.body || {};
  const serviceId = Number(body.service_id);
  const date = cleanStr(body.date, 10);
  let times = body.times;
  if (typeof times === 'string') times = [times];
  if (!Array.isArray(times)) times = [];
  times = [...new Set(times.map((t) => cleanStr(t, 5)))];

  if (!Number.isInteger(serviceId) || serviceId <= 0) {
    return res.status(400).json({ error: 'Izberite storitev.' });
  }
  const service = db
    .prepare('SELECT * FROM services WHERE id = ?')
    .get(serviceId);
  if (!service) {
    return res.status(404).json({ error: 'Storitev ne obstaja.' });
  }
  if (!isValidDate(date)) {
    return res.status(400).json({ error: 'Neveljaven datum.' });
  }
  if (times.length === 0 || !times.every(isValidTime)) {
    return res
      .status(400)
      .json({ error: 'Vnesite vsaj eno veljavno uro (HH:MM).' });
  }

  const insert = db.prepare(
    `INSERT INTO slots (service_id, date, start_time, end_time)
     VALUES (?, ?, ?, ?)`
  );

  let created = 0;
  let skipped = 0;
  for (const t of times) {
    const end = addMinutes(t, service.duration_min);
    try {
      insert.run(serviceId, date, t, end);
      created += 1;
    } catch (err) {
      if (String(err.message || '').includes('UNIQUE')) {
        skipped += 1; // termin za to storitev/datum/uro že obstaja
      } else {
        throw err;
      }
    }
  }

  res.status(201).json({ created, skipped });
});

router.delete('/slots/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Neveljaven ID.' });
  }
  const slot = db.prepare('SELECT status FROM slots WHERE id = ?').get(id);
  if (!slot) {
    return res.status(404).json({ error: 'Termin ne obstaja.' });
  }
  if (slot.status === 'booked') {
    return res
      .status(409)
      .json({ error: 'Termin je rezerviran in ga ni mogoče izbrisati.' });
  }
  db.prepare('DELETE FROM slots WHERE id = ?').run(id);
  res.json({ ok: true });
});

/* ---------- Rezervacije ---------- */

router.get('/bookings', (req, res) => {
  const rows = db
    .prepare(
      `SELECT b.id, b.customer_name, b.customer_phone, b.customer_email,
              b.note, b.created_at,
              s.date, s.start_time, s.end_time,
              srv.name AS service_name, srv.price_eur
       FROM bookings b
       JOIN slots s ON s.id = b.slot_id
       JOIN services srv ON srv.id = s.service_id
       ORDER BY s.date DESC, s.start_time`
    )
    .all();
  res.json(rows);
});

module.exports = router;
