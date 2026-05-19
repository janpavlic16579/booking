'use strict';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HTTP_URL_RE = /^https?:\/\/[^\s]+$/;

function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00');
  return !Number.isNaN(d.getTime()) && s === d.toISOString().slice(0, 10);
}

function isValidTime(s) {
  return typeof s === 'string' && TIME_RE.test(s);
}

function isValidEmail(s) {
  return typeof s === 'string' && s.length <= 254 && EMAIL_RE.test(s);
}

/** Vrne "YYYY-MM-DD" za danes po lokalnem času strežnika. */
function todayStr() {
  const now = new Date();
  const tz = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - tz).toISOString().slice(0, 10);
}

function cleanStr(v, max = 200) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

/** Absolutni http(s) URL (do 500 znakov). Prazen niz NI veljaven tu. */
function isValidHttpUrl(s) {
  return typeof s === 'string' && s.length <= 500 && HTTP_URL_RE.test(s);
}

/** "HH:MM" -> minute od polnoči. */
function toMin(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

/** Minute od polnoči -> "HH:MM" (omejeno na isti dan). */
function fromMin(total) {
  let t = Math.max(0, Math.min(24 * 60 - 1, Math.floor(total)));
  const h = Math.floor(t / 60);
  const m = t % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

module.exports = {
  isValidDate,
  isValidTime,
  isValidEmail,
  isValidHttpUrl,
  todayStr,
  cleanStr,
  toMin,
  fromMin,
};
