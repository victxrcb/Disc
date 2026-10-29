const PATHS = {
  camera: 'M3 6h12v12H3zM15 10l6-4v12l-6-4',
  cameraOff: 'M3 3l18 18M3 6h12v6M15 10l6-4v12M3 6v12h12v-3',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  micOff: 'M3 3l18 18M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.7-1.3M5 11a7 7 0 0 0 11.5 5.4M19 11a7 7 0 0 1-.6 2.8M12 18v3',
  screen: 'M3 5h18v11H3zM8 20h8M12 16v4',
  screenOff: 'M3 5h18v11H3zM8 20h8M12 16v4M9 8.5l6 5M15 8.5l-6 5',
  chat: 'M4 5h16v11H8l-4 4z',
  leave: 'M10 4H5v16h5M14 8l4 4-4 4M18 12H9',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  check: 'M5 12l5 5L20 7',
  volume: 'M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11',
  soundpad: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM15 14.5v5l4-2.5z',
  play: 'M7 4.5v15l12-7.5z',
  stop: 'M6 6h12v12H6z',
  pause: 'M8 5v14M16 5v14',
  next: 'M5 5l10 7-10 7zM19 5v14',
  music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  image:'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.5h.01',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  volumeOff:'M4 9h4l5-4v14l-5-4H4zM16 9.5l5 5M21 9.5l-5 5',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  close: 'M6 6l12 12M18 6L6 18',
  send: 'M4 12l16-8-6 16-2-6z',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
} as const;

export type IconName = keyof typeof PATHS;

/** Tamanhos padronizados: 20 em botões e controles, 16 em rótulos e selos. */
export type IconSize = 16 | 20 | 28;

export function Icon({ name, size = 20 }: { name: IconName; size?: IconSize }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
