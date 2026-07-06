// Tiny persistent key-value store backed by Upstash Redis (REST API).
//
// Used for cross-device portfolio sync. Upstash's REST endpoint takes a command
// as a JSON array and needs no TCP connection or extra npm dependency — ideal
// for Render's free tier. If the two env vars are absent, sync is simply
// disabled (endpoints report `sync_not_configured`), so the app runs fine
// without it. Free Upstash DB → copy REST URL + token into Render:
//   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
import { config } from '../config.js';

export function isConfigured() {
  return !!(config.keys.upstashUrl && config.keys.upstashToken);
}

async function command(cmd) {
  const res = await fetch(config.keys.upstashUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.keys.upstashToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cmd),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new Error(`kv error: ${json.error || res.status}`);
  }
  return json.result;
}

/** Get a string value (or null if the key is absent). */
export async function kvGet(key) {
  return command(['GET', key]);
}

/** Set a string value, optionally with a TTL (seconds). */
export async function kvSet(key, value, ttlSeconds) {
  const cmd = ttlSeconds ? ['SET', key, value, 'EX', String(ttlSeconds)] : ['SET', key, value];
  return command(cmd);
}

/** Delete a key. */
export async function kvDel(key) {
  return command(['DEL', key]);
}
