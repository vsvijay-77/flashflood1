import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://odqmpcizoqatwxyrnlmj.supabase.co'
const supabaseKey = 'sb_publishable_P5KEs72lbOdxYy-roXqvqg_lzbdCES2'

export const supabase = createClient(supabaseUrl, supabaseKey)
