'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { todayStr } = require('./validate');

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '..', 'data', 'booking.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Ciljna shema (varno tudi na prazni bazi).
db.exec(`
  CREATE TABLE IF NOT EXISTS services (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    duration_min INTEGER NOT NULL,
    price_eur    REAL    NOT NULL,
    description  TEXT    NOT NULL DEFAULT '',
    image        TEXT    NOT NULL DEFAULT '',
    active       INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS availability (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    date       TEXT    NOT NULL,
    start_time TEXT    NOT NULL,
    end_time   TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (date, start_time, end_time)
  );
  CREATE INDEX IF NOT EXISTS idx_avail_date ON availability(date);
`);

function tableExists(name) {
  return !!db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
    )
    .get(name);
}

function columnNames(table) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((r) => r.name);
}

// ---- Idempotentna migracija (teče ob vsakem zagonu) ----
try {
  db.exec('BEGIN');

  // 1) Manjkajoča stolpca na obstoječi (stari) tabeli services.
  const svcCols = columnNames('services');
  if (!svcCols.includes('description')) {
    db.exec(`ALTER TABLE services ADD COLUMN description TEXT NOT NULL DEFAULT ''`);
  }
  if (!svcCols.includes('image')) {
    db.exec(`ALTER TABLE services ADD COLUMN image TEXT NOT NULL DEFAULT ''`);
  }

  // 2) Preoblikovanje bookings (slot_id -> samostojni termin).
  const bookingsCols = tableExists('bookings') ? columnNames('bookings') : null;
  const needsBookingsReshape =
    bookingsCols && bookingsCols.includes('slot_id');

  if (!tableExists('bookings')) {
    db.exec(`
      CREATE TABLE bookings (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        service_id     INTEGER NOT NULL REFERENCES services(id),
        date           TEXT    NOT NULL,
        start_time     TEXT    NOT NULL,
        end_time       TEXT    NOT NULL,
        customer_name  TEXT    NOT NULL,
        customer_phone TEXT    NOT NULL,
        customer_email TEXT    NOT NULL,
        note           TEXT,
        created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
      );
    `);
  } else if (needsBookingsReshape) {
    db.exec(`
      CREATE TABLE bookings_new (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        service_id     INTEGER NOT NULL REFERENCES services(id),
        date           TEXT    NOT NULL,
        start_time     TEXT    NOT NULL,
        end_time       TEXT    NOT NULL,
        customer_name  TEXT    NOT NULL,
        customer_phone TEXT    NOT NULL,
        customer_email TEXT    NOT NULL,
        note           TEXT,
        created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
      );
    `);
    if (tableExists('slots')) {
      db.exec(`
        INSERT INTO bookings_new
          (service_id, date, start_time, end_time,
           customer_name, customer_phone, customer_email, note, created_at)
        SELECT sl.service_id, sl.date, sl.start_time, sl.end_time,
               b.customer_name, b.customer_phone, b.customer_email,
               b.note, b.created_at
        FROM bookings b
        JOIN slots sl ON sl.id = b.slot_id
        JOIN services srv ON srv.id = sl.service_id;
      `);
    }
    db.exec('DROP TABLE bookings;');
    db.exec('ALTER TABLE bookings_new RENAME TO bookings;');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);');

  // 3) Stare proste slote pretvori v razpoložljiva okna.
  if (tableExists('slots')) {
    db.prepare(
      `INSERT OR IGNORE INTO availability (date, start_time, end_time)
       SELECT DISTINCT date, start_time, end_time
       FROM slots
       WHERE status = 'free' AND date >= ?`
    ).run(todayStr());
  }

  // 4) Odstrani staro tabelo slots.
  db.exec('DROP TABLE IF EXISTS slots;');
  db.exec('DROP INDEX IF EXISTS idx_slots_status_date;');

  db.exec('COMMIT');
} catch (err) {
  try {
    db.exec('ROLLBACK');
  } catch {
    /* ignore */
  }
  console.error('Napaka pri migraciji baze:', err);
}

