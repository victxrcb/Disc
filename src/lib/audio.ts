let sharedContext: AudioContext | null = null;

/** AudioContext único do app; tenta retomar se o navegador o deixou suspenso. */
export function getAudioContext(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  sharedContext ??= new AudioContext();
  if (sharedContext.state === 'suspended') void sharedContext.resume();
  return sharedContext;
}
