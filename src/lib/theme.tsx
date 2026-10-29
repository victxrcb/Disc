import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type AppTheme = 'default' | 'queen' | 'celestial';

export const THEME_OPTIONS: ReadonlyArray<{ id: AppTheme; label: string; description: string }> = [
  { id: 'default', label: 'Castelo', description: 'O visual original do Discord 2.0' },
  { id: 'queen', label: 'Rainha', description: 'Retrato sombrio em preto e branco' },
  { id: 'celestial', label: 'Véu celeste', description: 'Céu animado em movimento' },
];

const STORAGE_KEY = 'discord2:theme';

interface ThemeContextValue {
  theme: AppTheme;
  setTheme(theme: AppTheme): void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function loadTheme(): AppTheme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return THEME_OPTIONS.some((option) => option.id === saved) ? saved as AppTheme : 'default';
  } catch {
    return 'default';
  }
}

function saveTheme(theme: AppTheme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // O tema ainda funciona na sessão quando o armazenamento estiver bloqueado.
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>(loadTheme);

  const setTheme = (nextTheme: AppTheme) => {
    setThemeState(nextTheme);
    saveTheme(nextTheme);
  };

  useEffect(() => {
    document.documentElement.dataset.appTheme = theme;
    return () => { delete document.documentElement.dataset.appTheme; };
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      <div className={`theme-shell theme-shell--${theme}`}>
        <div className="theme-backdrop" aria-hidden="true">
          {theme === 'queen' && <img src="/themes/queen.png" alt="" draggable={false} />}
          {theme === 'celestial' && (
            <video src="/themes/celestial-veil.mp4" autoPlay muted loop playsInline preload="auto" />
          )}
        </div>
        <div className="theme-content">{children}</div>
      </div>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme precisa estar dentro de ThemeProvider');
  return value;
}
