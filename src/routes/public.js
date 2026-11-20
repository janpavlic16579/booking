'use strict';

const express = require('express');
const { query, transaction, addMinutes } = require('../db');
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
router.get('/services', async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, duration_min, price_eur, description, image
     FROM services
     WHERE active = 1
     ORDER BY name`
  );
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
async function computeSlots(service) {
  const today = todayStr();
  const nowMin = nowMinutes();
  const d = service.duration_min;

  const { rows: windows } = await query(
    `SELECT date, start_time, end_time
     FROM availability
     WHERE date >= $1
     ORDER BY date, start_time`,
    [today]
  );

  const { rows: bookingRows } = await query(
    `SELECT date, start_time, end_time
     FROM bookings
     WHERE date >= $1`,
    [today]
  );

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
router.get('/slots', async (req, res) => {
  const serviceId = Number(req.query.service_id);
  if (!Number.isInteger(serviceId) || serviceId <= 0) {
    return res.status(400).json({ error: 'Izberite storitev.' });
  }
  const {
    rows: [service],
  } = await query('SELECT * FROM services WHERE id = $1 AND active = 1', [serviceId]);
  if (!service) {
    return res.status(404).json({ error: 'Storitev ne obstaja.' });
  }
  res.json(await computeSlots(service));
});

// Rezervacija termina.
router.post('/bookings', async (req, res) => {
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

  const {
    rows: [service],
  } = await query('SELECT * FROM services WHERE id = $1 AND active = 1', [serviceId]);
  if (!service) {
    return res.status(404).json({ error: 'Storitev ne obstaja.' });
  }

  const d = service.duration_min;
  const candStart = toMin(startTime);
  const endTime = addMinutes(startTime, d);

  const conflict = await transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('booking:' || $1::text))", [date]);

    // 1) Termin mora ležati znotraj enega razpoložljivega okna.
    const {
      rows: [win],
    } = await tx.query(
      `SELECT start_time, end_time FROM availability
       WHERE date = $1 AND start_time <= $2 AND end_time >= $3
       ORDER BY start_time LIMIT 1`,
      [date, startTime, endTime]
    );
    if (!win) return 'Ta termin ni več na voljo.';

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
    if (!aligned) return 'Ta termin ni več na voljo.';

    // 3) Termin se ne sme prekrivati z obstoječo rezervacijo.
    const clash = await tx.query(
      `SELECT 1 FROM bookings
       WHERE date = $1 AND start_time < $2 AND end_time > $3
       LIMIT 1`,
      [date, endTime, startTime]
    );
    if (clash.rowCount > 0) return 'Ta termin je žal že zaseden.';

    await tx.query(
      `INSERT INTO bookings
         (service_id, date, start_time, end_time,
          customer_name, customer_phone, customer_email, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [serviceId, date, startTime, endTime, name, phone, email, note || null]
    );
    return null;
  });
  if (conflict) return res.status(409).json({ error: conflict });

  res.status(201).json({ ok: true, message: 'Rezervacija je potrjena.' });
});

module.exports = router;