// Privzeti opisi in slike za 8 znanih storitev (vsebina iz services-info.js).
const SERVICE_SEED = {
  BIAB: {
    description:
      'BIAB je odlična izbira za vse, ki želite močnejše in urejene naravne nohte brez podaljševanja. Gel noht utrdi, zaščiti in pomaga pri lepši rasti, končni videz pa ostane zelo naraven in eleganten. Na voljo so nežni mlečni in nude odtenki za minimalističen videz. Storitev vključuje tudi natančno pripravo nohtov in rusko manikuro.\n\nPriporočeno obnavljanje: vsakih 3–4 tedne',
    image: 'img/biab.jpg',
  },
  'Francoska manikura / Baby boomer': {
    description:
      'Brezčasna izbira za urejene in elegantne nohte. Francoska manikura poudari konice nohtov z nežnim in čistim videzom, medtem ko baby boomer ustvari mehak preliv med odtenki za bolj naraven učinek. Storitev je primerna tako za vsakdan kot posebne priložnosti in vključuje precizno rusko manikuro.\n\nPriporočeno obnavljanje: vsakih 3–4 tedne',
    image: 'img/francoska-baby-boomer.png',
  },
  'BIAB + barva': {
    description:
      'Kombinacija BIAB ojačitve in izbrane barve za obstojne, močne in lepo urejene nohte. BIAB pomaga zaščititi naravni noht in preprečuje lomljenje, nanos barve pa poskrbi za poln in sijoč videz. Idealna izbira za vse, ki želite dolgotrajno urejene nohte brez podaljševanja.\n\nPriporočeno obnavljanje: vsakih 3–4 tedne',
    image: 'img/biab-barva.png',
  },
  'Nega naravnih nohtov': {
    description:
      'Storitev je namenjena negi in urejanju naravnih nohtov brez lakiranja. Vključuje oblikovanje nohtov, urejanje obnohtne kožice ter nego za lep in čist videz rok. Primerna za vse, ki prisegate na naraven videz in urejene nohte.\n\nPriporočeno: na 2–3 tedne',
    image: 'img/nega-naravnih.png',
  },
  'Nega naravnih nohtov z lakiranjem': {
    description:
      'Klasična nega nohtov z dodatkom lakiranja v izbranem odtenku. Po urejanju obnohtne kožice in oblikovanju nohtov sledi nanos laka za svež, ženstven in urejen videz. Odlična izbira za vse, ki si želite lepo urejenih nohtov brez trajnih materialov.\n\nObstojnost laka je odvisna od nege in naravnih nohtov',
    image: 'img/nega-naravnih-lak.png',
  },
  'Podaljševanje nohtov': {
    description:
      'Podaljševanje nohtov izvajam z gelom in šablono, brez uporabe umetnih tips. Obliko in dolžino prilagodim vašim željam ter naravni strukturi nohta, zato je končni videz eleganten, urejen in obstojen. Po podaljševanju se lahko odločite za naraven videz z BIAB zaključkom ali pa izberete BIAB + barvo za popolnoma dodelan videz nohtov. Storitev vključuje tudi natančno rusko manikuro in pripravo nohtov.\n\nPriporočeno obnavljanje: vsakih 3–4 tedne',
    image: 'img/podaljsevanje.jpg',
  },
  'Urejanje nohtov na nogah / lakiranje': {
    description:
      'Storitev je namenjena urejanju in lepemu videzu nohtov na nogah. Vključuje krajšanje in oblikovanje nohtov ter nanos izbranega laka ali gela za urejen in obstojen videz. Celovite pedikure z odstranjevanjem trde kože in večjo nego stopal ne izvajam, lahko pa nohtke lepo uredim in poskrbim za estetski končni videz.\n\nPriporočeno obnavljanje: po potrebi oziroma na 3–6 tednov',
    image: 'img/urejanje-nog.png',
  },
  'BIAB + poslikava / dizajn': {
    description:
      'Ojačitev naravnih nohtov z BIAB gelom v kombinaciji z izbrano poslikavo, dizajnom ali dodatki za unikaten in personaliziran videz. BIAB poskrbi za čvrstost in zaščito naravnih nohtov, nail art pa doda piko na i – od minimalističnih detajlov do bolj izrazitih dizajnov. Storitev vključuje tudi natančno rusko manikuro in pripravo nohtov.\n\nPriporočeno obnavljanje: vsakih 3–4 tedne',
    image: 'img/biab-poslikava.png',
  },
};

// Seed privzetih storitev ob prvem zagonu (samo če je tabela prazna).
const serviceCount = db.prepare('SELECT COUNT(*) AS c FROM services').get().c;
if (serviceCount === 0) {
  const insert = db.prepare(
    `INSERT INTO services (name, duration_min, price_eur, description, image)
     VALUES (?, ?, ?, ?, ?)`
  );
  const seed = (name, dur, price) => {
    const extra = SERVICE_SEED[name] || { description: '', image: '' };
    insert.run(name, dur, price, extra.description, extra.image);
  };
  seed('BIAB', 90, 30);
  seed('Francoska manikura / Baby boomer', 90, 30);
  seed('BIAB + barva', 90, 30);
  seed('Nega naravnih nohtov', 30, 30);
  seed('Nega naravnih nohtov z lakiranjem', 60, 30);
  seed('Podaljševanje nohtov', 120, 30);
  seed('Urejanje nohtov na nogah / lakiranje', 120, 30);
  seed('BIAB + poslikava / dizajn', 105, 30);
} else {
  // Obstoječa baza: zapolni le prazne opise/slike (urejanj ne povozi).
  const fill = db.prepare(
    `UPDATE services SET description = ?, image = ?
     WHERE name = ? AND (description = '' OR description IS NULL)`
  );
  for (const [name, v] of Object.entries(SERVICE_SEED)) {
    fill.run(v.description, v.image, name);
  }
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
