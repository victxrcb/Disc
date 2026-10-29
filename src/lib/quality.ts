export type QualityId = '720p30' | '1080p30' | '1080p60';

export interface QualityPreset {
  id: QualityId;
  label: string;
  width: number;
  height: number;
  frameRate: number;
  /** Bitrate máximo de vídeo por participante (bps). */
  maxBitrate: number;
}

export const QUALITY_PRESETS: Record<QualityId, QualityPreset> = {
  '720p30': { id: '720p30', label: '720p · 30fps', width: 1280, height: 720, frameRate: 30, maxBitrate: 2_500_000 },
  '1080p30': { id: '1080p30', label: '1080p · 30fps', width: 1920, height: 1080, frameRate: 30, maxBitrate: 4_500_000 },
  '1080p60': { id: '1080p60', label: '1080p · 60fps', width: 1920, height: 1080, frameRate: 60, maxBitrate: 6_000_000 },
};

export const DEFAULT_QUALITY: QualityId = '1080p30';

/** Bitrate do áudio da tela compartilhada (música/jogo soa melhor que o padrão de voz). */
export const SCREEN_AUDIO_BITRATE = 128_000;

export function videoConstraints(q: QualityPreset): MediaTrackConstraints {
  return {
    width: { ideal: q.width, max: q.width },
    height: { ideal: q.height, max: q.height },
    frameRate: { ideal: q.frameRate, max: q.frameRate },
  };
}
