import { THEME_OPTIONS, useTheme } from '../lib/theme';

export function ThemePicker({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();

  return (
    <div className={`theme-picker${compact ? ' theme-picker--compact' : ''}`}>
      {!compact && <span className="theme-picker__label">Tema do aplicativo</span>}
      <div className="theme-picker__options" role="radiogroup" aria-label="Tema do aplicativo">
        {THEME_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`theme-option theme-option--${option.id}${theme === option.id ? ' is-active' : ''}`}
            role="radio"
            aria-checked={theme === option.id}
            aria-label={`${option.label}: ${option.description}`}
            title={option.description}
            onClick={() => setTheme(option.id)}
          >
            <span className="theme-option__preview" aria-hidden="true" />
            <span className="theme-option__name">{option.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
