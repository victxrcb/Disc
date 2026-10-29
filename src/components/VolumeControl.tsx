import { useEffect, useRef, useState } from 'react';
import { getAudioContext } from '../lib/audio';
import { clampVolume, loadPeerVolume, MAX_VOLUME, savePeerVolume } from '../lib/peerVolume';
import { Icon } from './Icon';

/** Volume (0–2) persistido por chave; recarrega se a chave mudar. */
export function usePeerVolume(storageKey: string) {
  const [volume, setVolume] = useState(() => loadPeerVolume(storageKey));

  useEffect(() => {
    setVolume(loadPeerVolume(storageKey));
  }, [storageKey]);

  const change = (v: number) => {
    const next = clampVolume(v);
    setVolume(next);
    savePeerVolume(storageKey, next);
    getAudioContext(); // gesto do usuário: libera o AudioContext para amplificar acima de 100%
  };

  return [volume, change] as const;
}

interface Props {
  value: number;
  onChange(v: number): void;
  /** Ex.: "Volume de Ana". */
  label: string;
  /** Só o botão de silenciar, sem slider. */
  compact?: boolean;
  max?: number;
  className?: string;
}

export function VolumeControl({ value, onChange, label, compact = false, max = MAX_VOLUME, className = '' }: Props) {
  // Volume a restaurar ao reativar o áudio silenciado.
  const lastAudible = useRef(value || 1);
  if (value > 0) lastAudible.current = value;
  const percent = Math.round(value * 100);

  return (
    <div
      className={`volume${value !== 1 ? ' volume--changed' : ''}${compact ? ' volume--compact' : ''}${max === MAX_VOLUME ? '' : ' volume--plain'} ${className}`}
      role="group"
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="volume__toggle"
        onClick={() => onChange(value === 0 ? lastAudible.current : 0)}
        aria-pressed={value === 0}
        aria-label={value === 0 ? 'Reativar áudio' : 'Silenciar para você'}
        title={value === 0 ? 'Reativar áudio' : 'Silenciar para você'}
      >
        <Icon name={value === 0 ? 'volumeOff' : 'volume'} size={16} />
      </button>
      {!compact && (
        <>
          <input
            type="range"
            className="volume__slider"
            min={0}
            max={max}
            step={0.05}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            onDoubleClick={() => onChange(1)}
            aria-label={label}
            aria-valuetext={`${percent}%`}
            title="Duplo clique volta para 100%"
            style={{ ['--fill' as string]: `${(value / max) * 100}%` }}
          />
          <button
            type="button"
            className="volume__value"
            onClick={() => onChange(1)}
            disabled={value === 1}
            title="Voltar para 100%"
            aria-label="Voltar volume para 100%"
          >
            {percent}%
          </button>
        </>
      )}
    </div>
  );
}
