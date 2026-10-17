import fs from 'node:fs/promises';
import http from 'node:http';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { config } from './config.js';
import { handleMessage } from './handler.js';
import { invalidate, peek } from './groupCache.js';
import { loadCommands } from './registry.js';
import { flushStore, getGroup } from './store.js';
import { num } from './utils.js';

const logger = pino({ level: config.logLevel });
const startedAt = Date.now();
const status = { connected: false, number: null };

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- HTTP kecil untuk healthcheck (Railway) ----------
http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, connected: status.connected, uptime: Math.floor((Date.now() - startedAt) / 1000) }));
  })
  .listen(config.port, () => log(`healthcheck di port ${config.port}`));

let reconnectTimer = null;
let attempts = 0; // untuk backoff: 3d, 6d, 12d, ... maks 30d
function scheduleReconnect(ms) {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    start().catch((e) => {
      console.error('[start] gagal:', e);
      scheduleReconnect(5000);
    });
  }, ms);
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(config.sessionDir);

  const opts = {
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    logger,
    browser: Browsers.ubuntu('Chrome'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    cachedGroupMetadata: async (jid) => peek(jid),
    getMessage: async () => undefined,
  };
  try {
    opts.version = (await fetchLatestBaileysVersion()).version;
  } catch {
    log('gagal cek versi WhatsApp terbaru, pakai versi bawaan library');
  }

  const sock = makeWASocket(opts);
  let pairingRequested = false;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr) {
      if (config.pairingNumber && !sock.authState.creds.registered) {
        if (!pairingRequested) {
          pairingRequested = true;
          try {
            const code = await sock.requestPairingCode(config.pairingNumber);
            const pretty = code.match(/.{1,4}/g)?.join('-') || code;
            log(`\n==============================\n KODE PAIRING: ${pretty}\n==============================\nWhatsApp > Perangkat tertaut > Tautkan perangkat > Tautkan dengan nomor telepon`);
          } catch (e) {
            pairingRequested = false;
            console.error('[pairing] gagal minta kode:', e.message);
          }
        }
      } else if (!config.pairingNumber) {
        log('Scan QR berikut dari WhatsApp > Perangkat tertaut:');
        qrcode.generate(qr, { small: true });
      }
    }

    if (connection === 'open') {
      status.connected = true;
      attempts = 0;
      status.number = num(sock.user?.id);
      log(`✅ Terhubung sebagai ${status.number}`);
    }

    if (connection === 'close') {
      status.connected = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      log(`koneksi tertutup (kode ${code ?? 'tidak diketahui'})`);

      if (code === DisconnectReason.loggedOut) {
        log('Sesi di-logout dari HP. Menghapus sesi lama, siap pairing ulang...');
        await fs.rm(config.sessionDir, { recursive: true, force: true });
        scheduleReconnect(3000);
      } else if (code === DisconnectReason.connectionReplaced) {
        log('Sesi dipakai di tempat lain (connection replaced). Bot berhenti supaya tidak berebut sesi.');
        flushStore();
        process.exit(0);
      } else {
        const wait = code === DisconnectReason.restartRequired ? 0 : Math.min(3000 * 2 ** attempts++, 30_000);
        scheduleReconnect(wait);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      const ts = Number(msg.messageTimestamp) || 0;
      if (ts && Date.now() / 1000 - ts > 60) continue; // abaikan pesan lama saat reconnect
      try {
        await handleMessage(sock, msg);
      } catch (e) {
        console.error('[messages.upsert]', e);
      }
    }
  });

  sock.ev.on('groups.update', (updates) => updates.forEach((g) => g.id && invalidate(g.id)));

  sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
    invalidate(id);
    try {
      if (!['add', 'remove'].includes(action) || !getGroup(id).welcome) return;
      const meta = await sock.groupMetadata(id);
      const jids = participants.map((p) => (typeof p === 'string' ? p : p.id)).filter(Boolean);
      if (jids.some((j) => num(j) === num(sock.user?.id))) return;
      const tags = jids.map((j) => `@${num(j)}`).join(' ');
      const text =
        action === 'add'
          ? `👋 Selamat datang ${tags} di *${meta.subject}*!\nBaca deskripsi grup ya.`
          : `👋 ${tags} telah keluar dari grup. Sampai jumpa!`;
      await sock.sendMessage(id, { text, mentions: jids });
    } catch (e) {
      console.error('[welcome]', e.message);
    }
  });
}

async function main() {
  const n = await loadCommands();
  log(`${config.botName}: ${n} command dimuat, prefix "${config.prefix}"`);
  if (!config.owners.length) log('PERINGATAN: OWNER_NUMBERS belum diisi, perintah owner hanya bisa dari nomor bot sendiri.');
  await start();
}

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    flushStore();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error('Gagal start:', e);
  process.exit(1);
});
