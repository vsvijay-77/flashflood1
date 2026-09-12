import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://pffdafhrhtevdboxqztn.supabase.co'
const supabaseKey = 'sb_publishable_YP29CER2yLiNVIz7fmuw-g_0R6R9wEJ'

export const supabase = createClient(supabaseUrl, supabaseKey)
