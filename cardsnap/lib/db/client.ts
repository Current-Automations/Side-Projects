/**
 * lib/db/client.ts
 *
 * Browser-side Supabase client (anon / publishable key).
 * Safe to import in Client Components and the Chrome extension.
 * Never contains the service_role key.
 */
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

const EnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL:      z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
})

const env = EnvSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL:      process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
})

export const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// Backward-compat alias — pre-existing db helpers import createServerClient from here.
// The real implementation lives in ./server-client.
export { getServerClient as createServerClient } from './server-client'
