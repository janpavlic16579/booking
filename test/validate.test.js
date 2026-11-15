'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

test('datumi so veljavni neodvisno od časovnega pasu strežnika', () => {
  for (const TZ of ['Europe/Ljubljana', 'UTC', 'America/New_York']) {
    execFileSync(process.execPath, ['-e', `
      const assert = require('node:assert/strict');
      const { isValidDate } = require('./src/validate');
      for (const date of ['2026-11-16', '2026-07-15', '2028-02-29']) {
        assert.equal(isValidDate(date), true, date);
      }
      for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', 'invalid']) {
        assert.equal(isValidDate(date), false, date);
      }
    `], { cwd: require('node:path').join(__dirname, '..'), env: { ...process.env, TZ } });
  }
});
