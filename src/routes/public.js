'use strict';

const express = require('express');
const { db, addMinutes } = require('../db');
const {
  isValidEmail,
  isValidDate,
  isValidTime,
  cleanStr,
  todayStr,
  toMin,
  fromMin,
} = require('../validate');

const router = express.Router();

// Aktivne storitve (z opisom in sliko).
router.get('/services', (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, name, duration_min, price_eur, description, image
       FROM services
       WHERE active = 1
       ORDER BY name`
    )
    .all();
  res.json(rows);
});

// Trenutni čas (lokalne minute strežnika).
function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Zaporedno razreže razpoložljiva okna na proste termine za izbrano storitev.
 * Vrne urejen seznam po (date, start_time).
 */
function computeSlots(service) {
  const today = todayStr();
  const nowMin = nowMinutes();
  const d = service.duration_min;

  const windows = db
    .prepare(
      `SELECT date, start_time, end_time
       FROM availability
       WHERE date >= ?
       ORDER BY date, start_time`
    )
    .all(today);

  const bookingRows = db
    .prepare(
      `SELECT date, start_time, end_time
       FROM bookings
       WHERE date >= ?`
    )
    .all(today);

  const bookingsByDate = new Map();
  for (const b of bookingRows) {
    if (!bookingsByDate.has(b.date)) bookingsByDate.set(b.date, []);
    bookingsByDate
      .get(b.date)
      .push([toMin(b.start_time), toMin(b.end_time)]);
  }

  const out = [];
  for (const w of windows) {
    const we = toMin(w.end_time);
    const taken = bookingsByDate.get(w.date) || [];
    let start = toMin(w.start_time);
    while (start + d <= we) {
      const candEnd = start + d;
      const overlaps = taken.some(([bs, be]) => bs < candEnd && start < be);
      const inFuture = w.date > today || start >= nowMin;
      if (!overlaps && inFuture) {
        out.push({
          service_id: service.id,
          service_name: service.name,
          price_eur: service.price_eur,
          duration_min: d,
          date: w.date,
          start_time: fromMin(start),
          end_time: fromMin(candEnd),
        });
      }
      start += d;
    }
  }

  out.sort((a, b) =>
    a.date === b.date
      ? a.start_time.localeCompare(b.start_time)
      : a.date.localeCompare(b.date)
  );
  return out;
}

// Prosti termini za izbrano storitev (od danes naprej).
router.get('/slots', (req, res) => {
  const serviceId = Number(req.query.service_id);
  if (!Number.isInteger(serviceId) || serviceId <= 0) {
    return res.status(400).json({ error: 'Izberite storitev.' });
  }
  const service = db
    .prepare('SELECT * FROM services WHERE id = ? AND active = 1')
    .get(serviceId);
  if (!service) {
    return res.status(404).json({ error: 'Storitev ne obstaja.' });
  }
  res.json(computeSlots(service));
});

// Rezervacija termina.
router.post('/bookings', (req, res) => {
  const body = req.body || {};
  const serviceId = Number(body.service_id);
  const date = cleanStr(body.date, 10);
  const startTime = cleanStr(body.start_time, 5);
  const name = cleanStr(body.customer_name, 120);
  const phone = cleanStr(body.customer_phone, 40);
  const email = cleanStr(body.customer_email, 254);
  const note = cleanStr(body.note, 500);

  if (!Number.isInteger(serviceId) || serviceId <= 0) {
    return res.status(400).json({ error: 'Izberite storitev.' });
  }
  if (!isValidDate(date) || !isValidTime(startTime)) {
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
  if (date < today) {
    return res.status(409).json({ error: 'Ta termin je že pretekel.' });
  }

  const service = db
    .prepare('SELECT * FROM services WHERE id = ? AND active = 1')
    .get(serviceId);
  if (!service) {
    return res.status(404).json({ error: 'Storitev ne obstaja.' });
  }

  const d = service.duration_min;
  const candStart = toMin(startTime);
  const endTime = addMinutes(startTime, d);
  const candEnd = candStart + d;

  try {
    db.exec('BEGIN IMMEDIATE');

    // 1) Termin mora ležati znotraj enega razpoložljivega okna.
    const win = db
      .prepare(
        `SELECT start_time, end_time FROM availability
         WHERE date = ? AND start_time <= ? AND end_time >= ?
         ORDER BY start_time LIMIT 1`
      )
      .get(date, startTime, endTime);
    if (!win) {
      db.exec('ROLLBACK');
      return res.status(409).json({ error: 'Ta termin ni več na voljo.' });
    }

    // 2) Začetek mora biti poravnan na zaporedno mrežo okna.
    let s = toMin(win.start_time);
    const we = toMin(win.end_time);
    let aligned = false;
    while (s + d <= we) {
      if (s === candStart) {
        aligned = true;
        break;
      }
      s += d;
    }
    if (!aligned) {
      db.exec('ROLLBACK');
      return res.status(409).json({ error: 'Ta termin ni več na voljo.' });
    }

    // 3) Termin se ne sme prekrivati z obstoječo rezervacijo.
    const clash = db
      .prepare(
        `SELECT 1 FROM bookings
         WHERE date = ? AND start_time < ? AND end_time > ?
         LIMIT 1`
      )
      .get(date, endTime, startTime);
    if (clash) {
      db.exec('ROLLBACK');
      return res
        .status(409)
        .json({ error: 'Ta termin je žal že zaseden.' });
    }

    db.prepare(
      `INSERT INTO bookings
         (service_id, date, start_time, end_time,
          customer_name, customer_phone, customer_email, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(serviceId, date, startTime, endTime, name, phone, email, note || null);

    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('Napaka pri rezervaciji:', err);
    return res.status(500).json({ error: 'Prišlo je do napake. Poskusite znova.' });
  }

  res.status(201).json({ ok: true, message: 'Rezervacija je potrjena.' });
});

module.exports = router;
