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
    const started = performance.now();
    try {
      const result = originalExec.apply(this, args);
      if (result && typeof result.finally === 'function') {
        return result.finally(() => { timing.db += performance.now() - started; });
      }
      timing.db += performance.now() - started;
      return result;
    } catch (error) {
      timing.db += performance.now() - started;
      throw error;
    }
  };
}

instrumentExec(mongoose.Query.prototype);
instrumentExec(mongoose.Aggregate.prototype);

export function serverTiming() {
  return (_request, response, next) => {
    const timing = { started: performance.now(), db: 0 };
    const writeHead = response.writeHead;
    response.writeHead = function writeHeadWithTiming(...args) {
      const existing = String(response.getHeader('Server-Timing') || '');
      const extraMetrics = existing.split(',').map((item) => item.trim()).filter((item) => item && !/^(db|total);/.test(item));
      const metrics = [`db;dur=${timing.db.toFixed(1)}`, ...extraMetrics, `total;dur=${(performance.now() - timing.started).toFixed(1)}`];
      response.setHeader('Server-Timing', metrics.join(', '));
      return writeHead.apply(this, args);
    };
    requestTiming.run(timing, next);
  };
}
