'use strict';

const express = require('express');
const { db } = require('../db');
const { isValidEmail, cleanStr, todayStr } = require('../validate');

const router = express.Router();

// Aktivne storitve.
router.get('/services', (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, name, duration_min, price_eur
       FROM services
       WHERE active = 1
       ORDER BY name`
    )
    .all();
  res.json(rows);
});

// Prosti termini (od danes naprej), z opisom storitve.
router.get('/slots', (req, res) => {
  const today = todayStr();
  const rows = db
    .prepare(
      `SELECT s.id, s.date, s.start_time, s.end_time,
              srv.id AS service_id, srv.name AS service_name,
              srv.duration_min, srv.price_eur
       FROM slots s
       JOIN services srv ON srv.id = s.service_id
       WHERE s.status = 'free' AND s.date >= ?
       ORDER BY s.date, s.start_time`
    )
    .all(today);
  res.json(rows);
});

// Rezervacija termina.
router.post('/bookings', (req, res) => {
  const body = req.body || {};
  const slotId = Number(body.slot_id);
  const name = cleanStr(body.customer_name, 120);
  const phone = cleanStr(body.customer_phone, 40);
  const email = cleanStr(body.customer_email, 254);
  const note = cleanStr(body.note, 500);

  if (!Number.isInteger(slotId) || slotId <= 0) {
    return res.status(400).json({ error: 'Neveljaven termin.' });
  }
  if (name.length < 2) {
    return res.status(400).json({ error: 'Vnesite ime in priimek.' });
  }
  if (phone.length < 5) {
    return res.status(400).json({ error: 'Vnesite veljavno telefonsko številko.' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Vnesite veljaven e-poštni naslov.' });
  }

  const today = todayStr();

  try {
    db.exec('BEGIN IMMEDIATE');

    const slot = db
      .prepare(
        `SELECT id, date, status FROM slots WHERE id = ?`
      )
      .get(slotId);

    if (!slot) {
      db.exec('ROLLBACK');
      return res.status(404).json({ error: 'Termin ne obstaja.' });
    }
    if (slot.status !== 'free') {
      db.exec('ROLLBACK');
      return res.status(409).json({ error: 'Ta termin je žal že zaseden.' });
    }
    if (slot.date < today) {
      db.exec('ROLLBACK');
      return res.status(409).json({ error: 'Ta termin je že pretekel.' });
    }

    db.prepare(
      `INSERT INTO bookings
         (slot_id, customer_name, customer_phone, customer_email, note)
       VALUES (?, ?, ?, ?, ?)`
    ).run(slotId, name, phone, email, note || null);

    db.prepare(`UPDATE slots SET status = 'booked' WHERE id = ?`).run(slotId);

    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    // UNIQUE kršitev na slot_id = tekma za isti termin.
    if (String(err.message || '').includes('UNIQUE')) {
      return res.status(409).json({ error: 'Ta termin je žal že zaseden.' });
    }
    console.error('Napaka pri rezervaciji:', err);
    return res.status(500).json({ error: 'Prišlo je do napake. Poskusite znova.' });
  }

  res.status(201).json({ ok: true, message: 'Rezervacija je potrjena.' });
});

module.exports = router;
