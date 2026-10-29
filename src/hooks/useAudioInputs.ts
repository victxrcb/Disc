import { useEffect, useState } from 'react';

export interface AudioInput {
  id: string;
  label: string;
}

/** Microfones disponíveis; atualiza sozinho quando algum é conectado ou removido. */
export function useAudioInputs(enabled: boolean): AudioInput[] {
  const [inputs, setInputs] = useState<AudioInput[]>([]);

  useEffect(() => {
    if (!enabled || !navigator.mediaDevices?.enumerateDevices) return;
    let cancelled = false;

    const refresh = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        const list = devices
          // "default" e "communications" são atalhos do Chrome para o padrão; já temos essa opção.
          .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
          .map((d, i) => ({ id: d.deviceId, label: d.label || `Microfone ${i + 1}` }));
        setInputs(list);
      } catch {
        if (!cancelled) setInputs([]);
      }
    };

    void refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener('devicechange', refresh);
    };
  }, [enabled]);

  return inputs;
}
