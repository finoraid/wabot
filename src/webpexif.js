// Menyisipkan metadata paket stiker (nama paket & pembuat) ke berkas WebP, format yang dibaca WhatsApp.
import crypto from 'node:crypto';

const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
const u24 = (n) => Buffer.from([n & 255, (n >> 8) & 255, (n >> 16) & 255]);

export function buildExif(pack, author) {
  const json = Buffer.from(
    JSON.stringify({
      'sticker-pack-id': crypto.randomUUID(),
      'sticker-pack-name': String(pack || '').slice(0, 60),
      'sticker-pack-publisher': String(author || '').slice(0, 60),
      emojis: [''],
    }),
    'utf8',
  );
  // Header TIFF kecil + 1 entri (tag 0x5741) yang menunjuk ke JSON di belakangnya.
  const head = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]);
  head.writeUInt32LE(json.length, 14);
  return Buffer.concat([head, json]);
}

/** Ukuran kanvas dari chunk VP8 / VP8L (webp sederhana tanpa VP8X). */
function canvasOf(type, data) {
  if (type === 'VP8 ') return { w: data.readUInt16LE(6) & 0x3fff, h: data.readUInt16LE(8) & 0x3fff };
  if (type === 'VP8L') {
    const b = data.readUInt32LE(1);
    return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
  }
  throw new Error('jenis WebP tidak dikenal');
}

/** Kembalikan Buffer WebP baru yang membawa EXIF (menggantikan EXIF lama kalau ada). */
export function withExif(webp, exif) {
  if (webp.length < 20 || webp.toString('latin1', 0, 4) !== 'RIFF' || webp.toString('latin1', 8, 12) !== 'WEBP') throw new Error('bukan berkas WebP');
  const chunks = [];
  for (let pos = 12; pos + 8 <= webp.length; ) {
    const type = webp.toString('latin1', pos, pos + 4);
    const size = webp.readUInt32LE(pos + 4);
    chunks.push({ type, data: webp.subarray(pos + 8, pos + 8 + size) });
    pos += 8 + size + (size & 1);
  }
  if (!chunks.length) throw new Error('WebP kosong');

  let vp8x = chunks.find((c) => c.type === 'VP8X');
  const rest = chunks.filter((c) => c.type !== 'VP8X' && c.type !== 'EXIF');
  let flags;
  let cw;
  let ch;
  if (vp8x) {
    flags = vp8x.data[0];
    cw = vp8x.data.subarray(4, 7);
    ch = vp8x.data.subarray(7, 10);
  } else {
    const img = rest.find((c) => c.type === 'VP8 ' || c.type === 'VP8L');
    if (!img) throw new Error('WebP tanpa data gambar');
    const { w, h } = canvasOf(img.type, img.data);
    flags = 0;
    cw = u24(w - 1);
    ch = u24(h - 1);
  }
  flags |= 0x08; // ada EXIF
  const head = Buffer.concat([Buffer.from([flags, 0, 0, 0]), cw, ch]);
  const all = [{ type: 'VP8X', data: head }, ...rest, { type: 'EXIF', data: exif }];
  const body = Buffer.concat(
    all.map((c) => Buffer.concat([Buffer.from(c.type, 'latin1'), u32(c.data.length), c.data, c.data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)])),
  );
  return Buffer.concat([Buffer.from('RIFF', 'latin1'), u32(4 + body.length), Buffer.from('WEBP', 'latin1'), body]);
}
