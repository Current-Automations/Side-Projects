import { describe, it, expect } from 'vitest';
import { pickCard, pickPrice } from '../pokemonpricetracker';

// Shapes copied from live /api/v2/cards responses, 2026-09-25.
const baseCharizard = {
  name: 'Charizard',
  setName: 'Base Set',
  cardNumber: '004/102',
  externalCatalogId: 'base1-4',
  prices: { market: 944.53, primaryPrinting: 'Holofoil', lastUpdated: '2026-09-25T12:03:54.029Z' },
  variants: { Holofoil: { marketPrice: 944.53 } },
};
const blackDot = { ...baseCharizard, name: 'Charizard (Black Dot Error)', prices: { market: null }, variants: {} };
const celebrations = { ...baseCharizard, setName: 'Celebrations: Classic Collection', cardNumber: '4/102', externalCatalogId: 'cel25cc-CC002' };
const lookup = { card_name: 'Charizard', finish: 'holo' as const, is_graded: false };

describe('pickCard', () => {
  it('matches the tcgdex id exactly when one is given', () => {
    expect(pickCard([celebrations, baseCharizard], { ...lookup, tcgdex_id: 'base1-4' })).toBe(baseCharizard);
    expect(pickCard([celebrations], { ...lookup, tcgdex_id: 'base1-4' })).toBeNull();
  });

  it('needs name and collector number to agree without an id', () => {
    expect(pickCard([blackDot, baseCharizard], { ...lookup, card_number: '4/102' })).toBe(baseCharizard);
    expect(pickCard([baseCharizard], { ...lookup, card_number: '5' })).toBeNull();
  });

  it('refuses to guess between two same-name cards with no number', () => {
    expect(pickCard([baseCharizard, celebrations], lookup)).toBeNull();
  });
});

describe('pickPrice', () => {
  const mixed = {
    ...baseCharizard,
    prices: { market: 3, primaryPrinting: 'Normal' },
    variants: { Normal: { marketPrice: 3 }, 'Reverse Holofoil': { marketPrice: 9 }, Holofoil: { marketPrice: 20 } },
  };

  it('picks the printing that matches the finish', () => {
    expect(pickPrice(mixed, 'holo')).toEqual({ price: 20, printing: 'Holofoil' });
    expect(pickPrice(mixed, 'reverse')).toEqual({ price: 9, printing: 'Reverse Holofoil' });
    expect(pickPrice(mixed, 'normal')).toEqual({ price: 3, printing: 'Normal' });
  });

  it('falls back to the primary printing when the finish has no variant', () => {
    expect(pickPrice(mixed, 'first_edition')).toEqual({ price: 3, printing: 'Normal' });
  });

  it('returns null when there is no price at all', () => {
    expect(pickPrice(blackDot, 'holo')).toBeNull();
  });
});
