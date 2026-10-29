import { useEffect, useRef } from 'react';
import { getAudioContext } from '../lib/audio';

interface Props {
  stream: MediaStream | null;
  kind: 'audio' | 'video';
  muted?: boolean;
  /** 0–1 usa o volume do próprio elemento; acima de 1 amplifica via Web Audio. */
  volume?: number;
  className?: string;
}

/** <audio>/<video> com srcObject; React não sabe definir srcObject por atributo. */
export function MediaElement({ stream, kind, muted = false, volume = 1, className }: Props) {
  const ref = useRef<HTMLMediaElement | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const boosted = volume > 1 && !muted;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) el.play().catch(() => {});
  }, [stream]);

  // O elemento não passa de volume 1. Para amplificar, o áudio segue por um GainNode e o
  // elemento fica mudo — mas continua tocando, senão o Chrome não entrega o áudio remoto
  // ao Web Audio. Enquanto o contexto estiver suspenso, o elemento segue audível.
  useEffect(() => {
    const el = ref.current;
    const track = stream?.getAudioTracks()[0];
    if (!boosted || !el || !track) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const gain = ctx.createGain();
    gain.gain.value = volumeRef.current;
    source.connect(gain).connect(ctx.destination);
    gainRef.current = gain;

    const sync = () => {
      el.muted = ctx.state === 'running';
    };
    sync();
    ctx.addEventListener('statechange', sync);

    return () => {
      ctx.removeEventListener('statechange', sync);
      source.disconnect();
      gain.disconnect();
      gainRef.current = null;
      el.muted = mutedRef.current;
    };
  }, [boosted, stream]);

  useEffect(() => {
    if (ref.current) ref.current.volume = Math.min(volume, 1);
    if (gainRef.current) gainRef.current.gain.value = volume;
  }, [volume]);

  if (kind === 'audio') {
    return <audio ref={(el) => void (ref.current = el)} autoPlay muted={muted} />;
  }
  return (
    <video ref={(el) => void (ref.current = el)} className={className} autoPlay playsInline muted={muted} />
  );
}
