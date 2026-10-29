import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type PointerEvent } from 'react';
import { getAudioContext } from '../lib/audio';
import {
  cleanSoundName,
  decodeAudioFile,
  encodeClip,
  loadEffectsVolume,
  MAX_CLIP_SECONDS,
  MAX_SOUND_NAME,
  SoundError,
  waveformPeaks,
  type Sound,
} from '../lib/soundpad';
import { Icon } from './Icon';

const WAVE_COLUMNS = 120;
const MIN_LENGTH = 0.5;

const fmt = (s: number) => `${s.toFixed(1).replace('.', ',')}s`;

interface Props {
  onSave(sound: Sound): void;
  onCancel(): void;
}

/** Escolhe um arquivo de áudio, dá nome e define o trecho (até 10 s) que vira o som. */
export function SoundEditor({ onSave, onCancel }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [name, setName] = useState('');
  const [start, setStart] = useState(0);
  const [length, setLength] = useState(MAX_CLIP_SECONDS);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const preview = useRef<{ source: AudioBufferSourceNode; raf: number } | null>(null);

  const duration = buffer?.duration ?? 0;
  const maxLength = Math.min(MAX_CLIP_SECONDS, duration);
  const clipLength = Math.min(length, maxLength);
  const saving = progress !== null;

  const stopPreview = () => {
    const p = preview.current;
    if (!p) return;
    preview.current = null;
    cancelAnimationFrame(p.raf);
    p.source.onended = null;
    try {
      p.source.stop();
    } catch {
      /* já parado */
    }
    p.source.disconnect();
    setPlayhead(null);
  };

  useEffect(() => stopPreview, []);

  const pickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    stopPreview();
    setError(null);
    setLoading(true);
    try {
      const decoded = await decodeAudioFile(file);
      setBuffer(decoded);
      setPeaks(waveformPeaks(decoded, WAVE_COLUMNS));
      setStart(0);
      setLength(Math.min(MAX_CLIP_SECONDS, decoded.duration));
      setName((n) => n || cleanSoundName(file.name.replace(/\.[^.]+$/, '')));
    } catch (err) {
      setError(err instanceof SoundError ? err.message : 'Não foi possível ler esse arquivo.');
    } finally {
      setLoading(false);
    }
  };

  // Forma de onda: trecho selecionado em destaque, resto apagado.
  useLayoutEffect(() => {
    const canvas = waveRef.current;
    if (!canvas || !peaks || !duration) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const styles = getComputedStyle(canvas);
    const on = styles.getPropertyValue('--wave-on').trim() || '#7d72ff';
    const off = styles.getPropertyValue('--wave-off').trim() || '#3a3a55';
    const col = w / peaks.length;
    for (let i = 0; i < peaks.length; i++) {
      const t = ((i + 0.5) / peaks.length) * duration;
      ctx.fillStyle = t >= start && t <= start + clipLength ? on : off;
      const bar = Math.max(2, peaks[i] * h * 0.9);
      ctx.fillRect(i * col + col * 0.15, (h - bar) / 2, Math.max(1, col * 0.7), bar);
    }
  }, [peaks, duration, start, clipLength]);

  const togglePreview = () => {
    if (preview.current) return stopPreview();
    const ctx = getAudioContext();
    if (!ctx || !buffer) return;
    const gain = ctx.createGain();
    gain.gain.value = loadEffectsVolume();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain).connect(ctx.destination);
    const t0 = ctx.currentTime;
    source.start(t0, start, clipLength);
    source.onended = () => stopPreview();
    const tick = () => {
      if (!preview.current) return;
      setPlayhead(start + Math.min(clipLength, ctx.currentTime - t0));
      preview.current.raf = requestAnimationFrame(tick);
    };
    preview.current = { source, raf: requestAnimationFrame(tick) };
  };

  // Clicar/arrastar na onda posiciona o trecho centralizado no ponteiro.
  const moveTo = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - r.left) / r.width) * duration;
    stopPreview();
    setStart(Math.min(Math.max(0, t - clipLength / 2), Math.max(0, duration - clipLength)));
  };

  const changeLength = (v: number) => {
    stopPreview();
    setLength(v);
    setStart((s) => Math.min(s, Math.max(0, duration - v)));
  };

  const save = async () => {
    const clean = cleanSoundName(name);
    if (!buffer || !clean) return;
    stopPreview();
    setError(null);
    setProgress(0);
    try {
      const data = await encodeClip(buffer, start, clipLength, setProgress);
      onSave({ id: crypto.randomUUID(), name: clean, data, duration: clipLength });
    } catch (err) {
      setError(err instanceof SoundError ? err.message : 'Não foi possível preparar o som.');
      setProgress(null);
    }
  };

  return (
    <div className="sound-editor">
      <input ref={fileRef} type="file" accept="audio/*" hidden onChange={pickFile} />

      {!buffer ? (
        <button type="button" className="sound-editor__pick" onClick={() => fileRef.current?.click()} disabled={loading}>
          <Icon name="upload" size={28} />
          <span>{loading ? 'Lendo áudio…' : 'Escolher arquivo de áudio'}</span>
          <small>MP3, WAV, OGG, M4A… O som terá no máximo {MAX_CLIP_SECONDS} segundos.</small>
        </button>
      ) : (
        <>
          <label className="sound-editor__field">
            <span>Nome do som</span>
            <input
              type="text"
              value={name}
              maxLength={MAX_SOUND_NAME}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Aplausos"
              disabled={saving}
              autoFocus
            />
          </label>

          <div className="sound-editor__wave-head">
            <span>Corte</span>
            <span className="sound-editor__range">
              {fmt(start)} – {fmt(start + clipLength)} <em>({fmt(clipLength)})</em>
            </span>
          </div>
          <div
            className="sound-editor__wave"
            onPointerDown={(e) => {
              if (saving) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              moveTo(e);
            }}
            onPointerMove={(e) => {
              if (!saving && e.currentTarget.hasPointerCapture(e.pointerId)) moveTo(e);
            }}
            title="Clique ou arraste para escolher o trecho"
          >
            <canvas ref={waveRef} aria-hidden="true" />
            <div
              className="sound-editor__window"
              style={{ left: `${(start / duration) * 100}%`, width: `${(clipLength / duration) * 100}%` }}
            />
            {playhead !== null && (
              <div className="sound-editor__playhead" style={{ left: `${(playhead / duration) * 100}%` }} />
            )}
          </div>

          <label className="sound-editor__field sound-editor__field--row">
            <span>Início</span>
            <input
              type="range"
              min={0}
              max={Math.max(0, duration - clipLength)}
              step={0.1}
              value={start}
              disabled={saving || duration <= clipLength}
              onChange={(e) => {
                stopPreview();
                setStart(Number(e.target.value));
              }}
              aria-valuetext={fmt(start)}
            />
          </label>
          <label className="sound-editor__field sound-editor__field--row">
            <span>Duração</span>
            <input
              type="range"
              min={Math.min(MIN_LENGTH, maxLength)}
              max={maxLength}
              step={0.1}
              value={clipLength}
              disabled={saving}
              onChange={(e) => changeLength(Number(e.target.value))}
              aria-valuetext={fmt(clipLength)}
            />
          </label>

          <div className="sound-editor__tools">
            <button type="button" className="btn btn--ghost" onClick={togglePreview} disabled={saving}>
              <Icon name={playhead !== null ? 'stop' : 'play'} size={16} />
              {playhead !== null ? 'Parar' : 'Ouvir corte'}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => fileRef.current?.click()}
              disabled={saving || loading}
            >
              Trocar arquivo
            </button>
          </div>
        </>
      )}

      {error && <p className="sound-editor__error">{error}</p>}

      {saving && (
        <div className="sound-editor__progress" role="progressbar" aria-valuenow={Math.round((progress ?? 0) * 100)}>
          <span style={{ transform: `scaleX(${progress ?? 0})` }} />
          <small>Preparando som…</small>
        </div>
      )}

      <div className="sound-editor__actions">
        <button type="button" className="btn" onClick={onCancel} disabled={saving}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void save()}
          disabled={!buffer || !cleanSoundName(name) || saving}
        >
          Adicionar
        </button>
      </div>
    </div>
  );
}
