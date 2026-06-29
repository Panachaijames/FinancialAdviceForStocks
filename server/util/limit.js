/**
 * Async concurrency limiter.
 *
 * `run(fn)` resolves with `fn()`'s result but guarantees at most `max` `fn`s run
 * at once; the rest queue and start as slots free up. Used to stop a request
 * burst — e.g. opening the app with many holdings, which fans out into one
 * quote + candles + dividend fetch per card all at once — from flooding an
 * upstream API (Yahoo / Twelve Data) and tripping its per-IP rate limit, which
 * is what made prices/charts fail to load on reopen.
 *
 * @param {number} max  maximum concurrent in-flight calls
 * @returns {<T>(fn:()=>Promise<T>)=>Promise<T>}
 */
export function createLimiter(max = 3) {
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : 1;
  let active = 0;
  const queue = [];

  const pump = () => {
    if (active >= limit) return;
    const job = queue.shift();
    if (!job) return;
    active += 1;
    Promise.resolve()
      .then(job.fn)
      .then(job.resolve, job.reject)
      .finally(() => {
        active -= 1;
        pump();
      });
  };

  return function run(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      pump();
    });
  };
}

export default createLimiter;
