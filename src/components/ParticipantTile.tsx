import { useState } from 'react';
import type { Participant } from '../hooks/useRoom';
import { useSpeaking } from '../hooks/useSpeaking';
import { Icon } from './Icon';
import { MediaElement } from './MediaElement';

const CONNECTION_LABEL: Partial<Record<RTCPeerConnectionState, string>> = {
  new: 'conectando…',
  connecting: 'conectando…',
  disconnected: 'instável…',
  failed: 'sem conexão',
};

function hue(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function ParticipantTile({ participant, compact = false }: { participant: Participant; compact?: boolean }) {
  const { name, isSelf, muted, micStream, connection, id } = participant;
  const speaking = useSpeaking(micStream, !muted);
  const [volume, setVolume] = useState(1);
  const status = !isSelf && connection ? CONNECTION_LABEL[connection] : undefined;

  return (
    <div className={`tile${speaking ? ' tile--speaking' : ''}${compact ? ' tile--compact' : ''}`}>
      {!isSelf && <MediaElement kind="audio" stream={micStream} volume={volume} />}
      <div className="tile__avatar" style={{ ['--h' as string]: hue(id) }}>
        {name.trim().charAt(0).toUpperCase() || '?'}
      </div>
      <div className="tile__name">
        <span className="tile__label">{name}{isSelf && ' (você)'}</span>
        {muted && (
          <span className="tile__muted" title="Microfone desligado">
            <Icon name="micOff" size={16} />
          </span>
        )}
      </div>
      {status && <div className="tile__status">{status}</div>}
      {!isSelf && !compact && (
        <label className="tile__volume" title="Volume deste participante">
          <Icon name="volume" size={16} />
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            aria-label={`Volume de ${name}`}
          />
        </label>
      )}
    </div>
  );
}
