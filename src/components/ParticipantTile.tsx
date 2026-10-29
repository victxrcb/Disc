import { useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import type { Participant } from '../hooks/useRoom';
import { useSpeaking } from '../hooks/useSpeaking';
import { Icon } from './Icon';
import { MediaElement } from './MediaElement';
import { usePeerVolume, VolumeControl } from './VolumeControl';
import { VolumePopover } from './VolumePopover';

const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 10;

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
  const [volume, setVolume] = usePeerVolume(name);
  const status = !isSelf && connection ? CONNECTION_LABEL[connection] : undefined;

  // Painel de volume: botão direito, toque longo (celular) ou Enter/tecla de menu.
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  const longPressAt = useRef(-Infinity);

  const openMenu = (x: number, y: number) => {
    const next = { x, y };
    setMenu(next);
    return next;
  };

  const handleContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    // Eventos do painel (portal) também sobem pela árvore do React até aqui.
    if (isSelf || !e.currentTarget.contains(e.target as Node)) return;
    e.preventDefault();
    cancelPress();
    // No Android o toque longo também dispara contextmenu; o painel já foi aberto por ele.
    if (performance.now() - longPressAt.current < 1000) return;
    // Pelo teclado (tecla de menu / Shift+F10) não há cursor: abre a partir do centro do card.
    if (e.clientX === 0 && e.clientY === 0) {
      const r = e.currentTarget.getBoundingClientRect();
      openMenu(r.left + r.width / 2, r.top + r.height / 2);
    } else {
      openMenu(e.clientX, e.clientY);
    }
  };

  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (isSelf || e.pointerType !== 'touch' || !e.currentTarget.contains(e.target as Node)) return;
    const { clientX: x, clientY: y } = e;
    cancelPress();
    press.current = {
      x,
      y,
      timer: window.setTimeout(() => {
        press.current = null;
        longPressAt.current = performance.now();
        openMenu(x, y);
      }, LONG_PRESS_MS),
    };
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > LONG_PRESS_SLOP_PX) cancelPress();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isSelf || e.target !== e.currentTarget || e.key !== 'Enter') return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    openMenu(r.left + r.width / 2, r.top + r.height / 2);
  };

  return (
    <div
      className={`tile${speaking ? ' tile--speaking' : ''}${compact ? ' tile--compact' : ''}${menu ? ' tile--menu' : ''}`}
      onContextMenu={handleContextMenu}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onKeyDown={handleKeyDown}
      tabIndex={isSelf ? undefined : 0}
      aria-haspopup={isSelf ? undefined : 'dialog'}
      aria-label={isSelf ? undefined : `${name}. Botão direito ou Enter para ajustar o volume`}
      title={isSelf ? undefined : 'Botão direito para ajustar o volume'}
    >
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
      {!isSelf && (
        <VolumeControl
          value={volume}
          onChange={setVolume}
          label={`Volume de ${name}`}
          compact
          className="tile__volume"
        />
      )}
      {menu && (
        <VolumePopover
          key={`${menu.x},${menu.y}`}
          x={menu.x}
          y={menu.y}
          name={name}
          hue={hue(id)}
          value={volume}
          onChange={setVolume}
          onClose={() => setMenu((m) => (m === menu ? null : m))}
        />
      )}
    </div>
  );
}
