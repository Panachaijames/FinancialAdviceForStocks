// Server-side asset-type helpers. The implementation now lives in the `shared`
// workspace (shared/assetType.js) so the client and server can never drift.
// Re-exported here so existing `../util/assetType.js` imports keep working.
export * from 'shared/assetType.js';
export { default } from 'shared/assetType.js';
