import { describe, expect, it } from 'vitest';
import {
  CardIdentificationSchema,
  parseIdentificationJson,
  validateIdentification,
} from '@/lib/types/identification';
import { CONFIDENCE_THRESHOLDS } from '@/lib/types/domain';

const completeCard = {
  sport: 'NBA',
  player_name: 'LeBron James',
  year: 2003,
  manufacturer: 'Upper Deck',
  product_line: 'SP Authentic',
  set_variant: 'Rookie Exclusives',
  card_number: '123',
  parallel_name: 'Gold',
  serial_number: '/25',
  is_graded: true,
  grade_company: 'PSA',
  grade_value: '10',
  confidence: 0.95,
  parallel_confidence: 0.9,
  needs_confirmation: false,
};

const minimalCard = {
  sport: 'NFL',
  player_name: 'Patrick Mahomes',
  year: 2017,
  manufacturer: 'Panini',
  product_line: 'Prizm',
  is_graded: false,
  confidence: 0.8,
  parallel_confidence: 0.7,
};

describe('validateIdentification', () => {
  it('accepts a complete, valid identification', () => {
    const result = validateIdentification(completeCard);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.player_name).toBe('LeBron James');
      expect(result.data.serial_number).toBe('/25');
      expect(result.data.grade_company).toBe('PSA');
    }
  });

  it('accepts a response missing optional fields and applies defaults', () => {
    const result = validateIdentification(minimalCard);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.parallel_name).toBe('Base');
      expect(result.data.needs_confirmation).toBe(false);
      expect(result.data.card_number).toBeUndefined();
      expect(result.data.grade_company).toBeUndefined();
    }
  });

  it('accepts a low-confidence identification (below 0.5) as valid data', () => {
    const result = validateIdentification({ ...minimalCard, confidence: 0.3 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.confidence).toBeLessThan(CONFIDENCE_THRESHOLDS.OVERALL_MIN);
    }
  });

  it('rejects a graded card missing its grade_company', () => {
    const result = validateIdentification({ ...completeCard, grade_company: undefined });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('parseIdentificationJson', () => {
  it('parses a valid JSON identification string', () => {
    const result = parseIdentificationJson(JSON.stringify(completeCard));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.player_name).toBe('LeBron James');
    }
  });

  it('surfaces an AI error response as AI_ERROR', () => {
    const result = parseIdentificationJson('{"error":"Image too blurry to identify"}');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('AI_ERROR');
      expect(result.error).toBe('Image too blurry to identify');
    }
  });

  it('returns INVALID_JSON for malformed JSON', () => {
    const result = parseIdentificationJson('{ this is not json');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('INVALID_JSON');
    }
  });

  it('returns VALIDATION_ERROR when JSON parses but fails the schema', () => {
    const result = parseIdentificationJson('{"player_name":"Mystery"}');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('CardIdentificationSchema', () => {
  it('is the canonical schema re-exported from domain', () => {
    expect(CardIdentificationSchema.safeParse(completeCard).success).toBe(true);
  });
});
