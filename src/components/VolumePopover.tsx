import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { VolumeControl } from './VolumeControl';

const EDGE = 8;
const EXIT_MS = 160;
const PRESETS = [0.5, 1, 1.5, 2];

interface Props {
  /** Ponto (coordenadas da janela) onde o painel abre, normalmente o cursor. */
  x: number;
  y: number;
  name: string;
  hue: number;
  value: number;
  onChange(v: number): void;
  onClose(): void;
}

/**
 * Painel flutuante de volume aberto pelo botão direito no card.
 * Fica num portal em <body>: o card usa transform no hover, o que quebraria position: fixed.
 */
export function VolumePopover({ x, y, name, hue, value, onChange, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; origin: string } | null>(null);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);

  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    window.setTimeout(onClose, EXIT_MS);
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  // Mantém o painel inteiro na tela; a animação nasce do canto mais próximo do cursor.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { offsetWidth: w, offsetHeight: h } = el;
    const flipX = x + w + EDGE > window.innerWidth;
    const flipY = y + h + EDGE > window.innerHeight;
    const left = Math.max(EDGE, flipX ? x - w : x);
    const top = Math.max(EDGE, flipY ? y - h : y);
    setPos({ left, top, origin: `${flipX ? 'right' : 'left'} ${flipY ? 'bottom' : 'top'}` });
  }, [x, y]);

  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>('input[type="range"]')?.focus({ preventScroll: true });

    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    const onDismiss = () => closeRef.current();
    // Botão direito fora do painel já fecha pelo pointerdown; dentro dele, sem menu do navegador.
    const onContextMenu = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) e.preventDefault();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('contextmenu', onContextMenu, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onDismiss);
    window.addEventListener('blur', onDismiss);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('contextmenu', onContextMenu, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onDismiss);
      window.removeEventListener('blur', onDismiss);
    };
  }, []);

  const percent = Math.round(value * 100);
  const style = {
    left: pos?.left ?? x,
    top: pos?.top ?? y,
    transformOrigin: pos?.origin,
    visibility: pos ? undefined : 'hidden',
    '--h': hue,
  } as CSSProperties;

  return createPortal(
    <div
      ref={ref}
      className={`volume-pop${closing ? ' volume-pop--closing' : ''}${value > 1 ? ' volume-pop--boost' : ''}${value === 0 ? ' volume-pop--muted' : ''}`}
      style={style}
      role="dialog"
      aria-label={`Volume de ${name}`}
    >
      <div className="volume-pop__head">
        <span className="volume-pop__avatar" aria-hidden="true">
          {name.trim().charAt(0).toUpperCase() || '?'}
        </span>
        <span className="volume-pop__titles">
          <span className="volume-pop__name">{name}</span>
          <span className="volume-pop__hint">Volume só para você</span>
        </span>
        <span className="volume-pop__percent" aria-hidden="true">
          {percent}%
        </span>
      </div>

      <VolumeControl value={value} onChange={onChange} label={`Volume de ${name}`} className="volume-pop__control" />

      <div className="volume-pop__presets">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            className={`volume-pop__preset${Math.abs(value - p) < 0.001 ? ' is-active' : ''}`}
            onClick={() => onChange(p)}
          >
            {Math.round(p * 100)}%
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
