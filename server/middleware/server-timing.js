import { AsyncLocalStorage } from 'node:async_hooks';
import mongoose from 'mongoose';

const requestTiming = new AsyncLocalStorage();
const instrumentation = Symbol.for('task-manager.mongoose-timing-installed');

function instrumentExec(prototype) {
  if (!prototype || prototype[instrumentation]) return;
  const originalExec = prototype.exec;
  Object.defineProperty(prototype, instrumentation, { value: true });
  prototype.exec = function timedExec(...args) {
    const timing = requestTiming.getStore();
    if (!timing) return originalExec.apply(this, args);
    timing.count += 1;
    if (timing.active++ === 0) timing.dbStarted = performance.now();
    const finish = () => { if (--timing.active === 0) timing.db += performance.now() - timing.dbStarted; };
    try {
      const result = originalExec.apply(this, args);
      if (result && typeof result.finally === 'function') {
        return result.finally(() => { finish(); });
      }
      finish();
      return result;
    } catch (error) {
      finish();
      throw error;
    }
  };
}

instrumentExec(mongoose.Query.prototype);
instrumentExec(mongoose.Aggregate.prototype);

export function serverTiming() {
  return (_request, response, next) => {
    const timing = { started: performance.now(), db: 0, active: 0, count: 0, dbStarted: 0 };
    const writeHead = response.writeHead;
    response.writeHead = function writeHeadWithTiming(...args) {
      const existing = String(response.getHeader('Server-Timing') || '');
      const extraMetrics = existing.split(',').map((item) => item.trim()).filter((item) => item && !/^(db|dbq|total);/.test(item));
      const metrics = [`db;dur=${(timing.db + (timing.active ? performance.now() - timing.dbStarted : 0)).toFixed(1)}`, `dbq;desc="${timing.count}"`, ...extraMetrics, `total;dur=${(performance.now() - timing.started).toFixed(1)}`];
      response.setHeader('Server-Timing', metrics.join(', '));
      return writeHead.apply(this, args);
    };
    requestTiming.run(timing, next);
  };
}
