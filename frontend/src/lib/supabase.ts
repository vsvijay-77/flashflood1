import { createClient } from '@supabase/supabase-js'

// Use environment variables for Vercel deployment.
// Fallback to the defaults so the app works locally without a .env file.
export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://xmtuwcywlfdoarwzkmod.supabase.co'
export const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_S-TCSEUmcrwHDU1PtUDjhw_na5bgd3K'

export const supabase = createClient(supabaseUrl, supabaseKey)
