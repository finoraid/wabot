// Kalkulator aman (tanpa eval): + - * / % ^ tanda kurung, desimal, sqrt() abs() pi e.

export function calc(input) {
  const src = String(input).toLowerCase().replace(/,/g, '.').replace(/[x×]/g, '*').replace(/[:÷]/g, '/').replace(/\*\*/g, '^').replace(/\s+/g, '');
  if (!src || src.length > 120) throw new Error('kosong atau terlalu panjang');
  let i = 0;
  const peek = () => src[i];

  function number() {
    const m = src.slice(i).match(/^(\d+\.?\d*|\.\d+)/);
    if (!m) throw new Error(`karakter tidak dikenal "${src[i] ?? 'akhir'}"`);
    i += m[0].length;
    return Number(m[0]);
  }
  function primary() {
    if (peek() === '(') {
      i++;
      const v = expr();
      if (peek() !== ')') throw new Error('kurung belum ditutup');
      i++;
      return v;
    }
    const f = src.slice(i).match(/^(sqrt|abs|pi|e)(?![a-z])/);
    if (f) {
      i += f[0].length;
      if (f[0] === 'pi') return Math.PI;
      if (f[0] === 'e') return Math.E;
      if (peek() !== '(') throw new Error(`${f[0]} butuh tanda kurung`);
      i++;
      const v = expr();
      if (peek() !== ')') throw new Error('kurung belum ditutup');
      i++;
      return f[0] === 'sqrt' ? Math.sqrt(v) : Math.abs(v);
    }
    return number();
  }
  function unary() {
    if (peek() === '-') { i++; return -unary(); }
    if (peek() === '+') { i++; return unary(); }
    return primary();
  }
  function power() {
    const base = unary();
    if (peek() === '^') { i++; return Math.pow(base, power()); } // rata kanan: 2^3^2 = 2^(3^2)
    return base;
  }
  function term() {
    let v = power();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = src[i++];
      const r = power();
      if (op === '*') v *= r;
      else if (r === 0) throw new Error('tidak bisa dibagi nol');
      else v = op === '/' ? v / r : v % r;
    }
    return v;
  }
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') v = src[i++] === '+' ? v + term() : v - term();
    return v;
  }

  const result = expr();
  if (i < src.length) throw new Error(`karakter tidak dikenal "${src[i]}"`);
  if (!Number.isFinite(result)) throw new Error('hasil tidak valid');
  return result;
}
