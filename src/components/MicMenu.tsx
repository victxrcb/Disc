import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useAudioInputs } from '../hooks/useAudioInputs';
import {
  DEFAULT_MIC_SETTINGS,
  MAX_MIC_GAIN,
  METER_MAX_DB,
  METER_MIN_DB,
  MIN_MIC_GAIN,
  type GateMode,
  type MicMeter,
  type MicSettings,
} from '../lib/mic';
import { Icon } from './Icon';

const EXIT_MS = 160;
const EDGE = 8;
const SPAN = METER_MAX_DB - METER_MIN_DB;

interface Props {
  muted: boolean;
  micAvailable: boolean;
  settings: MicSettings;
  gainSupported: boolean;
  gateSupported: boolean;
  getMeter(): MicMeter;
  onToggleMute(): void;
  onChange(patch: Partial<MicSettings>): Promise<string | null>;
}

const MODES: { id: GateMode; label: string }[] = [
  { id: 'off', label: 'Desligada' },
  { id: 'auto', label: 'Automática' },
  { id: 'manual', label: 'Manual' },
];

const MODE_HINTS: Record<GateMode, string> = {
  off: 'Envia tudo que o microfone captar, inclusive ruídos de fundo.',
  auto: 'O app descobre o ruído do seu ambiente e só transmite quando você fala.',
  manual: 'Arraste a marca branca: o que ficar abaixo dela não sai na chamada. Fale e ajuste até a barra passar da marca só quando for a sua voz.',
};

const TOGGLES = [
  { key: 'noiseSuppression', label: 'Supressão de ruído', hint: 'Filtra teclado, ventilador e fundo.' },
  { key: 'echoCancellation', label: 'Cancelamento de eco', hint: 'Desligue se usa fone de ouvido.' },
  { key: 'autoGainControl', label: 'Ajuste automático de volume', hint: 'Pode cortar o começo das falas.' },
] as const;

const toPct = (db: number) => Math.min(1, Math.max(0, (db - METER_MIN_DB) / SPAN));

