import { getAudioContext } from './audio';
import { loadString, saveString } from './storage';

// Os sons viajam dentro da mensagem de broadcast do Supabase Realtime (limite de 256 KB no
// plano gratuito). O corte de até 10 s é recodificado em Opus a 64 kbps (~80 KB) ao salvar.

export const MAX_CLIP_SECONDS = 10;
export const MAX_SOUNDS = 16;
export const MAX_SOUND_NAME = 24;
/** Tamanho máximo da data URL do som (caracteres), com folga para o resto da mensagem. */
export const MAX_SOUND_DATA_URL = 200_000;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const BITRATE = 64_000;
const SAFE_SOUND_URL = /^data:audio\/(?:webm|ogg|mp4|mpeg|wav|x-wav)(?:;codecs=[a-z0-9.]+)?;base64,[A-Za-z0-9+/]+=*$/i;

const SOUNDS_KEY = 'disc:soundpad:sounds';
const VOLUME_KEY = 'disc:soundpad:volume';
const DEFAULT_VOLUME = 0.7;

export interface Sound {
  id: string;
  name: string;
  /** data URL do áudio já cortado. */
  data: string;
  duration: number;
}

export class SoundError extends Error {}

export function isSafeSoundDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_SOUND_DATA_URL && SAFE_SOUND_URL.test(value);
}

export function cleanSoundName(name: unknown): string {
  return typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, MAX_SOUND_NAME) : '';
}

// ---------- Biblioteca local ----------

export function loadSounds(): Sound[] {
  try {
    const parsed: unknown = JSON.parse(loadString(SOUNDS_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (s): s is Sound =>
          typeof s?.id === 'string' && Boolean(cleanSoundName(s.name)) && isSafeSoundDataUrl(s.data),
      )
      .slice(0, MAX_SOUNDS);
  } catch {
    return [];
  }
}

/** Lança SoundError se o navegador não tiver espaço para guardar. */
export function saveSounds(sounds: Sound[]): void {
  try {
    localStorage.setItem(SOUNDS_KEY, JSON.stringify(sounds));
  } catch {
    throw new SoundError('Sem espaço no navegador para guardar mais sons. Apague algum e tente de novo.');
  }
}

/** Avisa os painéis abertos (o Soundpad) que a biblioteca mudou. */
export const SOUNDS_CHANGED_EVENT = 'disc:soundpad:changed';

/**
 * Guarda na biblioteca um som recebido de outra pessoa.
 * Lança SoundError se a biblioteca estiver cheia ou sem espaço.
 */
export function addSoundToLibrary(sound: Omit<Sound, 'id'>): 'added' | 'duplicate' {
  const sounds = loadSounds();
  if (sounds.some((s) => s.data === sound.data)) return 'duplicate';
  if (sounds.length >= MAX_SOUNDS) throw new SoundError(`Seu soundpad já tem ${MAX_SOUNDS} sons.`);
  saveSounds([...sounds, { ...sound, id: crypto.randomUUID() }]);
  window.dispatchEvent(new Event(SOUNDS_CHANGED_EVENT));
  return 'added';
}

export function loadEffectsVolume(): number {
  const raw = loadString(VOLUME_KEY);
  const v = raw === '' ? DEFAULT_VOLUME : Number(raw);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_VOLUME;
}

export function saveEffectsVolume(volume: number): void {
  saveString(VOLUME_KEY, String(volume));
}

// ---------- Reprodução ----------

const MAX_CONCURRENT = 4;
const playing = new Set<HTMLAudioElement>();

/**
 * Toca pelo <audio> (e não pelo Web Audio) para o cancelamento de eco do navegador
 * enxergar o som e ele não voltar pelo microfone de quem ouve.
 */
export function playSoundData(data: string, volume: number): void {
  if (!isSafeSoundDataUrl(data) || volume <= 0) return;
  if (playing.size >= MAX_CONCURRENT) {
    const oldest = playing.values().next().value;
    oldest?.pause();
    if (oldest) playing.delete(oldest);
  }
  const audio = new Audio(data);
  audio.volume = Math.min(1, Math.max(0, volume));
  const done = () => playing.delete(audio);
  audio.addEventListener('ended', done);
  audio.addEventListener('error', done);
  playing.add(audio);
  audio.play().catch(done);
}

// ---------- Importação e corte ----------

export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  if (file.size > MAX_FILE_BYTES) throw new SoundError('Arquivo grande demais (máx. 50 MB).');
  const ctx = getAudioContext();
  if (!ctx) throw new SoundError('Seu navegador não suporta edição de áudio.');
  try {
    return await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new SoundError('Não foi possível ler esse arquivo de áudio.');
  }
}

/** Picos por coluna, para desenhar a forma de onda. */
export function waveformPeaks(buffer: AudioBuffer, columns: number): Float32Array {
  const peaks = new Float32Array(columns);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const step = Math.max(1, Math.floor(buffer.length / columns));
  for (let c = 0; c < columns; c++) {
    let max = 0;
    const from = c * step;
    const to = Math.min(buffer.length, from + step);
    // Amostra no máximo ~200 pontos por coluna: suficiente para o desenho e rápido em arquivos longos.
    const stride = Math.max(1, Math.floor((to - from) / 200));
    for (const data of channels) {
      for (let i = from; i < to; i += stride) {
        const v = Math.abs(data[i]);
        if (v > max) max = v;
      }
    }
    peaks[c] = max;
  }
  return peaks;
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'].find((t) =>
    MediaRecorder.isTypeSupported(t),
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Corta [start, start + duration) e recodifica. O MediaRecorder grava em tempo real,
 * então leva a própria duração do trecho; `onProgress` recebe 0–1.
 */
export async function encodeClip(
  buffer: AudioBuffer,
  start: number,
  duration: number,
  onProgress?: (p: number) => void,
): Promise<string> {
  const mimeType = pickMimeType();
  const ctx = getAudioContext();
  if (!mimeType || !ctx) throw new SoundError('Seu navegador não consegue gravar áudio.');
  if (ctx.state !== 'running') await ctx.resume();

  const length = Math.min(duration, MAX_CLIP_SECONDS, buffer.duration - start);
  const dest = ctx.createMediaStreamDestination();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(dest);

  const recorder = new MediaRecorder(dest.stream, { mimeType, audioBitsPerSecond: BITRATE });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));

  recorder.start();
  const t0 = ctx.currentTime + 0.05;
  source.start(t0, start, length);
  const timer = window.setInterval(() => onProgress?.(Math.min(1, (ctx.currentTime - t0) / length)), 100);
  // Pequena folga no fim para o recorder não cortar a cauda do som.
  source.onended = () => window.setTimeout(() => recorder.state !== 'inactive' && recorder.stop(), 120);

  try {
    await stopped;
  } finally {
    window.clearInterval(timer);
    source.disconnect();
    dest.stream.getTracks().forEach((t) => t.stop());
  }
  onProgress?.(1);

  const type = (recorder.mimeType || mimeType).split(';')[0];
  const data = await blobToDataUrl(new Blob(chunks, { type }));
  if (!isSafeSoundDataUrl(data)) throw new SoundError('O som ficou grande demais para enviar.');
  return data;
}
