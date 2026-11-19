import { describe, expect, it } from 'vitest';
import { FUJI_CENTER } from '../lib/constants';
import { decodeGsi, globalPixel } from './elevation';

describe('GSI elevation tiles', () => {
  it('decodes metres, negatives and no-data', () => {
    // 3776.24 m = 377624 cm = 0x05C318
    expect(decodeGsi(0x05, 0xc3, 0x18)).toBeCloseTo(3776.24, 6);
    expect(decodeGsi(0, 0, 0)).toBe(0);
    // −1.5 m = 2²⁴ − 150
    expect(decodeGsi(0xff, 0xff, 0x6a)).toBeCloseTo(-1.5, 6);
    expect(decodeGsi(0x80, 0, 0)).toBeNaN();
  });

  it('puts the crater in the right zoom-14 tile', () => {
    const { x, y } = globalPixel(FUJI_CENTER, 14);
    expect([Math.floor(x / 256), Math.floor(y / 256)]).toEqual([14505, 6469]);
  });
});
