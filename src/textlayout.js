// Tata letak teks + pembuat SVG untuk stiker brat/meme (murni, tanpa dependensi).

const FONT = "'DejaVu Sans','Liberation Sans','Arial',sans-serif";
const CHAR_W = 0.6; // lebar rata-rata satu huruf (huruf kecil) relatif terhadap ukuran font
const CHAR_W_BOLD_CAPS = 0.8; // huruf kapital tebal lebih lebar

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Bungkus teks per kata sesuai lebar; kata yang terlalu panjang dipotong. */
export function wrap(text, size, width, charW = CHAR_W) {
  const max = Math.max(3, Math.floor(width / (size * charW)));
  const lines = [];
  let line = '';
  for (let word of text.split(/\s+/).filter(Boolean)) {
    while (word.length > max) {
      if (line) { lines.push(line); line = ''; }
      lines.push(word.slice(0, max));
      word = word.slice(max);
    }
    if (!line) line = word;
    else if ((line + ' ' + word).length <= max) line += ' ' + word;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

/** Ukuran font terbesar yang masih muat di kotak (lebar x tinggi). */
export function fit(text, width, height, maxSize, minSize, lineH = 1.1, charW = CHAR_W) {
  for (let size = maxSize; size >= minSize; size -= 2) {
    const lines = wrap(text, size, width, charW);
    if (lines.length * size * lineH <= height) return { size, lines };
  }
  return { size: minSize, lines: wrap(text, minSize, width, charW).slice(0, Math.max(1, Math.floor(height / (minSize * lineH)))) };
}

export function bratSvg(raw) {
  const W = 512;
  const pad = 30;
  const text = raw.toLowerCase().slice(0, 200);
  const { size, lines } = fit(text, W - pad * 2, W - pad * 2, 160, 28, 1.08);
  const tspans = lines.map((l, i) => `<text x="${pad}" y="${pad + size * 0.85 + i * size * 1.08}" font-size="${size}">${esc(l)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}"><rect width="100%" height="100%" fill="#8ACF00"/><g font-family="${FONT}" fill="#000">${tspans}</g></svg>`;
}

export function memeSvg(w, h, top, bottom) {
  const box = (txt) => fit(txt.toUpperCase(), w - 28, h * 0.3, Math.round(w / 8), 14, 1.1, CHAR_W_BOLD_CAPS);
  const block = (txt, atTop) => {
    if (!txt) return '';
    const { size, lines } = box(txt);
    const total = lines.length * size * 1.1;
    const y0 = atTop ? 10 : h - total - 10;
    return lines
      .map((l, i) => `<text x="${w / 2}" y="${y0 + size * 0.9 + i * size * 1.1}" font-size="${size}" text-anchor="middle">${esc(l)}</text>`)
      .join('');
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><g font-family="${FONT}" font-weight="700" fill="#fff" stroke="#000" stroke-width="${Math.max(3, Math.round(w / 90))}" stroke-linejoin="round" paint-order="stroke fill">${block(top, true)}${block(bottom, false)}</g></svg>`;
}
