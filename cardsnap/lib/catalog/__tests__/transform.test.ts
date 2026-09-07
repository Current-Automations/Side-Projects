/**
 * lib/catalog/__tests__/transform.test.ts
 *
 * The transform layer against real TCGdex responses captured in fixtures/.
 * Network I/O in source.ts is covered by scripts/spike-tcgdex.mjs, not here.
 */

import { describe, it, expect } from 'vitest';
import { TcgdexCardSchema, TcgdexSetSchema } from '../schemas';
import {
  toCatalogSetRow,
  toCatalogCardRow,
  cardImageUrl,
  possibleFinishes,
} from '../transform';

import setSv03 from './fixtures/set-sv03.json';
import cardArboliva from './fixtures/card-sv03-021-arboliva.json';
import cardCharizardEx from './fixtures/card-sv03-125-charizard-ex.json';
import cardGloomIr from './fixtures/card-sv03-198-gloom-ir.json';

const parseCard = (json: unknown) => {
  const r = TcgdexCardSchema.safeParse(json);
  if (!r.success) throw new Error(r.error.message);
  return r.data;
};
const parseSet = (json: unknown) => {
  const r = TcgdexSetSchema.safeParse(json);
  if (!r.success) throw new Error(r.error.message);
  return r.data;
};

describe('schemas accept real TCGdex responses', () => {
  it('parses a set with its embedded card list', () => {
    const set = parseSet(setSv03);
    expect(set.id).toBe('sv03');
    expect(set.cards?.length).toBe(230);
  });

  it('parses cards across categories and rarities', () => {
    expect(() => parseCard(cardArboliva)).not.toThrow();
    expect(() => parseCard(cardCharizardEx)).not.toThrow();
    expect(() => parseCard(cardGloomIr)).not.toThrow();
  });
});

describe('toCatalogSetRow', () => {
  it('maps the set fields the catalog needs', () => {
    const row = toCatalogSetRow(parseSet(setSv03));
    expect(row).toMatchObject({
      id: 'sv03',
      name: 'Obsidian Flames',
      series_id: 'sv',
      series_name: 'Scarlet & Violet',
      card_count_official: 197,
      card_count_total: 230,
      release_date: '2023-08-11',
    });
    expect(row.symbol_url).toContain('assets.tcgdex.net');
    expect(row.raw).toEqual(setSv03);
  });
});

describe('toCatalogCardRow', () => {
  it('maps a plain card, keeping variants and pricing', () => {
    const row = toCatalogCardRow(parseCard(cardArboliva), 'sv03');
    expect(row).toMatchObject({
      id: 'sv03-021',
      set_id: 'sv03',
      local_id: '021',
      name: 'Arboliva',
      supertype: 'Pokemon',
      rarity: 'Uncommon',
      illustrator: 'KEIICHIRO ITO',
    });
    expect(row.dex_ids).toEqual([930]);
    expect(row.variants).toMatchObject({ normal: true, reverse: true, holo: false });
    expect(Array.isArray(row.variants_detailed)).toBe(true);
    expect(row.tcgplayer_prices).not.toBeNull();
    expect(row.cardmarket_prices).not.toBeNull();
    expect(row.tcgdex_updated_at).toBeTruthy();
  });

  it('falls back to the passed setId when the record has no set block', () => {
    const bare = { id: 'xy1-1', localId: '1', name: 'Test' };
    const row = toCatalogCardRow(parseCard(bare), 'xy1');
    expect(row.set_id).toBe('xy1');
    expect(row.local_id).toBe('1');
    expect(row.supertype).toBeNull();
    expect(row.dex_ids).toBeNull();
  });

  it('derives best-effort subtypes from the split TCGdex fields', () => {
    const row = toCatalogCardRow(parseCard(cardArboliva), 'sv03');
    expect(row.subtypes).toContain('Stage2');
  });
});

describe('cardImageUrl', () => {
  it('appends quality and format to the TCGdex base', () => {
    expect(cardImageUrl('https://assets.tcgdex.net/en/sv/sv03/021')).toBe(
      'https://assets.tcgdex.net/en/sv/sv03/021/high.jpg'
    );
    expect(cardImageUrl('https://assets.tcgdex.net/en/sv/sv03/021', 'low', 'webp')).toBe(
      'https://assets.tcgdex.net/en/sv/sv03/021/low.webp'
    );
  });

  it('tolerates a trailing slash and returns null with no base', () => {
    expect(cardImageUrl('https://x/y/')).toBe('https://x/y/high.jpg');
    expect(cardImageUrl(null)).toBeNull();
    expect(cardImageUrl(undefined)).toBeNull();
  });
});

describe('possibleFinishes', () => {
  it('lists the finishes a card exists in, from the variant flags', () => {
    expect(possibleFinishes(parseCard(cardArboliva))).toEqual(['normal', 'reverse']);
    expect(possibleFinishes(parseCard(cardGloomIr))).toEqual(['holo']);
  });
});
