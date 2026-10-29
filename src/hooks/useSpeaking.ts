import { useEffect, useState } from 'react';

let sharedContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  sharedContext ??= new AudioContext();
  if (sharedContext.state === 'suspended') void sharedContext.resume();
  return sharedContext;
}

/** true enquanto o volume do stream passar de um limiar (indicador de "falando"). */
export function useSpeaking(stream: MediaStream | null, enabled = true): boolean {
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    const track = stream?.getAudioTracks()[0];
    if (!stream || !track || !enabled) {
      setSpeaking(false);
      return;
    }
    const ctx = getAudioContext();
    if (!ctx) return;

    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.4;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);

    let lastLoud = 0;
    const timer = window.setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) {
        const n = (v - 128) / 128;
        sum += n * n;
      }
      const rms = Math.sqrt(sum / data.length);
      const now = performance.now();
      if (rms > 0.035) lastLoud = now;
      // Segura o indicador por um instante para não piscar entre sílabas.
      setSpeaking(now - lastLoud < 300);
    }, 100);

    return () => {
      window.clearInterval(timer);
      source.disconnect();
      analyser.disconnect();
    };
  }, [stream, enabled]);

  return speaking;
}
