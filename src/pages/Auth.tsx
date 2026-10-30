import { lazy, Suspense, useState, type FormEvent } from 'react';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { useTheme } from '../lib/theme';

const HomeScene = lazy(() => import('../components/HomeScene').catch(() => ({ default: () => null })));

export function AuthPage() {
  const { theme } = useTheme();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [identifier, setIdentifier] = useState('');
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
        const login = identifier.trim();
        if (login.includes('@')) {
          const { error: authError } = await supabase.auth.signInWithPassword({ email: login, password });
          if (authError) throw authError;
        } else {
          const { data, error: functionError } = await supabase.functions.invoke('login', {
            body: { username: login.toLowerCase().replace(/^@/, ''), password },
          });
          if (functionError || !data?.access_token || !data?.refresh_token) throw new Error(data?.error ?? 'E-mail, usuário ou senha inválidos.');
          const { error: sessionError } = await supabase.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
          if (sessionError) throw sessionError;
        }
      } else {
        const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24);
        if (cleanUsername.length < 3) throw new Error('O nome de usuário precisa ter pelo menos 3 caracteres.');
        if (password.length < 6) throw new Error('A senha precisa ter pelo menos 6 caracteres.');
        const { data, error: authError } = await supabase.auth.signUp({
          email: identifier.trim(), password,
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
    <main className={`home${theme === 'default' ? '' : ' home--themed'}`}>
      {theme === 'default' && <Suspense fallback={null}><HomeScene /></Suspense>}
      <p className="home__wordmark">Discord<br />2.0</p>
      <section className="home__card auth-panel">
        <h1 className="home__title">{mode === 'login' ? 'Boas-vindas de volta.' : 'Crie seu perfil.'}</h1>
        <p className="home__lead">{mode === 'login' ? 'Entre para encontrar seus amigos e continuar a resenha.' : 'Escolha como seus amigos vão encontrar você.'}</p>
        {!supabaseConfigured && <p className="notice notice--error">Configure o Supabase para usar contas.</p>}
        <form onSubmit={submit} className="auth-form">
          {mode === 'signup' && <><label className="field"><span className="field__label">Nome de usuário</span><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="seu_usuario" maxLength={24} autoComplete="username" required /></label><label className="field"><span className="field__label">Nome de exibição</span><input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Como seus amigos te chamam" maxLength={32} required /></label></>}
          <label className="field"><span className="field__label">{mode === 'login' ? 'E-mail ou nome de usuário' : 'E-mail'}</span><input className="input" type={mode === 'login' ? 'text' : 'email'} value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder={mode === 'login' ? 'voce@email.com ou seu_usuario' : 'voce@email.com'} autoComplete={mode === 'login' ? 'username' : 'email'} required /></label>
          <label className="field"><span className="field__label">Senha</span><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={6} required /></label>
          {error && <p className="notice notice--error">{error}</p>}{notice && <p className="notice notice--success">{notice}</p>}
          <button className="btn btn--primary btn--block" disabled={busy || !supabaseConfigured}>{busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}</button>
        </form>
        <div className="divider"><span>{mode === 'login' ? 'primeira vez por aqui?' : 'já tem uma conta?'}</span></div>
        <button className="btn btn--block" type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setNotice(''); }}>{mode === 'login' ? 'Criar uma conta' : 'Voltar para o login'}</button>
      </section>
    </main>
  );
}
