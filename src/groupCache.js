// Cache metadata grup supaya tidak kena rate-limit WhatsApp dan perintah admin cepat.
const TTL = 60_000;
const cache = new Map();

export function peek(jid) {
  const hit = cache.get(jid);
  return hit && Date.now() - hit.ts < TTL ? hit.meta : undefined;
}

export async function getMeta(sock, jid) {
  const hit = peek(jid);
  if (hit) return hit;
  const meta = await sock.groupMetadata(jid);
  cache.set(jid, { meta, ts: Date.now() });
  return meta;
}

export function invalidate(jid) {
  cache.delete(jid);
}
