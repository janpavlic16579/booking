'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '..', 'data', 'booking.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS services (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    duration_min INTEGER NOT NULL,
    price_eur    REAL    NOT NULL,
    active       INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS slots (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id INTEGER NOT NULL REFERENCES services(id),
    date       TEXT    NOT NULL,
    start_time TEXT    NOT NULL,
    end_time   TEXT    NOT NULL,
    status     TEXT    NOT NULL DEFAULT 'free',
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (service_id, date, start_time)
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    slot_id        INTEGER NOT NULL UNIQUE REFERENCES slots(id),
    customer_name  TEXT    NOT NULL,
    customer_phone TEXT    NOT NULL,
    customer_email TEXT    NOT NULL,
    note           TEXT,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_slots_status_date ON slots(status, date);
`);

// Seed privzetih storitev ob prvem zagonu (samo če je tabela prazna).
const serviceCount = db.prepare('SELECT COUNT(*) AS c FROM services').get().c;
if (serviceCount === 0) {
  const insert = db.prepare(
    'INSERT INTO services (name, duration_min, price_eur) VALUES (?, ?, ?)'
  );
  insert.run('BIAB', 90, 30);
  insert.run('Francoska manikura / Baby boomer', 90, 30);
  insert.run('BIAB + barva', 90, 30);
  insert.run('Nega naravnih nohtov', 30, 30);
  insert.run('Nega naravnih nohtov z lakiranjem', 60, 30);
  insert.run('Podaljševanje nohtov', 120, 30);
  insert.run('Urejanje nohtov na nogah / lakiranje', 120, 30);
  insert.run('BIAB + poslikava / dizajn', 105, 30);
}

/** Doda trajanje (minute) uri "HH:MM" in vrne "HH:MM" (omejeno na isti dan). */
function addMinutes(hhmm, minutes) {
  const [h, m] = hhmm.split(':').map(Number);
  let total = h * 60 + m + minutes;
  if (total >= 24 * 60) total = 24 * 60 - 1;
  const nh = Math.floor(total / 60);
  const nm = total % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}

module.exports = { db, addMinutes, DB_PATH };
