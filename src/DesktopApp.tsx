import { useEffect, useState } from 'react';
import { isValidRoomCode, normalizeRoomCode } from './lib/roomCode';
import { loadString, saveString } from './lib/storage';
import { Home } from './pages/Home';
import { Room } from './pages/Room';
import { ThemeProvider } from './lib/theme';

const NAME_KEY = 'resenha:name';

type Route = { page: 'home'; code: string } | { page: 'room'; code: string; name: string };

function codeFromPath(): string {
  const code = normalizeRoomCode(window.location.pathname.slice(1));
  return isValidRoomCode(code) ? code : '';
}

function DesktopRoutes() {
  // A tela inicial preserva o gesto que libera microfone e reproducao de audio.
  const [route, setRoute] = useState<Route>(() => ({ page: 'home', code: codeFromPath() }));

  useEffect(() => {
    const onPop = () => setRoute({ page: 'home', code: codeFromPath() });
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  if (route.page === 'room') {
    return (
      <Room
        key={route.code}
        code={route.code}
        name={route.name}
        onLeave={() => {
          window.history.pushState(null, '', '/');
          setRoute({ page: 'home', code: '' });
        }}
      />
    );
  }

  return (
    <Home
      key={route.code}
      initialCode={route.code}
      initialName={loadString(NAME_KEY)}
      onJoin={(code, name) => {
        saveString(NAME_KEY, name);
        if (window.location.pathname !== `/${code}`) window.history.pushState(null, '', `/${code}`);
        setRoute({ page: 'room', code, name });
      }}
    />
  );
}

export default function DesktopApp() {
  return (
    <ThemeProvider>
      <DesktopRoutes />
    </ThemeProvider>
  );
}
