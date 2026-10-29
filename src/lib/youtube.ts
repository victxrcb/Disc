// Tipos mínimos da IFrame API do YouTube (https://developers.google.com/youtube/iframe_api_reference).

export const YT_STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

export interface YTPlayer {
  loadVideoById(opts: { videoId: string; startSeconds?: number }): void;
  cueVideoById(opts: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setVolume(volume: number): void;
  getVideoData(): { title?: string; video_id?: string };
  destroy(): void;
}

interface YTPlayerOptions {
  width?: string | number;
  height?: string | number;
  host?: string;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (e: { target: YTPlayer }) => void;
    onStateChange?: (e: { data: number; target: YTPlayer }) => void;
    onError?: (e: { data: number; target: YTPlayer }) => void;
  };
}

interface YTNamespace {
  Player: new (el: HTMLElement, opts: YTPlayerOptions) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

export function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      apiPromise = null;
      reject(new Error('Não foi possível carregar o player do YouTube.'));
    };
    document.head.appendChild(script);
  });
  return apiPromise;
}

export function createPlayer(el: HTMLElement, events: YTPlayerOptions['events']): Promise<YTPlayer> {
  return loadYouTubeApi().then(
    (YT) =>
      new Promise<YTPlayer>((resolve) => {
        const player = new YT.Player(el, {
          width: '100%',
          height: '100%',
          host: 'https://www.youtube-nocookie.com',
          playerVars: { controls: 0, disablekb: 1, rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0, origin: location.origin },
          events: {
            ...events,
            onReady: (e) => {
              events?.onReady?.(e);
              resolve(player);
            },
          },
        });
      }),
  );
}

/** Mensagem para os códigos de erro do player. */
export function youTubeErrorMessage(code: number): string {
  if (code === 101 || code === 150) return 'O dono deste vídeo não permite tocar fora do YouTube. Pulando…';
  if (code === 100) return 'Vídeo não encontrado ou privado. Pulando…';
  return 'Não foi possível tocar este vídeo. Pulando…';
}
