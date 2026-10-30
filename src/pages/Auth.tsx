import { lazy, Suspense, useState, type FormEvent } from 'react';
import { Icon } from '../components/Icon';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { useTheme } from '../lib/theme';

const HomeScene = lazy(() => import('../components/HomeScene').catch(() => ({ default: () => null })));

type Mode = 'login' | 'signup';

/** Traduz as mensagens mais comuns do Supabase Auth para o usuário. */
function friendlyError(message: string): string {
  const text = message.toLowerCase();
  if (text.includes('invalid login credentials')) return 'E-mail, usuário ou senha inválidos.';
  if (text.includes('email not confirmed')) return 'Confirme seu e-mail antes de entrar.';
  if (text.includes('already registered')) return 'Este e-mail já tem uma conta. Tente entrar.';
  if (text.includes('rate limit') || text.includes('too many')) return 'Muitas tentativas. Aguarde um pouco e tente de novo.';
  if (text.includes('failed to fetch') || text.includes('network')) return 'Sem conexão com o servidor. Verifique sua internet.';
  return message;
}

export function AuthPage() {
  const { theme } = useTheme();
  const [mode, setMode] = useState<Mode>('login');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24);

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next); setError(''); setNotice(''); setShowPassword(false);
  };

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
      setError(friendlyError(err instanceof Error ? err.message : 'Não foi possível continuar.'));
    } finally { setBusy(false); }
  };

  const isLogin = mode === 'login';

  return (
    <main className={`home auth${theme === 'default' ? '' : ' home--themed'}`}>
      {theme === 'default' && <Suspense fallback={null}><HomeScene /></Suspense>}
      <p className="home__wordmark">Discord<br />2.0</p>

      <section className="home__card auth-card" aria-labelledby="auth-title">
        <div className="download-card__eyebrow">
          <span className="download-card__dot" /> {isLogin ? 'Sua galera está esperando' : 'Primeira vez por aqui'}
        </div>
        <h1 id="auth-title" className="home__title">{isLogin ? 'Boas-vindas de volta.' : 'Crie seu perfil.'}</h1>
        <p className="home__lead">{isLogin ? 'Entre para encontrar seus amigos e continuar a resenha.' : 'Escolha como seus amigos vão encontrar você.'}</p>

        <div className="auth-tabs" role="group" aria-label="Entrar ou criar conta">
          <button type="button" className={isLogin ? 'is-active' : ''} aria-pressed={isLogin} onClick={() => switchMode('login')}>Entrar</button>
          <button type="button" className={!isLogin ? 'is-active' : ''} aria-pressed={!isLogin} onClick={() => switchMode('signup')}>Criar conta</button>
        </div>

        {!supabaseConfigured && <p className="notice notice--error">Configure o Supabase para usar contas.</p>}

        <form onSubmit={submit} className="auth-form">
          {!isLogin && (
            <div className="auth-form__row">
              <label className="field">
                <span className="field__label">Nome de usuário</span>
                <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="seu_usuario" maxLength={24} autoComplete="username" autoFocus required />
                {username && <span className="auth-hint">Seus amigos vão te achar como <strong>@{cleanUsername || '…'}</strong></span>}
              </label>
              <label className="field">
                <span className="field__label">Nome de exibição</span>
                <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Como te chamam" maxLength={32} required />
              </label>
            </div>
          )}
          <label className="field">
            <span className="field__label">{isLogin ? 'E-mail ou nome de usuário' : 'E-mail'}</span>
            <input
              key={mode}
              className="input"
              type={isLogin ? 'text' : 'email'}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={isLogin ? 'voce@email.com ou seu_usuario' : 'voce@email.com'}
              autoComplete={isLogin ? 'username' : 'email'}
              autoFocus={isLogin}
              required
            />
          </label>
          <label className="field">
            <span className="field__label">Senha</span>
            <span className="auth-password">
              <input
                className="input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isLogin ? 'Sua senha' : 'Mínimo de 6 caracteres'}
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                minLength={6}
                required
              />
              <button type="button" className="auth-password__toggle" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'} title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>
                <Icon name={showPassword ? 'eyeOff' : 'eye'} size={16} />
              </button>
            </span>
          </label>
          {error && <p className="notice notice--error" role="alert">{error}</p>}
          {notice && <p className="notice notice--success" role="status">{notice}</p>}
          <button className="btn btn--primary btn--block auth-submit" disabled={busy || !supabaseConfigured}>
            {busy ? <><span className="auth-spinner" aria-hidden="true" />{isLogin ? 'Entrando…' : 'Criando conta…'}</> : isLogin ? 'Entrar' : 'Criar conta'}
          </button>
        </form>

        <p className="auth-footnote">
          {isLogin ? 'Sua sessão fica salva neste dispositivo.' : 'Você pode trocar foto, nome e tema depois, no seu perfil.'}
        </p>
      </section>
    </main>
  );
}
