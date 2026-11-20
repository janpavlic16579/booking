'use strict';

const path = require('node:path');
const fs = require('node:fs');

const SCHEMA_LOCK = 7284551;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS services (
    id           serial PRIMARY KEY,
    name         text             NOT NULL,
    duration_min integer          NOT NULL,
    price_eur    double precision NOT NULL,
    description  text             NOT NULL DEFAULT '',
    image        text             NOT NULL DEFAULT '',
    active       integer          NOT NULL DEFAULT 1,
    created_at   text             NOT NULL DEFAULT to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS')
  )`,
  `CREATE TABLE IF NOT EXISTS availability (
    id         serial PRIMARY KEY,
    date       text NOT NULL,
    start_time text NOT NULL,
    end_time   text NOT NULL,
    created_at text NOT NULL DEFAULT to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
    UNIQUE (date, start_time, end_time)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_avail_date ON availability(date)`,
  `CREATE TABLE IF NOT EXISTS bookings (
    id             serial PRIMARY KEY,
    service_id     integer NOT NULL REFERENCES services(id),
    date           text    NOT NULL,
    start_time     text    NOT NULL,
    end_time       text    NOT NULL,
    customer_name  text    NOT NULL,
    customer_phone text    NOT NULL,
    customer_email text    NOT NULL,
    note           text,
    created_at     text    NOT NULL DEFAULT to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS')
  )`,
  `CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date)`,
];

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

const SERVICE_DEFAULTS = [
  ['BIAB', 90, 30],
  ['Francoska manikura / Baby boomer', 90, 30],
  ['BIAB + barva', 90, 30],
  ['Nega naravnih nohtov', 30, 30],
  ['Nega naravnih nohtov z lakiranjem', 60, 30],
  ['Podaljševanje nohtov', 120, 30],
  ['Urejanje nohtov na nogah / lakiranje', 120, 30],
  ['BIAB + poslikava / dizajn', 105, 30],
];

function createBackend() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      idleTimeoutMillis: 10000,
    });
    return {
      query: (text, params) => pool.query(text, params),
      async transaction(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn({ query: (t, p) => client.query(t, p) });
          await client.query('COMMIT');
          return result;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      },
    };
  }

  const { PGlite } = require('@electric-sql/pglite');
  const dir = process.env.PGLITE_DIR || path.join(__dirname, '..', 'data', 'pglite');
  if (!dir.startsWith('memory://')) fs.mkdirSync(dir, { recursive: true });
  const lite = new PGlite(dir);
  const shape = (r) => ({ rows: r.rows, rowCount: r.affectedRows ?? r.rows.length });
  return {
    async query(text, params) {
      return shape(await lite.query(text, params));
    },
    transaction: (fn) =>
      lite.transaction((t) =>
        fn({ query: async (text, params) => shape(await t.query(text, params)) })
      ),
  };
}

const { query, transaction } = createBackend();

async function init() {
  await transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [SCHEMA_LOCK]);
    for (const ddl of SCHEMA) await tx.query(ddl);

    const { rows } = await tx.query('SELECT COUNT(*)::int AS c FROM services');
    if (rows[0].c !== 0) return;
    for (const [name, dur, price] of SERVICE_DEFAULTS) {
      const extra = SERVICE_SEED[name];
      await tx.query(
        `INSERT INTO services (name, duration_min, price_eur, description, image)
         VALUES ($1, $2, $3, $4, $5)`,
        [name, dur, price, extra.description, extra.image]
      );
    }
  });
}

const ready = init();
ready.catch(() => {});

/** Doda trajanje (minute) uri "HH:MM" in vrne "HH:MM" (omejeno na isti dan). */
function addMinutes(hhmm, minutes) {
  const [h, m] = hhmm.split(':').map(Number);
  let total = h * 60 + m + minutes;
  if (total >= 24 * 60) total = 24 * 60 - 1;
  const nh = Math.floor(total / 60);
  const nm = total % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}

module.exports = { query, transaction, ready, addMinutes };
