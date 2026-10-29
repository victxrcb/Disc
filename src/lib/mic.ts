import { getAudioContext } from './audio';
import { GATE_PROCESSOR_NAME, loadGateWorklet } from './micGate';
import { loadString, saveString } from './storage';

export const MIN_MIC_GAIN = 0;
export const MAX_MIC_GAIN = 1;
/** Faixa do medidor e do limite de sensibilidade, em dB (0 dB = volume máximo). */
export const METER_MIN_DB = -70;
export const METER_MAX_DB = 0;

/** off = envia tudo; auto = o app descobre o ruído do ambiente; manual = limite escolhido. */
export type GateMode = 'off' | 'auto' | 'manual';

export interface MicSettings {
  /** '' = microfone padrão do sistema. */
  deviceId: string;
  /** Multiplicador do volume da entrada (1 = sem alteração). */
  gain: number;
  /** Sensibilidade: só o que passar do limite sai na chamada. */
  gate: GateMode;
  /** Limite do modo manual, em dB. */
  gateThreshold: number;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
}

export const DEFAULT_MIC_SETTINGS: MicSettings = {
  deviceId: '',
  gain: 1,
  gate: 'off',
  gateThreshold: -45,
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
};

const KEY = 'disc:mic';

export function clampMicGain(v: number): number {
  return Number.isFinite(v) ? Math.min(MAX_MIC_GAIN, Math.max(MIN_MIC_GAIN, v)) : 1;
}

export function clampGateThreshold(v: number): number {
  return Number.isFinite(v) ? Math.min(METER_MAX_DB, Math.max(METER_MIN_DB, Math.round(v))) : DEFAULT_MIC_SETTINGS.gateThreshold;
}

export function loadMicSettings(): MicSettings {
  try {
    const raw = JSON.parse(loadString(KEY) || '{}') as Partial<MicSettings>;
    const flag = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
    const d = DEFAULT_MIC_SETTINGS;
    return {
      deviceId: typeof raw.deviceId === 'string' ? raw.deviceId : d.deviceId,
      gain: clampMicGain(typeof raw.gain === 'number' ? raw.gain : d.gain),
      gate: raw.gate === 'auto' || raw.gate === 'manual' || raw.gate === 'off' ? raw.gate : d.gate,
      gateThreshold: clampGateThreshold(typeof raw.gateThreshold === 'number' ? raw.gateThreshold : d.gateThreshold),
      noiseSuppression: flag(raw.noiseSuppression, d.noiseSuppression),
      echoCancellation: flag(raw.echoCancellation, d.echoCancellation),
      autoGainControl: flag(raw.autoGainControl, d.autoGainControl),
    };
  } catch {
    return { ...DEFAULT_MIC_SETTINGS };
  }
}

export function saveMicSettings(settings: MicSettings): void {
  saveString(KEY, JSON.stringify(settings));
}

/** Leitura ao vivo para o medidor do painel. */
export interface MicMeter {
  /** Volume da entrada em dB (de METER_MIN_DB a 0). */
  db: number;
  /** O filtro está deixando o som passar neste instante? */
  open: boolean;
  /** Limite em uso agora, em dB (no modo automático é o que o app calculou). */
  threshold: number;
}

export interface MicPipeline {
  /** Faixa que segue para os outros participantes (já com ganho e filtro aplicados). */
  track: MediaStreamTrack;
  /** Dispositivo realmente em uso (pode ser o padrão se o escolhido sumiu). */
  deviceId: string;
  /** false quando não há AudioContext: a faixa vai crua e o volume não tem efeito. */
  gainSupported: boolean;
  /** false quando o navegador não tem AudioWorklet: a sensibilidade não pode filtrar. */
  gateSupported: boolean;
  setGain(gain: number): void;
  setGate(mode: GateMode, thresholdDb: number): void;
  meter(): MicMeter;
  close(): void;
}

async function capture(settings: MicSettings, withDevice: boolean): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: withDevice && settings.deviceId ? { exact: settings.deviceId } : undefined,
      echoCancellation: settings.echoCancellation,
      noiseSuppression: settings.noiseSuppression,
      autoGainControl: settings.autoGainControl,
    },
    video: false,
  });
}

