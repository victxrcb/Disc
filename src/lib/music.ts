// Música compartilhada da sala. Cada pessoa toca o vídeo no próprio player do YouTube;
// pelo canal da sala só trafega o estado (atual, fila, play/pause, posição).
// Convergência por "última escrita vence": maior rev, depois maior updatedAt, depois by.

export const MAX_QUEUE = 50;
const MAX_TITLE = 200;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export interface MusicTrack {
  id: string;
  videoId: string;
  title: string;
  /** Nome de quem adicionou. */
  addedBy: string;
}

export interface MusicState {
  current: MusicTrack | null;
  queue: MusicTrack[];
  playing: boolean;
  /** Posição (s) no instante updatedAt. */
  position: number;
  /** Relógio de quem fez a mudança (ms). */
  updatedAt: number;
  rev: number;
  /** Id de quem fez a mudança (desempate). */
  by: string;
}

/** Ações enviadas ao coordenador da sala, que as aplica em ordem e distribui o estado. */
export type MusicOp =
  | { kind: 'add'; track: MusicTrack }
  | { kind: 'setPlaying'; playing: boolean; position: number }
  | { kind: 'seek'; position: number }
  /** Avança se a faixa atual ainda for `trackId` (evita pular duas vezes quando várias pessoas pedem juntas). */
  | { kind: 'next'; trackId: string | null }
  | { kind: 'play'; trackId: string }
  | { kind: 'remove'; trackId: string }
  | { kind: 'move'; trackId: string; delta: -1 | 1 }
  | { kind: 'stop' };

export type MusicMessage =
  | { type: 'state'; state: MusicState }
  | { type: 'request' }
  | { type: 'op'; op: MusicOp };

export const EMPTY_MUSIC: MusicState = {
  current: null,
  queue: [],
  playing: false,
  position: 0,
  updatedAt: 0,
  rev: 0,
  by: '',
};

/** Aceita youtube.com/watch?v=, youtu.be/, /shorts/, /embed/, /live/, music.youtube.com e o id puro. */
export function parseYouTubeId(input: string): string | null {
  const text = input.trim();
  if (VIDEO_ID.test(text)) return text;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v');
    const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/);
    if (!id && m) id = m[1];
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

