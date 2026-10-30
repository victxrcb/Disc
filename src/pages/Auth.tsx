import { useState, type FormEvent } from 'react';
import { supabase, supabaseConfigured } from '../lib/supabase';

export function AuthPage() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (mode === 'login') {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
      } else {
        const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24);
        if (cleanUsername.length < 3) throw new Error('O nome de usuário precisa ter pelo menos 3 caracteres.');
        if (password.length < 6) throw new Error('A senha precisa ter pelo menos 6 caracteres.');
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(), password,
          options: { data: { username: cleanUsername, display_name: displayName.trim().slice(0, 32) || cleanUsername } },
        });
        if (authError) throw authError;
        if (!data.session) setNotice('Cadastro criado. Confira seu e-mail para confirmar a conta.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível continuar.');
    } finally { setBusy(false); }
  };

  return (
    <main className="auth-page">
      <section className="auth-hero">
        <p className="home__wordmark">Discord<br />2.0</p>
        <div><span className="eyebrow">Seu espaço, sua galera</span><h1>Converse, jogue e fique perto.</h1><p>Chamadas, mensagens e amigos reunidos em um só lugar.</p></div>
      </section>
      <section className="auth-card">
        <div className="auth-card__head"><img src="/favicon.png" alt="" /><div><h2>{mode === 'login' ? 'Boas-vindas de volta' : 'Crie seu perfil'}</h2><p>{mode === 'login' ? 'Entre para encontrar seus amigos.' : 'Seu nome de usuário será único.'}</p></div></div>
        {!supabaseConfigured && <p className="notice notice--error">Configure o Supabase para usar contas.</p>}
        <form onSubmit={submit} className="auth-form">
          {mode === 'signup' && <><label className="field"><span className="field__label">Nome de usuário</span><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="seu_usuario" maxLength={24} autoComplete="username" required /></label><label className="field"><span className="field__label">Nome de exibição</span><input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Como seus amigos te chamam" maxLength={32} required /></label></>}
          <label className="field"><span className="field__label">E-mail</span><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></label>
          <label className="field"><span className="field__label">Senha</span><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={6} required /></label>
          {error && <p className="notice notice--error">{error}</p>}{notice && <p className="notice notice--success">{notice}</p>}
          <button className="btn btn--primary btn--block" disabled={busy || !supabaseConfigured}>{busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}</button>
        </form>
        <button className="auth-switch" type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); }}>{mode === 'login' ? 'Ainda não tem conta? Cadastre-se' : 'Já tem uma conta? Entrar'}</button>
      </section>
    </main>
  );
}
