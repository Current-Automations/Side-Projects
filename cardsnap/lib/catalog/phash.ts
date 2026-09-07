/**
 * lib/catalog/phash.ts
 *
 * Difference hash (dHash) for catalog images. Cheap perceptual fingerprint used
 * as a pre-filter and sanity cross-check ahead of the embedding retrieval in
 * Phase 2. Robust to scaling and mild compression, not to rotation or crop.
 *
 * The hash is built directly as a 16-char hex string (nibble by nibble) so it
 * never needs a 64-bit integer — the repo targets ES2017, no BigInt.
 */

import sharp from 'sharp';

const HASH_W = 9;
const HASH_H = 8;

const POPCOUNT = Array.from({ length: 16 }, (_, i) => {
  let n = i;
  let c = 0;
  while (n) {
    c += n & 1;
    n >>= 1;
  }
  return c;
});

/** 64-bit dHash as a 16-char lowercase hex string. */
export async function dhash(image: Buffer): Promise<string> {
  const { data } = await sharp(image)
    .greyscale()
    .resize(HASH_W, HASH_H, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let hex = '';
  let nibble = 0;
  let bits = 0;
  for (let row = 0; row < HASH_H; row++) {
    for (let col = 0; col < HASH_W - 1; col++) {
      const on = data[row * HASH_W + col] > data[row * HASH_W + col + 1] ? 1 : 0;
      nibble = (nibble << 1) | on;
      if (++bits === 4) {
        hex += nibble.toString(16);
        nibble = 0;
        bits = 0;
      }
    }
  }
  return hex;
}

/** Bits that differ between two hex hashes. 0 = identical, ~10+ = unrelated. */
export function hammingDistance(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    d += POPCOUNT[(parseInt(a[i], 16) ^ parseInt(b[i], 16)) & 0xf];
  }
  return d;
}
