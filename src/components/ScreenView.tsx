import { useRef, useState } from 'react';
import type { Participant } from '../hooks/useRoom';
import { Icon } from './Icon';
import { MediaElement } from './MediaElement';

interface Props {
  participant: Participant;
  focused: boolean;
  onFocus?: () => void;
}

export function ScreenView({ participant, focused, onFocus }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [volume, setVolume] = useState(1);
  const stream = participant.screenStream;
  const hasAudio = (stream?.getAudioTracks().length ?? 0) > 0;

  const fullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  return (
    <div
      ref={wrapRef}
      className={`screen${focused ? ' screen--focused' : ' screen--thumb'}`}
      onClick={focused ? undefined : onFocus}
      role={focused ? undefined : 'button'}
      tabIndex={focused ? undefined : 0}
      onKeyDown={(e) => {
        if (!focused && (e.key === 'Enter' || e.key === ' ')) onFocus?.();
      }}
    >
      {/* O próprio compartilhamento fica mudo localmente para não gerar eco. */}
      <MediaElement kind="video" stream={stream} muted={participant.isSelf} volume={volume} className="screen__video" />
      <div className="screen__bar">
        <span className="screen__who">
          <Icon name="screen" size={16} /> {participant.isSelf ? 'Sua tela' : `Tela de ${participant.name}`}
        </span>
        {focused && (
          <span className="screen__actions">
            {!participant.isSelf && hasAudio && (
              <label className="screen__volume" title="Volume do áudio da tela">
                <Icon name="volume" size={16} />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  aria-label="Volume do áudio da tela"
                />
              </label>
            )}
            <button className="icon-btn" onClick={fullscreen} title="Tela cheia" aria-label="Tela cheia">
              <Icon name="expand" />
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