/** Botão do microfone + seta que abre a escolha da entrada, a sensibilidade e o medidor. */
export function MicMenu({
  muted,
  micAvailable,
  settings,
  gainSupported,
  gateSupported,
  getMeter,
  onToggleMute,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passing, setPassing] = useState(true);
  const [shift, setShift] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const inputs = useAudioInputs(open);

  const micOff = muted || !micAvailable;
  const gate = gateSupported ? settings.gate : 'off';

  const close = () => {
    if (!open || closing) return;
    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
      setError(null);
    }, EXIT_MS);
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

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

  // Mantém o painel inteiro na tela quando o botão está perto da borda (celular).
  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const wrap = wrapRef.current;
    if (!panel || !wrap) return;
    // Mede pelo contêiner e pela largura de layout: o painel anima com transform ao abrir.
    const left = wrap.getBoundingClientRect().left;
    let next = Math.min(0, window.innerWidth - EDGE - (left + panel.offsetWidth));
    if (left + next < EDGE) next = EDGE - left;
    setShift(next);
  }, [open]);

  // Medidor ao vivo: escreve direto no DOM para não re-renderizar a cada quadro.
  useEffect(() => {
    if (!open) return;
    let frame = 0;
    let smooth = 0;
    let wasPassing = true;
    const tick = () => {
      const m = getMeter();
      const target = toPct(m.db);
      smooth = target > smooth ? target : smooth * 0.88 + target * 0.12;
      const s = settingsRef.current;
      const el = meterRef.current;
      el?.style.setProperty('--level', smooth.toFixed(3));
      const thr = s.gate === 'manual' ? s.gateThreshold : m.threshold;
      el?.style.setProperty('--thr', toPct(thr).toFixed(3));
      const nowPassing = s.gate === 'off' || m.open;
      if (nowPassing !== wasPassing) {
        wasPassing = nowPassing;
        setPassing(nowPassing);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [open, getMeter]);

  const toggle = () => {
    if (open) return close();
    window.clearTimeout(closeTimer.current);
    setClosing(false);
    setOpen(true);
  };

  const apply = async (patch: Partial<MicSettings>) => {
    setBusy(true);
    const message = await onChange(patch);
    setBusy(false);
    setError(message);
  };

  const gainPercent = Math.round(settings.gain * 100);
  const known = inputs.some((d) => d.id === settings.deviceId);
  const { deviceId: _device, ...tunable } = settings;
  const { deviceId: _d2, ...defaults } = DEFAULT_MIC_SETTINGS;
  const isDefault = JSON.stringify(tunable) === JSON.stringify(defaults);
  const thresholdLabel =
    gate === 'manual' ? `${settings.gateThreshold} dB` : gate === 'auto' ? 'automático' : 'sem limite';

  return (
    <div className="mic-menu" ref={wrapRef}>
      <div className="ctrl-group ctrl-group--mic">
        <button
          className={`ctrl${micOff ? ' ctrl--off' : ''}`}
          onClick={onToggleMute}
          disabled={!micAvailable}
          title={!micAvailable ? 'Microfone indisponível' : muted ? 'Ligar microfone' : 'Desligar microfone'}
        >
          {/* key reinicia a animação de troca do ícone a cada mudança de estado. */}
          <span className="ctrl__icon" key={micOff ? 'off' : 'on'}>
            <Icon name={micOff ? 'micOff' : 'mic'} />
          </span>
          <span className="ctrl__label">{micOff ? 'Mudo' : 'Microfone'}</span>
        </button>
        <button
          type="button"
          className={`ctrl ctrl--chevron${open && !closing ? ' ctrl--open' : ''}`}
          onClick={toggle}
          disabled={!micAvailable}
          aria-expanded={open && !closing}
          aria-haspopup="dialog"
          aria-label="Configurar entrada de áudio"
          title="Escolher microfone e sensibilidade"
        >
          <Icon name={open && !closing ? 'down' : 'up'} size={16} />
        </button>
      </div>

      {open && (
        <div
          ref={panelRef}
          className={`mic-panel${closing ? ' mic-panel--closing' : ''}`}
          style={{ ['--shift' as string]: `${shift}px` } as CSSProperties}
          role="dialog"
          aria-label="Entrada de áudio"
        >
          <header className="mic-panel__head">
            <span className="mic-panel__badge" aria-hidden="true">
              <Icon name="mic" size={16} />
            </span>
            <h3>Entrada de áudio</h3>
            <button type="button" className="icon-btn" onClick={close} aria-label="Fechar">
              <Icon name="close" />
            </button>
          </header>

          <section className="mic-card">
            <span className="mic-card__label">Microfone</span>
            <div className="mic-select">
              <select
                value={known ? settings.deviceId : ''}
                disabled={busy}
                onChange={(e) => void apply({ deviceId: e.target.value })}
                aria-label="Microfone"
              >
                <option value="">Padrão do sistema</option>
                {inputs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section className="mic-card">
            <div className="mic-card__row">
              <span className="mic-card__label">Sensibilidade</span>
              {gate !== 'off' && (
                <span className={`mic-chip${passing ? ' is-on' : ''}`}>{passing ? 'Transmitindo' : 'Silenciado'}</span>
              )}
            </div>

            <div className="mic-seg" role="radiogroup" aria-label="Modo de sensibilidade">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={gate === m.id}
                  className={`mic-seg__btn${gate === m.id ? ' is-active' : ''}`}
                  disabled={!gateSupported && m.id !== 'off'}
                  onClick={() => void onChange({ gate: m.id })}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div
              ref={meterRef}
              className={`mic-meter${passing ? ' is-open' : ''}${gate === 'off' ? ' is-off' : ''}`}
              style={{ ['--thr' as string]: toPct(settings.gateThreshold) } as CSSProperties}
            >
              <div className="mic-meter__track">
                <span className="mic-meter__fill" />
              </div>
              {gate !== 'off' && <span className="mic-meter__mark" aria-hidden="true" />}
              {gate === 'manual' && (
                <input
                  type="range"
                  className="mic-meter__input"
                  min={METER_MIN_DB}
                  max={METER_MAX_DB}
                  step={1}
                  value={settings.gateThreshold}
                  onChange={(e) => void onChange({ gateThreshold: Number(e.target.value) })}
                  aria-label="Volume mínimo para transmitir"
                  aria-valuetext={`${settings.gateThreshold} decibéis`}
                />
              )}
            </div>
            <div className="mic-meter__legend">
              <span>Silêncio</span>
              <strong>{thresholdLabel}</strong>
              <span>Alto</span>
            </div>

            <p className="mic-card__hint">
              {gateSupported
                ? MODE_HINTS[gate]
                : 'Seu navegador não consegue filtrar por sensibilidade; o microfone envia tudo que captar.'}
            </p>
          </section>

          <section className="mic-card">
            <div className="mic-card__row">
              <span className="mic-card__label">Volume do microfone</span>
              <span className="mic-card__value">{gainPercent}%</span>
            </div>
            <input
              type="range"
              className="volume__slider mic-slider"
              min={MIN_MIC_GAIN}
              max={MAX_MIC_GAIN}
              step={0.05}
              value={settings.gain}
              disabled={!gainSupported}
              onChange={(e) => void onChange({ gain: Number(e.target.value) })}
              onDoubleClick={() => void onChange({ gain: 1 })}
              aria-label="Volume do microfone"
              aria-valuetext={`${gainPercent}%`}
              title="Duplo clique volta para 100%"
              style={{ ['--fill' as string]: `${((settings.gain - MIN_MIC_GAIN) / (MAX_MIC_GAIN - MIN_MIC_GAIN)) * 100}%` }}
            />
            <p className="mic-card__hint">
              {gainSupported ? 'Diminua se sua voz chega alta demais ou estourando para os outros.' : 'Seu navegador não permite ajustar o volume.'}
            </p>
          </section>

          <section className="mic-card mic-card--list">
            {TOGGLES.map((t) => (
              <label key={t.key} className="mic-switch">
                <span className="mic-switch__text">
                  <span className="mic-switch__label">{t.label}</span>
                  <span className="mic-card__hint">{t.hint}</span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={settings[t.key]}
                  disabled={busy}
                  onChange={(e) => void apply({ [t.key]: e.target.checked })}
                />
              </label>
            ))}
          </section>

          <p className="mic-tip">
            Voz cortando? Desligue o ajuste automático de volume e a supressão de ruído, e deixe a sensibilidade em
            Desligada ou com um limite mais baixo.
          </p>

          {error && (
            <p className="mic-error" role="alert">
              {error}
            </p>
          )}

          <button
            type="button"
            className="btn btn--small btn--block"
            disabled={busy || isDefault}
            onClick={() => void apply({ ...defaults })}
          >
            Restaurar padrões
          </button>
        </div>
      )}
    </div>
  );
}
