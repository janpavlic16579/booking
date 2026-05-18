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

// token -> potek (ms epoch). Seja je v pomnilniku; ob restartu se admin znova prijavi.
const sessions = new Map();

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
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function isValidToken(token) {
  if (!token) return false;
  const expiry = sessions.get(token);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    sessions.delete(token);
    return false;
  }
  return true;
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