/** Título pelo oEmbed do YouTube (tem CORS); null se falhar. */
export async function fetchYouTubeTitle(videoId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`,
    );
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const title = (data as { title?: unknown })?.title;
    return typeof title === 'string' ? title.slice(0, MAX_TITLE) : null;
  } catch {
    return null;
  }
}

export function thumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

/** Posição esperada agora, contando o tempo desde a última mudança se estiver tocando. */
export function expectedPosition(state: MusicState, now = Date.now()): number {
  if (!state.current) return 0;
  return Math.max(0, state.position + (state.playing ? (now - state.updatedAt) / 1000 : 0));
}

export function isNewer(a: MusicState, b: MusicState): boolean {
  if (a.rev !== b.rev) return a.rev > b.rev;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt;
  return a.by > b.by;
}

// ---------- Validação do que chega pela rede ----------

function cleanTrack(t: unknown): MusicTrack | null {
  const x = t as Partial<MusicTrack> | null;
  if (!x || typeof x.id !== 'string' || x.id.length > 64) return null;
  if (typeof x.videoId !== 'string' || !VIDEO_ID.test(x.videoId)) return null;
  const title = typeof x.title === 'string' ? x.title.slice(0, MAX_TITLE) : x.videoId;
  const addedBy = typeof x.addedBy === 'string' ? x.addedBy.slice(0, 40) : '';
  return { id: x.id, videoId: x.videoId, title, addedBy };
}

const finite = (n: unknown, fallback = 0) => (typeof n === 'number' && Number.isFinite(n) ? n : fallback);

export function cleanMusicState(s: unknown): MusicState | null {
  const x = s as Partial<MusicState> | null;
  if (!x || typeof x !== 'object') return null;
  const current = x.current == null ? null : cleanTrack(x.current);
  if (x.current != null && !current) return null;
  const queue = Array.isArray(x.queue)
    ? x.queue.slice(0, MAX_QUEUE).map(cleanTrack).filter((t): t is MusicTrack => t !== null)
    : [];
  return {
    current,
    queue,
    playing: Boolean(x.playing) && current !== null,
    position: Math.max(0, finite(x.position)),
    updatedAt: finite(x.updatedAt),
    rev: Math.max(0, Math.floor(finite(x.rev))),
    by: typeof x.by === 'string' ? x.by.slice(0, 64) : '',
  };
}

function cleanOp(o: unknown): MusicOp | null {
  const x = o as Record<string, unknown> | null;
  if (!x || typeof x.kind !== 'string') return null;
  const id = (v: unknown) => (typeof v === 'string' && v.length <= 64 ? v : null);
  const pos = Math.max(0, finite(x.position));
  switch (x.kind) {
    case 'add': {
      const track = cleanTrack(x.track);
      return track ? { kind: 'add', track } : null;
    }
    case 'setPlaying':
      return { kind: 'setPlaying', playing: Boolean(x.playing), position: pos };
    case 'seek':
      return { kind: 'seek', position: pos };
    case 'next':
      return { kind: 'next', trackId: id(x.trackId) };
    case 'play':
    case 'remove': {
      const trackId = id(x.trackId);
      return trackId ? { kind: x.kind, trackId } : null;
    }
    case 'move': {
      const trackId = id(x.trackId);
      return trackId && (x.delta === 1 || x.delta === -1) ? { kind: 'move', trackId, delta: x.delta } : null;
    }
    case 'stop':
      return { kind: 'stop' };
    default:
      return null;
  }
}

// ---------- Store sincronizado ----------

type Listener = (state: MusicState) => void;

/**
 * Estado da música da sala. Um coordenador (quem está na sala há mais tempo) aplica as ações
 * de todos em ordem e distribui o estado; os demais só enviam a ação. Assim, duas pessoas
 * adicionando músicas ao mesmo tempo não se sobrescrevem. Se o coordenador sai, o próximo
 * mais antigo assume com o estado que já tinha recebido.
 */
export class MusicSync {
  private state: MusicState = EMPTY_MUSIC;
  private listeners = new Set<Listener>();
  private leaderId: string;
  private selfId: string;
  private selfName: string;
  private send: (msg: MusicMessage) => void;

  constructor(selfId: string, selfName: string, send: (msg: MusicMessage) => void) {
    this.selfId = selfId;
    this.selfName = selfName;
    this.send = send;
    this.leaderId = selfId;
  }

  getState = (): MusicState => this.state;

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** Atualiza quem está na sala; o coordenador é o mais antigo (desempate pelo id). */
  setParticipants(list: { id: string; joinedAt: number }[]): void {
    const [first] = [...list].sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1));
    this.leaderId = first?.id ?? this.selfId;
  }

  private get isLeader(): boolean {
    return this.leaderId === this.selfId;
  }

  /** Ao entrar na sala: pede o estado para quem já está lá. */
  requestState(): void {
    this.send({ type: 'request' });
  }

  receive(msg: MusicMessage): void {
    switch (msg?.type) {
      case 'request':
        if (this.state.current || this.state.queue.length) this.send({ type: 'state', state: this.state });
        return;
      case 'op': {
        const op = cleanOp(msg.op);
        if (op && this.isLeader) this.apply(op);
        return;
      }
      case 'state': {
        const next = cleanMusicState(msg.state);
        if (!next) return;
        if (isNewer(next, this.state)) this.set(next);
        // Quem mandou está atrasado (perdeu mensagens): devolve o estado atual para ele convergir.
        else if (this.state.rev > next.rev) this.send({ type: 'state', state: this.state });
      }
    }
  }

  private set(state: MusicState): void {
    this.state = state;
    this.listeners.forEach((fn) => fn(state));
  }

  private dispatch(op: MusicOp): void {
    if (this.isLeader) this.apply(op);
    else this.send({ type: 'op', op });
  }

  private commit(patch: Partial<MusicState>): void {
    const next: MusicState = {
      ...this.state,
      ...patch,
      updatedAt: Date.now(),
      rev: this.state.rev + 1,
      by: this.selfId,
    };
    if (!next.current) {
      next.playing = false;
      next.position = 0;
    }
    this.set(next);
    this.send({ type: 'state', state: next });
  }

  /** Só o coordenador chama: aplica uma ação sobre o estado atual. */
  private apply(op: MusicOp): void {
    const s = this.state;
    switch (op.kind) {
      case 'add':
        if (s.current?.id === op.track.id || s.queue.some((t) => t.id === op.track.id)) return;
        if (!s.current) return this.commit({ current: op.track, playing: true, position: 0 });
        if (s.queue.length >= MAX_QUEUE) return;
        return this.commit({ queue: [...s.queue, op.track] });
      case 'setPlaying':
        if (!s.current) return;
        return this.commit({ playing: op.playing, position: op.position });
      case 'seek':
        if (!s.current) return;
        return this.commit({ position: op.position });
      case 'next': {
        if ((s.current?.id ?? null) !== op.trackId) return;
        const [head, ...rest] = s.queue;
        return this.commit({ current: head ?? null, queue: rest, playing: Boolean(head), position: 0 });
      }
      case 'play': {
        const track = s.queue.find((t) => t.id === op.trackId);
        if (!track) return;
        return this.commit({
          current: track,
          queue: s.queue.filter((t) => t.id !== op.trackId),
          playing: true,
          position: 0,
        });
      }
      case 'remove':
        if (!s.queue.some((t) => t.id === op.trackId)) return;
        return this.commit({ queue: s.queue.filter((t) => t.id !== op.trackId) });
      case 'move': {
        const queue = [...s.queue];
        const i = queue.findIndex((t) => t.id === op.trackId);
        const j = i + op.delta;
        if (i < 0 || j < 0 || j >= queue.length) return;
        [queue[i], queue[j]] = [queue[j], queue[i]];
        return this.commit({ queue });
      }
      case 'stop':
        if (!s.current && !s.queue.length) return;
        return this.commit({ current: null, queue: [], playing: false, position: 0 });
    }
  }

  // ---------- Ações da interface ----------

  /** Resultado previsto pelo estado local (o coordenador confirma). */
  add(videoId: string, title: string): 'playing' | 'queued' | 'full' {
    if (this.state.current && this.state.queue.length >= MAX_QUEUE) return 'full';
    const track: MusicTrack = {
      id: crypto.randomUUID(),
      videoId,
      title: title.slice(0, MAX_TITLE),
      addedBy: this.selfName,
    };
    this.dispatch({ kind: 'add', track });
    return this.state.current ? 'queued' : 'playing';
  }

  togglePlay(): void {
    if (!this.state.current) return;
    this.dispatch({ kind: 'setPlaying', playing: !this.state.playing, position: expectedPosition(this.state) });
  }

  seek(seconds: number): void {
    if (this.state.current) this.dispatch({ kind: 'seek', position: Math.max(0, seconds) });
  }

  next(): void {
    this.dispatch({ kind: 'next', trackId: this.state.current?.id ?? null });
  }

  /** Fim do vídeo (ou erro). Todos detectam; o coordenador só avança uma vez. */
  ended(trackId: string): void {
    if (this.state.current?.id === trackId) this.dispatch({ kind: 'next', trackId });
  }

  play(trackId: string): void {
    this.dispatch({ kind: 'play', trackId });
  }

  remove(trackId: string): void {
    this.dispatch({ kind: 'remove', trackId });
  }

  move(trackId: string, delta: -1 | 1): void {
    this.dispatch({ kind: 'move', trackId, delta });
  }

  stop(): void {
    this.dispatch({ kind: 'stop' });
  }

  /** Corrige o título quando o player descobre o nome real (o oEmbed pode ter falhado). Só local. */
  setTitle(trackId: string, title: string): void {
    const cur = this.state.current;
    if (cur?.id !== trackId || cur.title === title) return;
    this.state = { ...this.state, current: { ...cur, title: title.slice(0, MAX_TITLE) } };
    this.listeners.forEach((fn) => fn(this.state));
  }
}
