import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && key);

// Só usamos o Realtime (presence + broadcast); não há tabelas nem login.
export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, key!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      // Rajadas de candidatos ICE passam do limite padrão de 10 eventos/s.
      realtime: { params: { eventsPerSecond: 50 } },
    })
  : null;
