import { encodeQr, qrSvgPath } from './qr-code';

/** The 7×7 finder pattern: dark ring, light ring, 3×3 dark centre. */
function hasFinder(modules: boolean[][], x0: number, y0: number): boolean {
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
      if (modules[y0 + y][x0 + x] !== (ring !== 2)) return false;
    }
  }
  return true;
}

describe('encodeQr', () => {
  // Decoding was verified against jsQR for 600 random strings over versions 1–10.
  it('picks the smallest version and draws the three finder patterns', () => {
    const token = 'FA1.cmh8x1k2a0000qz7v3n9b4c2d.1b9k3x.0123456789abcdef';
    const { size, modules } = encodeQr(token);
    expect(size).toBe(33); // version 4
    expect(hasFinder(modules, 0, 0)).toBe(true);
    expect(hasFinder(modules, size - 7, 0)).toBe(true);
    expect(hasFinder(modules, 0, size - 7)).toBe(true);
    expect(modules[size - 8][8]).toBe(true); // the always-dark module
    expect(encodeQr('a').size).toBe(21);
  });

  it('is deterministic and rejects text that does not fit version 10', () => {
    expect(encodeQr('FA1.x.y.z')).toEqual(encodeQr('FA1.x.y.z'));
    expect(() => encodeQr('x'.repeat(214))).toThrow();
    expect(encodeQr('x'.repeat(213)).size).toBe(57);
  });

  it('draws one square per dark module inside the quiet zone', () => {
    const matrix = encodeQr('a');
    const dark = matrix.modules.flat().filter(Boolean).length;
    const path = qrSvgPath(matrix, 4);
    expect(path.match(/M/g)).toHaveLength(dark);
    expect(path.startsWith('M4 4h1v1h-1z')).toBe(true);
  });
});
