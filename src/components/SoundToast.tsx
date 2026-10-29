import { useEffect, useRef, useState } from 'react';
import { addSoundToLibrary, SoundError } from '../lib/soundpad';
import type { SoundEvent } from '../webrtc/signaling';
import { Icon } from './Icon';

const VISIBLE_MS = 5000;
const EXIT_MS = 200;

type SaveState = 'idle' | 'added' | 'duplicate' | 'error';

interface Props {
  sound: SoundEvent;
  fromSelf: boolean;
  /** Chamado quando o aviso termina de sair. */
  onDone(): void;
}

/**
 * Aviso "Fulano tocou X". Some sozinho (pausa com o mouse em cima);
 * o "+" guarda o som no soundpad de quem ouviu.
 */
export function SoundToast({ sound, fromSelf, onDone }: Props) {
  const [leaving, setLeaving] = useState(false);
  const [saved, setSaved] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const remaining = useRef(VISIBLE_MS);

  // Conta só o tempo sem o mouse em cima; ao zerar, anima a saída e desmonta.
  useEffect(() => {
    if (hovered || leaving) return;
    const startedAt = Date.now();
    const timer = window.setTimeout(() => setLeaving(true), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(1500, remaining.current - (Date.now() - startedAt));
    };
  }, [hovered, leaving]);

  // Em ref: o pai recria onDone a cada render, o que reiniciaria o timer de saída.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => onDoneRef.current(), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  const save = () => {
    try {
      setSaved(addSoundToLibrary({ name: sound.name, data: sound.data, duration: sound.duration }));
      setError(null);
    } catch (err) {
      setSaved('error');
      setError(err instanceof SoundError ? err.message : 'Não foi possível salvar o som.');
    }
  };

  const label =
    saved === 'added' ? 'Adicionado ao seu soundpad' : saved === 'duplicate' ? 'Já está no seu soundpad' : null;

  return (
    <div
      className={`sound-toast${leaving ? ' sound-toast--leaving' : ''}`}
      role="status"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      <Icon name="soundpad" size={16} />
      <span className="sound-toast__text">
        {error ?? label ?? (
          <>
            <strong>{fromSelf ? 'Você' : sound.by}</strong> tocou “{sound.name}”
          </>
        )}
      </span>
      {!fromSelf && (
        <button
          type="button"
          className={`sound-toast__add${saved === 'added' || saved === 'duplicate' ? ' is-done' : ''}`}
          onClick={save}
          disabled={saved === 'added' || saved === 'duplicate'}
          aria-label={`Adicionar “${sound.name}” ao meu soundpad`}
          title="Adicionar ao meu soundpad"
        >
          <span className="sound-toast__add-icon" key={saved}>
            <Icon name={saved === 'added' || saved === 'duplicate' ? 'check' : 'plus'} size={16} />
          </span>
        </button>
      )}
    </div>
  );
}
