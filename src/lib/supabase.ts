import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'
import { createLocalClient } from './localClient'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? ''
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  ''

export const isLocalMode = (import.meta.env.VITE_SKILLMIND_MODE ?? '').toLowerCase() === 'local'
const cloudConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const isSupabaseConfigured = isLocalMode || cloudConfigured

// Cloud uses Supabase. Local mode uses the SkillMind API and Postgres behind SKILLMIND_MODE=local.
export const supabase: SupabaseClient<Database> | null = isLocalMode
  ? createLocalClient() as unknown as SupabaseClient<Database>
  : cloudConfigured
    ? createClient<Database>(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null
