import { AsyncLocalStorage } from 'node:async_hooks';
import mongoose from 'mongoose';

const requestTiming = new AsyncLocalStorage();

const writeContext = new AsyncLocalStorage();

function instrumentMethod(target, method, isWrite = false) {
  if (!target) return;
  const marker = Symbol.for(`task-manager.timing.${method}`);
  if (Object.hasOwn(target, marker)) return;
  const original = target[method];
  Object.defineProperty(target, marker, { value: true });
  target[method] = function timedMethod(...args) {
    const timing = requestTiming.getStore();
    if (!timing || (isWrite && writeContext.getStore())) return original.apply(this, args);
    timing.count += 1;
    if (timing.active++ === 0) timing.dbStarted = performance.now();
    const finish = () => { if (--timing.active === 0) timing.db += performance.now() - timing.dbStarted; };
    try {
      const invoke = () => original.apply(this, args);
      const result = isWrite ? writeContext.run(true, invoke) : invoke();
      if (result && typeof result.finally === 'function') return result.finally(finish);
      finish();
      return result;
    } catch (error) {
      finish();
      throw error;
    }
  };
}

instrumentMethod(mongoose.Query.prototype, 'exec');
instrumentMethod(mongoose.Aggregate.prototype, 'exec');
instrumentMethod(mongoose.Model.prototype, 'save', true);
for (const method of ['insertMany', 'create', 'bulkWrite']) instrumentMethod(mongoose.Model, method, true);

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
