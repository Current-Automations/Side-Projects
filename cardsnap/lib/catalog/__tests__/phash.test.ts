/**
 * lib/catalog/__tests__/phash.test.ts
 *
 * dHash against synthetic images (no network). Asserts: stable for the same
 * image, survives a resize, and separates unrelated images by Hamming distance.
 */

import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { dhash, hammingDistance } from '../phash';

/** A horizontal gradient, w x h, optionally inverted. */
async function gradient(w: number, h: number, invert = false): Promise<Buffer> {
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.round((x / (w - 1)) * 255);
      const g = invert ? 255 - v : v;
      const i = (y * w + x) * 3;
      px[i] = px[i + 1] = px[i + 2] = g;
    }
  }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

describe('dhash', () => {
  it('is a 16-char hex string', async () => {
    const h = await dhash(await gradient(64, 64));
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is stable for the same image and across a resize', async () => {
    const a = await dhash(await gradient(64, 64));
    const b = await dhash(await gradient(64, 64));
    const scaled = await sharp(await gradient(64, 64)).resize(200, 200).toBuffer();
    const c = await dhash(scaled);
    expect(a).toBe(b);
    expect(hammingDistance(a, c)).toBeLessThanOrEqual(2);
  });

  it('separates an image from its inverse', async () => {
    const a = await dhash(await gradient(64, 64, false));
    const b = await dhash(await gradient(64, 64, true));
    expect(hammingDistance(a, b)).toBeGreaterThanOrEqual(20);
  });
});

describe('hammingDistance', () => {
  it('is zero for identical hashes and counts differing bits', () => {
    expect(hammingDistance('0000000000000000', '0000000000000000')).toBe(0);
    expect(hammingDistance('0000000000000000', '000000000000000f')).toBe(4);
    expect(hammingDistance('ffffffffffffffff', '0000000000000000')).toBe(64);
  });
});
