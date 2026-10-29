import { loadString, saveString } from './storage';

export const MAX_VOLUME = 2;

// Guardado pelo nome: o id do participante muda a cada entrada na sala.
const key = (name: string) => `disc:volume:${name.trim().toLowerCase()}`;

export function clampVolume(v: number): number {
  return Number.isFinite(v) ? Math.min(MAX_VOLUME, Math.max(0, v)) : 1;
}

export function loadPeerVolume(name: string): number {
  const raw = loadString(key(name));
  return raw === '' ? 1 : clampVolume(Number(raw));
}

export function savePeerVolume(name: string, volume: number): void {
  saveString(key(name), String(clampVolume(volume)));
}
