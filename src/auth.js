'use strict';

const crypto = require('node:crypto');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Marjetka123';
const SESSION_TTL_MS =
  (Number(process.env.SESSION_TTL_HOURS) || 12) * 60 * 60 * 1000;

if (ADMIN_PASSWORD === 'Marjetka123') {
  console.warn(
    '[OPOZORILO] Uporabljeno privzeto admin geslo "Marjetka123". ' +
      'Nastavi ADMIN_PASSWORD v .env za produkcijo.'
  );
}

// Seja je brez stanja (strežnik na Vercelu nima skupnega pomnilnika):
// žeton = "<potek v ms>.<HMAC>". Ključ izhaja iz gesla, zato sprememba
// gesla razveljavi vse žetone.
const SESSION_KEY = crypto
  .createHash('sha256')
  .update('booking-session:' + ADMIN_PASSWORD)
  .digest();

function sign(expiry) {
  return crypto
    .createHmac('sha256', SESSION_KEY)
    .update(String(expiry))
    .digest('base64url');
}

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function verifyPassword(password) {
  return timingSafeEqual(password || '', ADMIN_PASSWORD);
}

function createSession() {
  const expiry = Date.now() + SESSION_TTL_MS;
  return `${expiry}.${sign(expiry)}`;
}

function isValidToken(token) {
  if (typeof token !== 'string') return false;
  const [expiry, mac, ...rest] = token.split('.');
  if (!expiry || !mac || rest.length > 0 || !/^\d+$/.test(expiry)) return false;
  if (!timingSafeEqual(mac, sign(expiry))) return false;
  return Date.now() <= Number(expiry);
}

function requireAdmin(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!isValidToken(token)) {
    return res.status(401).json({ error: 'Neavtoriziran dostop.' });
  }
  next();
}

module.exports = { verifyPassword, createSession, requireAdmin };
