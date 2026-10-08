/**
 * Supabase client — server-side only.
 *
 * NEVER import this from a client component. It reads the secret key, which
 * bypasses Row Level Security; a browser bundle containing it would hand anyone
 * full read/write access to the whole database.
 *
 * KEY NAMING: Supabase renamed `service_role` (a long JWT) to `sb_secret_...`
 * and it is NOT a JWT, so it must travel in the `apikey` header rather than as
 * a bearer token. The official client handles that difference, which is why we
 * use the client rather than hand-rolling fetch calls. Both variable names are
 * accepted so a legacy project keeps working and a rename needs no code change.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function supabaseConfigured(): boolean {
  return Boolean(supabaseUrl() && supabaseKey());
}

function supabaseUrl(): string | undefined {
  return process.env.SUPABASE_URL?.trim() || undefined;
}

function supabaseKey(): string | undefined {
  return (
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    undefined
  );
}

let cached: SupabaseClient | null = null;

export function db(): SupabaseClient {
  const url = supabaseUrl();
  const key = supabaseKey();
  if (!url || !key) {
    throw new Error(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env',
    );
  }
  if (!cached) {
    cached = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-application-name': 'chog-mischief' } },
    });
  }
  return cached;
}