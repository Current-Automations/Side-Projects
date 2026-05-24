/**
 * lib/types/identification.ts
 *
 * The validation boundary for GPT-4o identification output.
 *
 * The canonical shape lives in domain.ts as `CardIdentificationSchema` — this
 * module re-exports it (single source of truth) and adds the parse/validate
 * helpers the AI layer uses to turn a raw model response into a typed result.
 */

import { z } from 'zod';
import {
  CardIdentificationSchema,
  type CardIdentification,
} from './domain';

export {
  CardIdentificationSchema,
  type CardIdentification,
} from './domain';
export {
  SportSchema,
  ManufacturerSchema,
  GradeCompanySchema,
  CONFIDENCE_THRESHOLDS,
} from './domain';

/**
 * Why each result is distinct:
 * - AI_ERROR: the model explicitly declined (not a card / too blurry).
 * - INVALID_JSON: the model returned something that isn't JSON at all.
 * - VALIDATION_ERROR: valid JSON, but it doesn't match the card schema.
 */
export type IdentificationErrorCode = 'AI_ERROR' | 'INVALID_JSON' | 'VALIDATION_ERROR';

export type IdentificationResult =
  | { success: true; data: CardIdentification }
  | { success: false; error: string; code: IdentificationErrorCode };

const AiErrorSchema = z.object({ error: z.string().min(1) });

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

/** Validate an already-parsed value against the card schema. */
export function validateIdentification(value: unknown): IdentificationResult {
  const parsed = CardIdentificationSchema.safeParse(value);
  if (parsed.success) {
    return { success: true, data: parsed.data };
  }
  return {
    success: false,
    error: formatZodError(parsed.error),
    code: 'VALIDATION_ERROR',
  };
}

/** Parse a raw model response string into a typed identification result. */
export function parseIdentificationJson(text: string): IdentificationResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {
      success: false,
      error: 'Model did not return valid JSON',
      code: 'INVALID_JSON',
    };
  }

  const validated = validateIdentification(raw);
  if (validated.success) {
    return validated;
  }

  // Not a valid full identification — was it an explicit AI decline?
  const declined = AiErrorSchema.safeParse(raw);
  if (declined.success) {
    return { success: false, error: declined.data.error, code: 'AI_ERROR' };
  }

  return validated;
}
