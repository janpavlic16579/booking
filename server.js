'use strict';

const path = require('node:path');
const express = require('express');

const publicRoutes = require('./src/routes/public');
const adminRoutes = require('./src/routes/admin');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

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
