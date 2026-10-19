import fs from 'node:fs/promises';
import * as baileys from '@whiskeysockets/baileys';
import { Server as SocketIOServer } from 'socket.io';
import { attachUno } from './uno/game.js';
import pino from 'pino';
import { attachCompanionRefresh } from './companionRefresh.js';
import { config } from './config.js';
import { handleMessage } from './handler.js';
import { invalidate, peek } from './groupCache.js';
import { loadCommands } from './registry.js';
import { startGreetings } from './greetings.js';
import { startReminders } from './reminders.js';
import { flushStore, getGroup } from './store.js';
import { num } from './utils.js';
import { createWebServer, loginState, setQr } from './web.js';

const makeWASocket = baileys.default?.default ?? baileys.default ?? baileys.makeWASocket;
const { Browsers, DisconnectReason, makeCacheableSignalKeyStore, useMultiFileAuthState } = baileys;

const logger = pino({ level: config.logLevel });
const startedAt = Date.now();
const status = { connected: false, number: null };

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- HTTP: healthcheck di "/" + halaman QR di "/qr?key=<QR_KEY>" ----------
loginState.mode = config.loginMode;
const httpServer = createWebServer({ qrKey: config.qrKey, startedAt, log });
const socketIO = new SocketIOServer(httpServer, { serveClient: true, maxHttpBufferSize: 1e6 });
attachUno(socketIO);
httpServer.listen(config.port, () => log(`HTTP di port ${config.port} (UNO ARENA: /uno/)`));
if (config.loginMode === 'qr') {
  log(
    config.qrKey
      ? 'Mode login QR: buka https://<domain-railway>/qr?key=<QR_KEY> (nilai QR_KEY dari Variables)'
      : 'PERINGATAN: LOGIN_MODE=qr tapi QR_KEY belum diisi, halaman /qr mati. Isi QR_KEY di Variables.',
  );
}

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
  // Versi WA Web: coba sumber WA Web dulu, lalu daftar Baileys, terakhir bawaan library.
  for (const fn of [baileys.fetchLatestWaWebVersion, baileys.fetchLatestBaileysVersion]) {
    if (typeof fn !== 'function') continue;
    try {
      const v = (await fn()).version;
      if (Array.isArray(v) && v.length === 3) {
        opts.version = v;
        break;
      }
    } catch {
      /* coba sumber berikutnya */
    }
  }
  if (!opts.version) log('gagal cek versi WhatsApp terbaru, pakai versi bawaan library');

  const sock = makeWASocket(opts);
  let pairingRequested = false;
  loginState.registered = !!state.creds.registered;

  sock.ev.on('creds.update', saveCreds);
  // Server mencabut adv secret saat pairing: ganti secret dan perbarui QR (lihat companionRefresh.js).
  const { patchQr } = attachCompanionRefresh(sock, { onQr: setQr, log });

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr && !sock.authState.creds.registered) {
      if (config.loginMode === 'code') {
        if (!config.pairingNumber) {
          if (!pairingRequested) {
            pairingRequested = true;
            console.error('[pairing] LOGIN_MODE=code tapi PAIRING_NUMBER kosong. Isi PAIRING_NUMBER atau pakai LOGIN_MODE=qr.');
          }
        } else if (!pairingRequested) {
          pairingRequested = true;
          try {
            const code = await sock.requestPairingCode(config.pairingNumber);
            const pretty = code.match(/.{1,4}/g)?.join('-') || code;
            loginState.pairingCode = pretty;
            log(`\n==============================\n KODE PAIRING: ${pretty}\n==============================\nWhatsApp > Perangkat tertaut > Tautkan perangkat > Tautkan dengan nomor telepon`);
          } catch (e) {
            pairingRequested = false;
            console.error('[pairing] gagal minta kode:', e.message);
          }
        }
      } else {
        setQr(patchQr(qr));
      }
    }

    if (connection === 'open') {
      status.connected = true;
      attempts = 0;
      status.number = num(sock.user?.id);
      Object.assign(loginState, { connected: true, number: status.number, registered: true });
      setQr(null);
      log(`✅ Terhubung sebagai ${status.number}`);
      startReminders(sock, log);
      startGreetings(sock, log);
    }

    if (connection === 'close') {
      status.connected = false;
      loginState.connected = false;
      setQr(null);
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
      const botIds = new Set([sock.user?.id, sock.user?.lid].filter(Boolean).map(num));
      const allIds = participants.flatMap((p) => (typeof p === 'string' ? [p] : [p.id, p.lid, p.phoneNumber, p.jid])).filter(Boolean).map(num);
      if (allIds.some((i) => botIds.has(i))) return;
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
