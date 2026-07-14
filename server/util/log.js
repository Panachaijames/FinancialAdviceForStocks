// Tiny leveled logger. The server previously had exactly three console.logs (the
// startup banner), so every provider failure — including a 429 storm — was
// invisible in Render logs. This gives structured, level-filtered output.
//
// Level via LOG_LEVEL env (error < warn < info < debug); default 'info'.

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = LEVELS[String(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

function emit(level, args) {
  if ((LEVELS[level] ?? LEVELS.info) > threshold) return;
  const prefix = `[${new Date().toISOString()}] ${level.toUpperCase()}`;
  // eslint-disable-next-line no-console
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  sink(prefix, ...args);
}

export const log = {
  error: (...args) => emit('error', args),
  warn: (...args) => emit('warn', args),
  info: (...args) => emit('info', args),
  debug: (...args) => emit('debug', args),
};

export default log;
