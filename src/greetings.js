import { allGroups } from './store.js';
import { sleep } from './utils.js';

const TZ = process.env.TIMEZONE || 'Asia/Jakarta';

const SLOTS = {
  '06:00': ['🌅 Selamat pagi semuanya! Semoga harimu lancar dan menyenangkan.', '☀️ Pagi! Jangan lupa sarapan dan semangat beraktivitas.'],
  '21:00': ['🌙 Selamat malam semuanya! Jangan begadang terlalu larut ya.', '😴 Malam! Waktunya istirahat, sampai ketemu besok.'],
};

/** "2026-10-18" dan "06:00" menurut zona waktu bot. */
export function localParts(date = new Date(), tz = TZ) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
}

const sentSlots = new Set();
let timer = null;
let busy = false;

export function startGreetings(sock, log = console.log) {
  if (timer) clearInterval(timer);
  const tick = async () => {
    if (busy) return;
    const { day, time } = localParts();
    const lines = SLOTS[time];
    const key = `${day} ${time}`;
    if (!lines || sentSlots.has(key)) return;
    sentSlots.add(key);
    if (sentSlots.size > 20) sentSlots.delete(sentSlots.values().next().value);
    busy = true;
    try {
      for (const [jid, g] of allGroups()) {
        if (!g.sapa) continue;
        try {
          await sock.sendMessage(jid, { text: lines[Math.floor(Math.random() * lines.length)] });
        } catch (e) {
          log('[sapa] gagal kirim ke', jid, e.message);
        }
        await sleep(3000); // jeda antar grup supaya tidak terlihat seperti spam
      }
    } finally {
      busy = false;
    }
  };
  timer = setInterval(tick, 20_000);
  timer.unref?.();
}
