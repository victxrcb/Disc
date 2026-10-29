import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Participant } from '../hooks/useRoom';
import { Icon } from './Icon';
import { MediaElement } from './MediaElement';
import { usePeerVolume, VolumeControl } from './VolumeControl';

interface Props {
  participant: Participant;
  focused: boolean;
  onFocus?: () => void;
}

const KEY_STEP = 0.1;

/** true se o stream tem faixa de áudio; acompanha faixas que chegam depois. */
function useHasAudio(stream: MediaStream | null): boolean {
  const [hasAudio, setHasAudio] = useState(false);
  useEffect(() => {
    if (!stream) {
      setHasAudio(false);
      return;
    }
    const update = () => setHasAudio(stream.getAudioTracks().length > 0);
    update();
    stream.addEventListener('addtrack', update);
    stream.addEventListener('removetrack', update);
    return () => {
      stream.removeEventListener('addtrack', update);
      stream.removeEventListener('removetrack', update);
    };
  }, [stream]);
  return hasAudio;
}

export function ScreenView({ participant, focused, onFocus }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [volume, setVolume] = usePeerVolume(`tela:${participant.name}`);
  // Clicar na tela em destaque fixa a barra com o controle de volume (útil sem mouse/hover).
  const [panelOpen, setPanelOpen] = useState(false);
  const stream = participant.screenStream;
  const hasAudio = useHasAudio(stream);
  const canAdjust = focused && !participant.isSelf;

  useEffect(() => {
    if (!focused) setPanelOpen(false);
  }, [focused]);

  const fullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  const handleClick = () => {
    if (!focused) onFocus?.();
    else if (canAdjust) setPanelOpen((open) => !open);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!focused) {
      if (e.key === 'Enter' || e.key === ' ') onFocus?.();
      return;
    }
    // Só quando o foco está na própria tela: o slider já trata as setas sozinho.
    if (!canAdjust || !hasAudio || e.target !== e.currentTarget) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') setVolume(volume + KEY_STEP);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') setVolume(volume - KEY_STEP);
    else if (e.key === 'm' || e.key === 'M') setVolume(volume === 0 ? 1 : 0);
    else if (e.key === 'Enter' || e.key === ' ') setPanelOpen((open) => !open);
    else return;
    e.preventDefault();
    setPanelOpen(true);
  };

  return (
    <div
      ref={wrapRef}
      className={`screen${focused ? ' screen--focused' : ' screen--thumb'}${panelOpen ? ' screen--panel' : ''}`}
      onClick={handleClick}
      role={focused ? (canAdjust ? 'group' : undefined) : 'button'}
      tabIndex={focused && !canAdjust ? undefined : 0}
      aria-label={
        focused
          ? canAdjust
            ? `Tela de ${participant.name}. Clique para ajustar o volume; setas ↑ e ↓ mudam o volume.`
            : undefined
          : `Ver tela de ${participant.name}`
      }
      onKeyDown={handleKeyDown}
    >
      {/* O próprio compartilhamento fica mudo localmente para não gerar eco. */}
      <MediaElement kind="video" stream={stream} muted={participant.isSelf} volume={volume} className="screen__video" />
      {/* Na miniatura, clicar na barra também destaca; no palco, a barra não fecha o painel. */}
      <div className="screen__bar" onClick={focused ? (e) => e.stopPropagation() : undefined}>
        <span className="screen__who">
          <Icon name="screen" size={16} /> {participant.isSelf ? 'Sua tela' : `Tela de ${participant.name}`}
        </span>
        {focused && (
          <span className="screen__actions">
            {canAdjust &&
              (hasAudio ? (
                <VolumeControl
                  value={volume}
                  onChange={setVolume}
                  label="Volume da transmissão"
                  className="screen__volume"
                />
              ) : (
                <span className="screen__no-audio" title="Quem compartilha precisa marcar “Compartilhar áudio” ao escolher a tela">
                  <Icon name="volumeOff" size={16} /> Sem áudio
                </span>
              ))}
            <button className="icon-btn" onClick={fullscreen} title="Tela cheia" aria-label="Tela cheia">
              <Icon name="expand" />
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