/**
 * Abre o microfone escolhido e monta: entrada → volume → filtro de sensibilidade → saída enviada aos peers.
 * Se o dispositivo salvo não existir mais, cai no padrão do sistema.
 * `onLost` dispara se o microfone for desconectado enquanto está em uso.
 */
export async function openMic(settings: MicSettings, onLost: (pipeline: MicPipeline) => void): Promise<MicPipeline> {
  let raw: MediaStream;
  try {
    raw = await capture(settings, true);
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    if (!settings.deviceId || (name !== 'OverconstrainedError' && name !== 'NotFoundError')) throw err;
    raw = await capture(settings, false);
  }

  const rawTrack = raw.getAudioTracks()[0];
  const deviceId = rawTrack.getSettings().deviceId ?? '';

  const ctx = getAudioContext();
  if (ctx?.state === 'suspended') await ctx.resume().catch(() => {});

  let pipeline: MicPipeline;
  if (ctx && ctx.state === 'running') {
    const gateReady = await loadGateWorklet(ctx);
    const source = ctx.createMediaStreamSource(raw);
    const gainNode = ctx.createGain();
    gainNode.gain.value = clampMicGain(settings.gain);
    const destination = ctx.createMediaStreamDestination();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(gainNode);
    gainNode.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);

    let gateNode: AudioWorkletNode | null = null;
    let gateState = { open: true, threshold: settings.gateThreshold };
    if (gateReady) {
      gateNode = new AudioWorkletNode(ctx, GATE_PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
      });
      gateNode.port.onmessage = (e: MessageEvent<{ open: boolean; threshold: number }>) => {
        gateState = e.data;
      };
      gateNode.port.postMessage({ mode: settings.gate, manualDb: settings.gateThreshold });
      // Se o filtro falhar, a voz continua passando direto: nunca deixa a pessoa muda.
      gateNode.onprocessorerror = () => {
        try {
          gainNode.disconnect(gateNode!);
          gateNode!.disconnect();
        } catch {
          /* já desconectado */
        }
        gainNode.connect(destination);
        gateNode = null;
        pipeline.gateSupported = false;
        gateState = { open: true, threshold: gateState.threshold };
      };
      gainNode.connect(gateNode);
      gateNode.connect(destination);
    } else {
      gainNode.connect(destination);
    }

    pipeline = {
      track: destination.stream.getAudioTracks()[0],
      deviceId,
      gainSupported: true,
      gateSupported: gateNode !== null,
      setGain: (gain) => {
        gainNode.gain.setTargetAtTime(clampMicGain(gain), ctx.currentTime, 0.02);
      },
      setGate: (mode, thresholdDb) => {
        gateNode?.port.postMessage({ mode, manualDb: thresholdDb });
      },
      meter: () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) {
          const n = (v - 128) / 128;
          sum += n * n;
        }
        const db = 20 * Math.log10(Math.sqrt(sum / data.length) + 1e-5);
        return { db: Math.max(METER_MIN_DB, db), open: gateState.open, threshold: gateState.threshold };
      },
      close: () => {
        rawTrack.removeEventListener('ended', lost);
        source.disconnect();
        gainNode.disconnect();
        analyser.disconnect();
        if (gateNode) {
          gateNode.port.onmessage = null;
          gateNode.onprocessorerror = null;
          gateNode.disconnect();
        }
        pipeline.track.stop();
        raw.getTracks().forEach((t) => t.stop());
      },
    };
  } else {
    // Sem AudioContext nem o volume nem a sensibilidade funcionam, mas a voz continua indo normalmente.
    pipeline = {
      track: rawTrack,
      deviceId,
      gainSupported: false,
      gateSupported: false,
      setGain: () => {},
      setGate: () => {},
      meter: () => ({ db: METER_MIN_DB, open: true, threshold: settings.gateThreshold }),
      close: () => {
        rawTrack.removeEventListener('ended', lost);
        raw.getTracks().forEach((t) => t.stop());
      },
    };
  }

  function lost() {
    onLost(pipeline);
  }
  rawTrack.addEventListener('ended', lost);
  return pipeline;
}
