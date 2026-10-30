import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return Response.json({ error: 'Método inválido.' }, { status: 405, headers: corsHeaders });

  try {
    const { username, password } = await request.json();
    const cleanUsername = typeof username === 'string' ? username.trim().toLowerCase().replace(/^@/, '') : '';
    if (!/^[a-z0-9_]{3,24}$/.test(cleanUsername) || typeof password !== 'string' || !password) {
      return Response.json({ error: 'E-mail, usuário ou senha inválidos.' }, { status: 400, headers: corsHeaders });
    }

    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile } = await admin.from('profiles').select('id').eq('username', cleanUsername).maybeSingle();
    if (!profile) return Response.json({ error: 'E-mail, usuário ou senha inválidos.' }, { status: 401, headers: corsHeaders });

    const { data: account } = await admin.auth.admin.getUserById(profile.id);
    const email = account.user?.email;
    if (!email) return Response.json({ error: 'E-mail, usuário ou senha inválidos.' }, { status: 401, headers: corsHeaders });

    const auth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await auth.auth.signInWithPassword({ email, password });
    if (error || !data.session) return Response.json({ error: 'E-mail, usuário ou senha inválidos.' }, { status: 401, headers: corsHeaders });

    return Response.json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token }, { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Não foi possível entrar agora.' }, { status: 500, headers: corsHeaders });
  }
});
