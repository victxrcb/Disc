import { useEffect, useState } from 'react';
import { isValidRoomCode, normalizeRoomCode } from './lib/roomCode';
import { Room } from './pages/Room';
import { ThemeProvider } from './lib/theme';
import { AuthProvider, useAuth } from './lib/auth';
import { AuthPage } from './pages/Auth';
import { Dashboard } from './pages/Dashboard';
import { useTheme } from './lib/theme';
import { UpdateCenter } from './components/UpdateCenter';
import { PresenceProvider } from './lib/presence';
import { ErrorBoundary } from './components/ErrorBoundary';

type Route = { page: 'home'; code: string } | { page: 'room'; code: string };

function codeFromPath(): string {
  const code = normalizeRoomCode(window.location.pathname.slice(1));
  return isValidRoomCode(code) ? code : '';
}

function DesktopRoutes() {
  const { user, profile, loading, signOut } = useAuth();
  const { setTheme } = useTheme();
  const [route, setRoute] = useState<Route>(() => ({ page: 'home', code: codeFromPath() }));

  useEffect(() => {
    const onPop = () => setRoute({ page: 'home', code: codeFromPath() });
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (profile?.theme) setTheme(profile.theme);
  }, [profile?.theme]);

  if (loading) return <main className="app-loading"><div className="spinner" /><p>Carregando…</p></main>;
  if (!user) return <AuthPage />;
  if (!profile) return <main className="app-loading"><p>Não foi possível carregar seu perfil. Aplique a migração do Supabase e entre novamente.</p><button className="btn" onClick={() => void signOut()}>Sair</button></main>;

  if (route.page === 'room' && profile) {
    return (
      <Room
        key={route.code}
        code={route.code}
        name={profile.display_name}
        avatarUrl={profile.avatar_url}
        onLeave={() => {
          window.history.pushState(null, '', '/');
          setRoute({ page: 'home', code: '' });
        }}
      />
    );
  }

  return (
    <Dashboard
      initialCode={route.code}
      onJoin={(code) => {
        if (window.location.pathname !== `/${code}`) window.history.pushState(null, '', `/${code}`);
        setRoute({ page: 'room', code });
      }}
    />
  );
}

export default function DesktopApp() {
  return (
    <ThemeProvider>
      <AuthProvider><PresenceProvider><ErrorBoundary area="o app"><DesktopRoutes /></ErrorBoundary></PresenceProvider></AuthProvider>
      <UpdateCenter />
    </ThemeProvider>
  );
}
