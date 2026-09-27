import { createClient } from '@supabase/supabase-js'

// Use environment variables for Vercel deployment.
// Fallback to the defaults so the app works locally without a .env file.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://pffdafhrhtevdboxqztn.supabase.co'
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_YP29CER2yLiNVIz7fmuw-g_0R6R9wEJ'

export const supabase = createClient(supabaseUrl, supabaseKey)
