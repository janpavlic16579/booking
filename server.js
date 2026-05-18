'use strict';

const path = require('node:path');
const express = require('express');

const publicRoutes = require('./src/routes/public');
const adminRoutes = require('./src/routes/admin');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// CORS — dovoli statičnemu frontendu (GitHub Pages / lastna domena) klice na API.
// ALLOWED_ORIGINS: vejica-ločen seznam; "*" ali prazno = dovoli vse.
// Avtentikacija je žeton v Authorization glavi (brez piškotkov), zato je
// "*" varen — admin poti še vedno zahtevajo veljaven žeton.
const RAW_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').trim();
const ALLOW_ALL = RAW_ORIGINS === '' || RAW_ORIGINS === '*';
const ALLOWED_ORIGINS = ALLOW_ALL
  ? null
  : new Set(
      RAW_ORIGINS.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    );

app.use((req, res, next) => {
  const origin = req.get('origin');
  if (ALLOW_ALL) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    if (origin) res.setHeader('Vary', 'Origin');
  } else if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.use(express.json({ limit: '64kb' }));

app.use('/api', publicRoutes);
app.use('/api/admin', adminRoutes);

app.get('/health', (req, res) => res.json({ ok: true }));

// Statične datoteke (frontend).
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

app.get('/admin', (req, res) => {
  res.sendFile(path.join(publicDir, 'admin.html'));
});

// JSON 404 za neznane API poti.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Ni najdeno.' });
});

const server = app.listen(PORT, () => {
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : PORT;
  console.log(`Booking strežnik teče na http://localhost:${port}`);
  console.log(`  Stranke:  http://localhost:${port}/`);
  console.log(`  Admin:    http://localhost:${port}/admin`);
});

module.exports = { app, server };
