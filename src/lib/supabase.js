
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('Missing Supabase environment variables')
}

if (!supabaseServiceKey) {
    console.warn('Missing SUPABASE_SERVICE_ROLE_KEY, some features strictly requiring service-role (like user management) may fail silently or rely on RLS.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export const supabaseAdmin = supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : supabase
