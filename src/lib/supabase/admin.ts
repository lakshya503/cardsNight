import { createClient } from '@supabase/supabase-js'

/**
 * Admin client using the service_role key — bypasses Row Level Security.
 * ONLY use this in Server Components or API routes. Never import in client code.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}
