import { createClient } from "@supabase/supabase-js";

// Publishable key is intentionally public; access is protected by Supabase Auth + RLS.
const url = import.meta.env.VITE_SUPABASE_URL || "https://mvezbjpnofwlerouzayj.supabase.co";
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_-xMLhkUrmUum0PSNlDoh3g_pKUjBJyR";

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
