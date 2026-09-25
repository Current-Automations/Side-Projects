import { describe, it, expect } from 'vitest';
import { pickPool, buildSetRound } from '../rounds';
import type { RawSetDraw } from '../store';

const draw: RawSetDraw = {
  card_id: 'base1-4',
  card_name: 'Charizard',
  set_id: 'base1',
  set_name: 'Base Set',
  image_base_url: 'https://assets.tcgdex.net/en/base/base1/4',
  distractor_sets: ['Jungle', 'Fossil', 'Team Rocket'],
};

describe('pickPool', () => {
  it('returns control when it is the only available pool', () => {
    for (let i = 0; i < 50; i++) expect(pickPool(['control'])).toBe('control');
  });

  it('falls back to control when nothing is available', () => {
    expect(pickPool([])).toBe('control');
  });

  it('only ever returns a pool that was offered', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(pickPool(['control', 'hard', 'unknown']));
    for (const p of seen) expect(['control', 'hard', 'unknown']).toContain(p);
  });
});

describe('buildSetRound', () => {
  it('produces four unique choices including the correct set', () => {
    const round = buildSetRound(draw);
    expect(round.choices).toHaveLength(4);
    expect(new Set(round.choices).size).toBe(4);
    expect(round.choices).toContain('Base Set');
    expect(round.correct).toBe('Base Set');
  });

  it('keeps the answer even when distractors collide with it', () => {
    const round = buildSetRound({
      ...draw,
      distractor_sets: ['Base Set', 'Base Set', 'Jungle'],
    });
    expect(round.choices).toContain('Base Set');
    expect(round.correct).toBe('Base Set');
  });

  it('carries the card id and image base url through for persistence', () => {
    const round = buildSetRound(draw);
    expect(round.cardId).toBe('base1-4');
    expect(round.imageBaseUrl).toBe('https://assets.tcgdex.net/en/base/base1/4');
    expect(round.mode).toBe('set');
  });
});
