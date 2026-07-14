// Detects a failed dynamic import — typically a stale content-hashed chunk that
// 404s after a Render redeploy while a client tab is still open. Suspense does
// NOT catch these rejections, so an ErrorBoundary keys off this to offer a
// reload. Browsers and Vite phrase the failure several ways, so match
// defensively. Pure (no imports) so it unit-tests under plain `node --test`.

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isChunkLoadError(err) {
  if (!err) return false;
  const msg = String((err && err.message) || err);
  const name = String((err && err.name) || '');
  return (
    name === 'ChunkLoadError' ||
    /loading (?:css )?chunk [\w-]+ failed/i.test(msg) ||
    /failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /importing a module script failed/i.test(msg)
  );
}

export default isChunkLoadError;
