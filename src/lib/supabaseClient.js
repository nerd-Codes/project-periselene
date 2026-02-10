import { createClient } from '@supabase/supabase-js'

// We will access these variables from a .env file
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigured = Boolean(supabaseUrl && supabaseKey)

if (!supabaseConfigured) {
  console.warn(
    'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment variables.'
  )
}

export const supabase = supabaseConfigured ? createClient(supabaseUrl, supabaseKey) : null
