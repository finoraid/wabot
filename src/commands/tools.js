import QRCode from 'qrcode';
import { calc } from '../calc.js';
import { formatDuration } from '../reminders.js';
import { UserError } from '../utils.js';

async function getJson(url, what) {
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'WaBot/1.0', Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new UserError(`Layanan ${what} tidak merespons. Coba lagi nanti.`);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    const e = new Error(`${what} HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return data;
}

// Kode cuaca WMO (Open-Meteo) -> teks Indonesia
const WMO = [
  [[0], '☀️ Cerah'], [[1], '🌤️ Cerah berawan'], [[2], '⛅ Berawan'], [[3], '☁️ Mendung'], [[45, 48], '🌫️ Berkabut'],
  [[51, 53, 55, 56, 57], '🌦️ Gerimis'], [[61, 63, 65, 66, 67], '🌧️ Hujan'], [[71, 73, 75, 77, 85, 86], '❄️ Salju'],
  [[80, 81, 82], '🌧️ Hujan lebat sesaat'], [[95, 96, 99], '⛈️ Badai petir'],
];
const wmo = (c) => WMO.find(([codes]) => codes.includes(c))?.[1] || '🌡️ -';

const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const dayName = (iso) => DAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()];

const stopwatches = new Map(); // "jid|pengguna" -> waktu mulai

export default [
  {
    name: 'cuaca',
    aliases: ['weather'],
    usage: '<kota>',
    category: 'Alat',
    desc: 'Cuaca sekarang + 3 hari',
    async run({ text, reply, prefix }) {
      if (!text) throw new UserError(`Contoh: ${prefix}cuaca Bandung`);
      const geo = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(text.slice(0, 60))}&count=1&language=id`, 'cuaca');
      const place = geo.results?.[0];
      if (!place) throw new UserError(`Kota "${text.slice(0, 40)}" tidak ditemukan.`);
      const w = await getJson(
        `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
          '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m' +
          '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=3',
        'cuaca',
      );
      const c = w.current || {};
      const d = w.daily || {};
      const lines = [
        `🌍 *${place.name}${place.admin1 ? `, ${place.admin1}` : ''}*`,
        `${wmo(c.weather_code)}  ${Math.round(c.temperature_2m)}°C (terasa ${Math.round(c.apparent_temperature)}°C)`,
        `💧 Lembap ${c.relative_humidity_2m}%  •  💨 Angin ${Math.round(c.wind_speed_10m)} km/j`,
        '',
        '*3 hari ke depan*',
      ];
      (d.time || []).forEach((t, i) => {
        lines.push(`${dayName(t)} ${t.slice(8)}/${t.slice(5, 7)}: ${wmo(d.weather_code?.[i])}, ${Math.round(d.temperature_2m_min?.[i])}-${Math.round(d.temperature_2m_max?.[i])}°C, hujan ${d.precipitation_probability_max?.[i] ?? '-'}%`);
      });
      lines.push('', '_Data: Open-Meteo.com_');
      await reply(lines.join('\n'));
    },
  },
  {
    name: 'jadwalsholat',
    aliases: ['sholat', 'salat', 'jadwalsalat'],
    usage: '<kota>[, negara]',
    category: 'Alat',
    desc: 'Jadwal sholat hari ini',
    async run({ text, reply, prefix }) {
      if (!text) throw new UserError(`Contoh: ${prefix}jadwalsholat Surabaya\nKota luar negeri: ${prefix}jadwalsholat Makkah, Saudi Arabia`);
      const [city, country = 'Indonesia'] = text.split(',').map((x) => x.trim());
      let data;
      try {
        data = await getJson(`https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city.slice(0, 60))}&country=${encodeURIComponent(country.slice(0, 60))}&method=${country.toLowerCase() === 'indonesia' ? 20 : 3}`, 'jadwal sholat');
      } catch (e) {
        if (e.status === 400 || e.status === 404) throw new UserError(`Kota "${city}" tidak ditemukan.`);
        throw e;
      }
      const t = data.data?.timings;
      if (!t) throw new UserError('Jadwal tidak tersedia untuk kota itu.');
      const row = (n, k) => `│ ${n.padEnd(8)} : *${String(t[k]).slice(0, 5)}*`;
      await reply(
        [
          `🕌 *Jadwal Sholat ${city}*`,
          `${data.data.date?.readable || ''}  •  ${data.data.meta?.timezone || ''}`,
          '╭──────────────',
          row('Imsak', 'Imsak'), row('Subuh', 'Fajr'), row('Terbit', 'Sunrise'), row('Dzuhur', 'Dhuhr'), row('Ashar', 'Asr'), row('Maghrib', 'Maghrib'), row('Isya', 'Isha'),
          '╰──────────────',
          `_Metode: ${data.data.meta?.method?.name || '-'} (Aladhan)_`,
        ].join('\n'),
      );
    },
  },
  {
    name: 'kurs',
    aliases: ['convert', 'kurskan'],
    usage: '[jumlah] <dari> [ke]',
    category: 'Alat',
    desc: 'Kurs mata uang (default ke IDR)',
    async run({ args, reply, prefix }) {
      const a = args.map((x) => x.toLowerCase());
      let amount = 1;
      if (a.length && /^[\d.,]+$/.test(a[0])) amount = Number(a.shift().replace(/\./g, '').replace(',', '.'));
      const from = (a[0] || '').toUpperCase();
      const to = (a[1] === 'ke' ? a[2] : a[1] || 'idr').toUpperCase();
      if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to) || !(amount > 0)) throw new UserError(`Contoh: ${prefix}kurs 100 usd idr\n${prefix}kurs usd (ke rupiah)`);
      if (from === to) throw new UserError('Mata uang asal dan tujuan sama.');
      let data;
      try {
        data = await getJson(`https://api.frankfurter.dev/v1/latest?amount=${amount}&base=${from}&symbols=${to}`, 'kurs');
      } catch (e) {
        if (e.status === 404 || e.status === 422) throw new UserError(`Mata uang ${from} atau ${to} tidak didukung.`);
        throw e;
      }
      const v = data.rates?.[to];
      if (v == null) throw new UserError(`Mata uang ${to} tidak didukung.`);
      const fmt = (n) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 4 }).format(n);
      await reply(`💱 *${fmt(amount)} ${from}* = *${fmt(v)} ${to}*\n_Kurs referensi ${data.date} (Frankfurter/ECB), bukan kurs jual-beli bank._`);
    },
  },
  {
    name: 'hitung',
    aliases: ['calc', 'kalkulator'],
    usage: '<ekspresi>',
    category: 'Alat',
    desc: 'Kalkulator, mis. .hitung (2+3)*4',
    async run({ text, reply, prefix }) {
      if (!text) throw new UserError(`Contoh: ${prefix}hitung (12+8)*3/4\nDidukung: + - * / % ^ ( ) sqrt() abs() pi`);
      let v;
      try {
        v = calc(text);
      } catch (e) {
        throw new UserError(`Tidak bisa dihitung: ${e.message}`);
      }
      const shown = Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(12)));
      await reply(`🧮 ${text.slice(0, 100)} = *${shown}*`);
    },
  },
  {
    name: 'qr',
    aliases: ['qrcode', 'buatqr'],
    usage: '<teks atau link>',
    category: 'Alat',
    desc: 'Buat kode QR',
    async run({ sock, msg, jid, text, reply, prefix }) {
      if (!text) throw new UserError(`Contoh: ${prefix}qr https://contoh.com`);
      if (text.length > 800) throw new UserError('Teks terlalu panjang (maksimal 800 huruf).');
      const png = await QRCode.toBuffer(text, { width: 600, margin: 2, errorCorrectionLevel: 'M' });
      await sock.sendMessage(jid, { image: png, caption: '✅ QR siap dipindai' }, { quoted: msg });
    },
  },
  {
    name: 'stopwatch',
    aliases: ['sw'],
    category: 'Alat',
    desc: 'Stopwatch: panggil untuk mulai, panggil lagi untuk berhenti',
    async run({ jid, sender, reply }) {
      const key = `${jid}|${sender}`;
      const start = stopwatches.get(key);
      if (!start) {
        stopwatches.set(key, Date.now());
        if (stopwatches.size > 2000) stopwatches.delete(stopwatches.keys().next().value);
        return reply('⏱️ Stopwatch dimulai. Kirim perintah yang sama untuk berhenti.');
      }
      stopwatches.delete(key);
      const sec = (Date.now() - start) / 1000;
      await reply(`⏹️ Berhenti: *${sec < 60 ? `${sec.toFixed(2)} detik` : formatDuration(Math.round(sec))}*`);
    },
  },
];
