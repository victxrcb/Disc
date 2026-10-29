export const GATE_PROCESSOR_NAME = 'mic-gate';

/**
 * Filtro de ruído (noise gate) que roda na thread de áudio: não é freado quando a aba
 * fica em segundo plano, ao contrário de setInterval/requestAnimationFrame.
 *
 * - Decide pelo som que está chegando, mas entrega o som 15 ms atrasado: o portão já
 *   abriu quando o começo da fala sai (sem cortar a primeira sílaba).
 * - Segura aberto por 300 ms depois que a voz cai abaixo do limite (sem cortar o fim das palavras).
 * - modo 'manual': usa o limite escolhido (dB). modo 'auto': limite = ruído de fundo + 10 dB.
 */
export const GATE_WORKLET_SOURCE = `
class MicGate extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mode = 'off';
    this.manualDb = -45;
    this.buf = new Float32Array(Math.max(1, Math.round(sampleRate * 0.015)));
    this.pos = 0;
    this.blockSec = 128 / sampleRate;
    this.lvl = -100;
    this.gain = 1;
    this.open = true;
    this.hold = 0;
    this.holdBlocks = Math.ceil(0.3 / this.blockSec);
    this.buckets = [];
    this.bucketMin = 0;
    this.bucketBlocks = 0;
    this.bucketLen = Math.round(1 / this.blockSec);
    this.floor = -50;
    this.threshold = -45;
    this.reportEvery = Math.max(1, Math.round(0.05 / this.blockSec));
    this.sinceReport = 0;
    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (d.mode === 'off' || d.mode === 'auto' || d.mode === 'manual') this.mode = d.mode;
      if (typeof d.manualDb === 'number' && isFinite(d.manualDb)) this.manualDb = d.manualDb;
    };
  }

  process(inputs, outputs) {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    const input = inputs[0] && inputs[0][0];
    const n = out.length;

    let sum = 0;
    if (input) for (let i = 0; i < n; i++) sum += input[i] * input[i];
    const db = 10 * Math.log10(sum / n + 1e-12);
    this.lvl = db > this.lvl ? db : this.lvl + (db - this.lvl) * 0.15;

    // Ruído de fundo = menor nível dos últimos ~6 s (as pausas da fala mostram o ruído do ambiente).
    if (this.lvl < this.bucketMin) this.bucketMin = this.lvl;
    if (++this.bucketBlocks >= this.bucketLen) {
      this.buckets.push(this.bucketMin);
      if (this.buckets.length > 6) this.buckets.shift();
      this.floor = Math.min.apply(null, this.buckets);
      this.bucketMin = 0;
      this.bucketBlocks = 0;
    }

    const auto = Math.min(-28, Math.max(-62, this.floor + 10));
    const thr = this.mode === 'manual' ? this.manualDb : auto;
    this.threshold = thr;

    if (this.mode === 'off') {
      this.open = true;
      this.hold = 0;
    } else if (this.lvl > thr) {
      this.open = true;
      this.hold = this.holdBlocks;
    } else if (this.open) {
      if (this.hold > 0) this.hold--;
      else if (this.lvl < thr - 2) this.open = false;
    }

    const target = this.open ? 1 : 0;
    const coef = 1 - Math.exp(-this.blockSec / (target > this.gain ? 0.004 : 0.06));
    const g0 = this.gain;
    const g1 = g0 + (target - g0) * coef;
    this.gain = g1;

    for (let i = 0; i < n; i++) {
      const delayed = this.buf[this.pos];
      this.buf[this.pos] = input ? input[i] : 0;
      this.pos = (this.pos + 1) % this.buf.length;
      out[i] = delayed * (g0 + ((g1 - g0) * (i + 1)) / n);
    }

    if (++this.sinceReport >= this.reportEvery) {
      this.sinceReport = 0;
      this.port.postMessage({ open: this.open, threshold: this.threshold });
    }
    return true;
  }
}
registerProcessor('${GATE_PROCESSOR_NAME}', MicGate);
`;

const loaded = new WeakMap<BaseAudioContext, Promise<boolean>>();

/** Registra o filtro no AudioContext (uma vez). false = navegador sem AudioWorklet. */
export function loadGateWorklet(ctx: BaseAudioContext): Promise<boolean> {
  let pending = loaded.get(ctx);
  if (!pending) {
    pending = (async () => {
      if (!ctx.audioWorklet) return false;
      const url = URL.createObjectURL(new Blob([GATE_WORKLET_SOURCE], { type: 'text/javascript' }));
      try {
        await ctx.audioWorklet.addModule(url);
        return true;
      } catch {
        return false;
      } finally {
        URL.revokeObjectURL(url);
      }
    })();
    loaded.set(ctx, pending);
  }
  return pending;
}
