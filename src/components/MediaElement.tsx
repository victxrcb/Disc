import { useEffect, useRef } from 'react';

interface Props {
  stream: MediaStream | null;
  kind: 'audio' | 'video';
  muted?: boolean;
  volume?: number;
  className?: string;
}

/** <audio>/<video> com srcObject; React não sabe definir srcObject por atributo. */
export function MediaElement({ stream, kind, muted = false, volume = 1, className }: Props) {
  const ref = useRef<HTMLMediaElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) el.play().catch(() => {});
  }, [stream]);

  useEffect(() => {
    if (ref.current) ref.current.volume = volume;
  }, [volume]);

  if (kind === 'audio') {
    return <audio ref={(el) => void (ref.current = el)} autoPlay muted={muted} />;
  }
  return (
    <video ref={(el) => void (ref.current = el)} className={className} autoPlay playsInline muted={muted} />
  );
}
