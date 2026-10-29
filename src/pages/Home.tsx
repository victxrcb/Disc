import { lazy, Suspense, useState, type FormEvent } from 'react';
import { generateRoomCode, isValidRoomCode, normalizeRoomCode, CODE_LENGTH } from '../lib/roomCode';
import { supabaseConfigured } from '../lib/supabase';
import { useTheme } from '../lib/theme';
import { ThemePicker } from '../components/ThemePicker';

interface Props {
  initialCode: string;
  initialName: string;
  onJoin(code: string, name: string): void;
}

const HomeScene = lazy(() => import('../components/HomeScene').catch(() => ({ default: () => null })));
const MAX_NAME = 32;

export function Home({ initialCode, initialName, onJoin }: Props) {
  const { theme } = useTheme();
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(initialCode);
  const [touched, setTouched] = useState(false);

  const cleanName = name.trim().slice(0, MAX_NAME);
  const nameMissing = touched && !cleanName;
  const codeValid = isValidRoomCode(code);

  const create = () => {
    setTouched(true);
    if (cleanName) onJoin(generateRoomCode(), cleanName);
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (cleanName && codeValid) onJoin(code, cleanName);
  };

  return (
    <main className={`home${theme === 'default' ? '' : ' home--themed'}`}>
      {theme === 'default' && <Suspense fallback={null}><HomeScene /></Suspense>}
      <p className="home__wordmark">
        Discord<br />2.0
      </p>
      <div className="home__card">
        <h1 className="home__title">Chama a galera, sem cadastro.</h1>
        <p className="home__lead">
          Crie uma chamada, mande o código para os amigos e pronto: voz, tela compartilhada com áudio e chat, direto no
          navegador.
        </p>

        <ThemePicker />

        {!supabaseConfigured && (
          <p className="notice notice--error">
            Configuração ausente: defina <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> (veja{' '}
            <code>.env.example</code>).
          </p>
        )}

        <label className="field">
          <span className="field__label">Seu apelido</span>
          <input
            className={`input${nameMissing ? ' input--invalid' : ''}`}
            value={name}
            maxLength={MAX_NAME}
            onChange={(e) => setName(e.target.value)}
            placeholder="Como seus amigos te chamam"
            autoComplete="nickname"
            autoFocus={!initialName}
          />
          {nameMissing && <span className="field__error">Digite um apelido para entrar.</span>}
        </label>

        {!initialCode && (
          <>
            <button type="button" className="btn btn--primary btn--block" onClick={create} disabled={!supabaseConfigured}>
              Criar nova chamada
            </button>
            <div className="divider">
              <span>ou entre com um código</span>
            </div>
          </>
        )}

        <form className="join" onSubmit={join}>
          <input
            className="input input--code"
            value={code}
            onChange={(e) => setCode(normalizeRoomCode(e.target.value))}
            placeholder="CÓDIGO"
            maxLength={CODE_LENGTH}
            aria-label="Código da chamada"
            autoCapitalize="characters"
            spellCheck={false}
          />
          <button
            type="submit"
            className={`btn${initialCode ? ' btn--primary' : ''}`}
            disabled={!codeValid || !supabaseConfigured}
          >
            Entrar
          </button>
        </form>
      </div>
    </main>
  );
}
