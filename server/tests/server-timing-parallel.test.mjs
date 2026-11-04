import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';

// Install a deterministic asynchronous query executor before timing instrumentation loads.
mongoose.Query.prototype.exec = function () { return new Promise((resolve) => setTimeout(resolve, 60)); };
const { serverTiming } = await import('../middleware/server-timing.js');

test('Server-Timing counts parallel queries and reports their overlapping wall time once', async () => {
  let header;
  const response = { getHeader: () => '', setHeader: (_name, value) => { header = value; }, writeHead() {} };
  await new Promise((resolve, reject) => {
    serverTiming()({}, response, () => {
      Promise.all([new mongoose.Query().exec(), new mongoose.Query().exec()]).then(() => { response.writeHead(); resolve(); }, reject);
    });
  });
  const db = Number(header.match(/db;dur=([\d.]+)/)[1]);
  const total = Number(header.match(/total;dur=([\d.]+)/)[1]);
  assert.match(header, /dbq;desc="2"/);
  assert.ok(db <= total, header);
  assert.ok(db < 110, header);
});
