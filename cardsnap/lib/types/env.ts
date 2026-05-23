/**
 * lib/types/env.ts
 *
 * Validates required environment variables on first access (lazy).
 * This prevents startup errors during Sessions 1-3 when keys like
 * OPENAI_API_KEY haven't been added yet — validation only fires when
 * the code that actually needs the variable runs.
 *
 * Usage:
 *   import { getEnv } from '@/lib/types/env'
 *   const { OPENAI_API_KEY } = getEnv()
 */

import { z } from 'zod';

const EnvSchema = z.object({
  // Supabase — required from Session 1
  NEXT_PUBLIC_SUPABASE_URL:      z.string().url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required'),
  SUPABASE_SERVICE_ROLE_KEY:     z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),

  // OpenAI — required from Session 2
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required').optional(),

  // eBay — required from Session 3
  EBAY_APP_ID:  z.string().min(1, 'EBAY_APP_ID is required').optional(),
  EBAY_CERT_ID: z.string().min(1, 'EBAY_CERT_ID is required').optional(),

  // Stripe — required from Session 4
  STRIPE_SECRET_KEY:                 z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET:             z.string().min(1).optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let _env: Env | null = null;

/** Returns parsed and validated environment variables. Throws on first access if required vars are missing. */
export function getEnv(): Env {
  if (!_env) {
    _env = EnvSchema.parse(process.env);
  }
  return _env;
}

// Named accessors for the keys needed in each session — fail fast with a clear message.

/** Session 2+ — throws immediately if OPENAI_API_KEY is not set. */
export function requireOpenAIKey(): string {
  const key = getEnv().OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is required. Add it to .env.local before Session 2.');
  return key;
}

/** Session 3+ — throws immediately if EBAY_APP_ID is not set. */
export function requireEbayCredentials(): { appId: string; certId: string } {
  const env = getEnv();
  if (!env.EBAY_APP_ID)  throw new Error('EBAY_APP_ID is required. Add it to .env.local before Session 3.');
  if (!env.EBAY_CERT_ID) throw new Error('EBAY_CERT_ID is required. Add it to .env.local before Session 3.');
  return { appId: env.EBAY_APP_ID, certId: env.EBAY_CERT_ID };
}

/** Session 4+ — throws immediately if STRIPE_SECRET_KEY is not set. */
export function requireStripeKey(): string {
  const key = getEnv().STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is required. Add it to .env.local before Session 4.');
  return key;
}
