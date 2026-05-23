/**
 * lib/db/server-client.ts
 *
 * Server-side Supabase client (service_role / secret key).
 * Bypasses RLS — ONLY import in API routes and server actions.
 * NEVER import in Client Components or the Chrome extension.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

const EnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL:  z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
})

// Lazy singleton — only validated when first called (not at build time).
let _client: SupabaseClient | null = null

export function getServerClient(): SupabaseClient {
  if (_client) return _client

  const env = EnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL:  process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  })

  _client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession:   false,
    },
  })

  return _client
}
