// Alert evaluation now lives in the `shared` workspace (shared/alerts.js) so the
// client's in-app watcher and the server's closed-app watcher share one copy and
// can never disagree. Import sites (evaluateAlert / describeAlert) are unchanged.
export * from 'shared/alerts.js';
export { default } from 'shared/alerts.js';
