import type { MicMeter, MicSettings } from '../lib/mic';
import { QUALITY_PRESETS, type QualityId } from '../lib/quality';
import type { Sound } from '../lib/soundpad';
import { Icon } from './Icon';
import { MicMenu } from './MicMenu';
import { Soundpad } from './Soundpad';

interface Props {
  muted: boolean;
  micAvailable: boolean;
  micSettings: MicSettings;
  micGainSupported: boolean;
  micGateSupported: boolean;
  getMicMeter(): MicMeter;
  onMicChange(patch: Partial<MicSettings>): Promise<string | null>;
  sharing: boolean;
  quality: QualityId;
  chatOpen: boolean;
  unread: number;
  onToggleMute(): void;
  onToggleShare(): void;
  onQualityChange(id: QualityId): void;
  onToggleChat(): void;
  onPlaySound(sound: Sound): void;
  onLeave(): void;
}

export function Controls(props: Props) {
  const { muted, micAvailable, sharing, quality, chatOpen, unread } = props;
  return (
    <div className="controls">
      <MicMenu
        muted={muted}
        micAvailable={micAvailable}
        settings={props.micSettings}
        gainSupported={props.micGainSupported}
        gateSupported={props.micGateSupported}
        getMeter={props.getMicMeter}
        onToggleMute={props.onToggleMute}
        onChange={props.onMicChange}
      />

      <div className="ctrl-group">
        <button
          className={`ctrl${sharing ? ' ctrl--active' : ''}`}
          onClick={props.onToggleShare}
          title={sharing ? 'Parar de compartilhar' : 'Compartilhar tela com áudio'}
        >
          <span className="ctrl__icon" key={sharing ? 'on' : 'off'}>
            <Icon name={sharing ? 'screenOff' : 'screen'} />
          </span>
          <span className="ctrl__label">{sharing ? 'Parar' : 'Compartilhar'}</span>
        </button>
        <select
          className="quality"
          value={quality}
          onChange={(e) => props.onQualityChange(e.target.value as QualityId)}
          title="Qualidade da transmissão (pode trocar durante o compartilhamento)"
          aria-label="Qualidade da transmissão"
        >
          {Object.values(QUALITY_PRESETS).map((q) => (
            <option key={q.id} value={q.id}>
              {q.label}
            </option>
          ))}
        </select>
      </div>

      <Soundpad onPlay={props.onPlaySound} />

      {/* No mobile o ChatPanel tem o próprio botão flutuante; este fica só no desktop. */}
      <button
        className={`ctrl ctrl--chat${chatOpen ? ' ctrl--active' : ''}`}
        onClick={props.onToggleChat}
        aria-pressed={chatOpen}
        title="Chat"
      >
        <span className="ctrl__icon">
          <Icon name="chat" />
        </span>
        <span className="ctrl__label">Chat</span>
        {unread > 0 && !chatOpen && (
          <span className="badge" key={unread}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      <button className="ctrl ctrl--danger" onClick={props.onLeave} title="Sair da chamada">
        <span className="ctrl__icon">
          <Icon name="leave" />
        </span>
        <span className="ctrl__label">Sair</span>
      </button>
    </div>
  );
}
