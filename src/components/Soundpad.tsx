import { useEffect, useRef, useState } from 'react';
import {
  loadEffectsVolume,
  loadSounds,
  MAX_SOUNDS,
  saveEffectsVolume,
  saveSounds,
  SOUNDS_CHANGED_EVENT,
  SoundError,
  type Sound,
} from '../lib/soundpad';
import { Icon } from './Icon';
import { SoundEditor } from './SoundEditor';
import { VolumeControl } from './VolumeControl';

const EXIT_MS = 160;

interface Props {
  onPlay(sound: Sound): void;
}

/** Botão "Soundpad" da barra de controles + painel com os sons do usuário. */
export function Soundpad({ onPlay }: Props) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [sounds, setSounds] = useState<Sound[]>(loadSounds);
  const [volume, setVolume] = useState(loadEffectsVolume);
  const [error, setError] = useState<string | null>(null);
  const [pressed, setPressed] = useState<{ id: string; key: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  const close = () => {
    if (!open || closing) return;
    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
      setEditing(false);
      setError(null);
    }, EXIT_MS);
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  // Sons salvos pelo "+" do aviso entram na lista mesmo com o painel aberto.
  useEffect(() => {
    const reload = () => setSounds(loadSounds());
    window.addEventListener(SOUNDS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(SOUNDS_CHANGED_EVENT, reload);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    if (open) return close();
    window.clearTimeout(closeTimer.current);
    setClosing(false);
    setSounds(loadSounds()); // outra aba pode ter mudado a biblioteca
    setOpen(true);
  };

  const persist = (next: Sound[]) => {
    try {
      saveSounds(next);
      setSounds(next);
      setError(null);
      return true;
    } catch (err) {
      setError(err instanceof SoundError ? err.message : 'Não foi possível salvar.');
      return false;
    }
  };

  const changeVolume = (v: number) => {
    setVolume(v);
    saveEffectsVolume(v);
  };

  const play = (sound: Sound) => {
    onPlay(sound);
    setPressed({ id: sound.id, key: Date.now() });
  };

  const full = sounds.length >= MAX_SOUNDS;

  return (
    <div className="soundpad" ref={wrapRef}>
      <button
        type="button"
        className={`ctrl${open && !closing ? ' ctrl--active' : ''}`}
        onClick={toggle}
        aria-expanded={open && !closing}
        aria-haspopup="dialog"
        title="Soundpad"
      >
        <span className="ctrl__icon">
          <Icon name="soundpad" />
        </span>
        <span className="ctrl__label">Soundpad</span>
      </button>

      {open && (
        <div
          className={`soundpad__panel${closing ? ' soundpad__panel--closing' : ''}`}
          role="dialog"
          aria-label="Soundpad"
        >
          <header className="soundpad__head">
            <h3>{editing ? 'Adicionar som' : 'Soundpad'}</h3>
            {!editing && <span className="soundpad__count">{sounds.length}/{MAX_SOUNDS}</span>}
            <button type="button" className="icon-btn" onClick={close} aria-label="Fechar soundpad">
              <Icon name="close" />
            </button>
          </header>

          {editing ? (
            <SoundEditor
              onCancel={() => setEditing(false)}
              onSave={(sound) => {
                if (persist([...loadSounds(), sound].slice(0, MAX_SOUNDS))) setEditing(false);
              }}
            />
          ) : (
            <>
              <div className="soundpad__volume">
                <span>Volume dos efeitos</span>
                <VolumeControl value={volume} onChange={changeVolume} max={1} label="Volume dos efeitos sonoros" />
              </div>

              <div className="soundpad__grid">
                {sounds.map((s) => (
                  <div key={s.id} className="soundpad__item">
                    <button
                      type="button"
                      className="soundpad__sound"
                      onClick={() => play(s)}
                      title={`Tocar “${s.name}” para todos${s.duration ? ` (${s.duration.toFixed(1).replace('.', ',')}s)` : ''}`}
                    >
                      {pressed?.id === s.id && <span key={pressed.key} className="soundpad__ripple" aria-hidden="true" />}
                      <Icon name="play" size={16} />
                      <span className="soundpad__name">{s.name}</span>
                    </button>
                    <button
                      type="button"
                      className="soundpad__remove"
                      onClick={() => persist(sounds.filter((x) => x.id !== s.id))}
                      aria-label={`Apagar som ${s.name}`}
                      title="Apagar som"
                    >
                      <Icon name="close" size={16} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="soundpad__add"
                  onClick={() => setEditing(true)}
                  disabled={full}
                  title={full ? `Limite de ${MAX_SOUNDS} sons` : 'Adicionar som'}
                >
                  <Icon name="plus" size={16} />
                  {full ? 'Limite atingido' : 'Adicionar som'}
                </button>
              </div>

              {sounds.length === 0 && (
                <p className="soundpad__empty">Adicione um áudio de até 10 segundos. Ao clicar, todos da chamada ouvem.</p>
              )}
              {error && <p className="soundpad__error">{error}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
