'use strict';

const path = require('node:path');

// Lokalno naloži .env; na Vercelu ga ni in veljajo spremenljivke projekta.
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const express = require('express');

const { ready } = require('./src/db');
const publicRoutes = require('./src/routes/public');
const adminRoutes = require('./src/routes/admin');

const app = express();
const PORT = process.env.PORT === undefined ? 3000 : Number(process.env.PORT);

app.use(express.json({ limit: '64kb' }));

app.use('/api', (req, res, next) => ready().then(() => next(), next));
app.use('/api', publicRoutes);
app.use('/api/admin', adminRoutes);

app.get('/health', (req, res) => res.json({ ok: true }));

// Statične datoteke (lokalni razvoj; na Vercelu jih streže CDN).
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

app.get('/admin', (req, res) => {
  res.sendFile('admin.html', { root: publicDir });
});

// JSON 404 za neznane API poti.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Ni najdeno.' });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: 'Neveljavna zahteva.' });
  }
  console.error('Napaka strežnika:', err);
  res.status(500).json({ error: 'Prišlo je do napake. Poskusite znova.' });
});

if (require.main === module) {
  const server = app.listen(PORT, () => {
    const port = server.address().port;
    console.log(`Booking strežnik teče na http://localhost:${port}`);
    console.log(`  Stranke:  http://localhost:${port}/`);
    console.log(`  Admin:    http://localhost:${port}/admin`);
  });
}

module.exports = app;
