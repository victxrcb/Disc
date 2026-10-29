import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { isSafeImageDataUrl } from '../lib/chatImage';
import { cleanSoundName, isSafeSoundDataUrl } from '../lib/soundpad';

export interface PresenceMeta {
  id: string;
  name: string;
  joinedAt: number;
  muted: boolean;
  /** id do MediaStream da tela compartilhada (permite ao outro lado distinguir do microfone). */
  screenStreamId: string | null;
}

export type Signal =
  | { type: 'description'; description: RTCSessionDescriptionInit }
  | { type: 'candidate'; candidate: RTCIceCandidateInit };

export interface ChatMessage {
  id: string;
  from: string;
  name: string;
  text: string;
  ts: number;
  /** data URL de imagem já comprimida (ver lib/chatImage). */
  image?: string;
}

/** Efeito do soundpad tocado por alguém da sala. */
export interface SoundEvent {
  from: string;
  /** Nome de quem tocou. */
  by: string;
  /** Nome do som. */
  name: string;
  data: string;
}

interface SignalEnvelope {
  from: string;
  to: string;
  signal: Signal;
}

export interface SignalingHandlers {
  onPresence(participants: PresenceMeta[]): void;
  onSignal(from: string, signal: Signal): void;
  onChat(message: ChatMessage): void;
  onSound(sound: SoundEvent): void;
  onError(message: string): void;
}

/**
 * Um canal Realtime por sala: presence diz quem está na sala, broadcast leva
 * mensagens WebRTC (endereçadas por `to`) e o chat.
 */
export class Signaling {
  private channel: RealtimeChannel;
  private meta: PresenceMeta;
  private closed = false;

  constructor(roomCode: string, meta: PresenceMeta, private handlers: SignalingHandlers) {
    if (!supabase) throw new Error('Supabase não configurado');
    this.meta = meta;
    this.channel = supabase.channel(`room:${roomCode}`, {
      config: {
        broadcast: { self: false, ack: false },
        presence: { key: meta.id },
      },
    });

    this.channel
      .on('presence', { event: 'sync' }, () => {
        const state = this.channel.presenceState<PresenceMeta>();
        const participants = Object.values(state)
          .map((metas) => metas[metas.length - 1])
          .filter((m): m is PresenceMeta & { presence_ref: string } => Boolean(m?.id))
          .map(({ id, name, joinedAt, muted, screenStreamId }) => ({ id, name, joinedAt, muted, screenStreamId }));
        this.handlers.onPresence(participants);
      })
      .on('broadcast', { event: 'signal' }, ({ payload }) => {
        const env = payload as SignalEnvelope;
        if (env?.to === this.meta.id) this.handlers.onSignal(env.from, env.signal);
      })
      .on('broadcast', { event: 'chat' }, ({ payload }) => {
        const msg = payload as ChatMessage;
        if (!msg?.id || typeof msg.text !== 'string') return;
        // Imagem inválida (ou SVG) é descartada; a mensagem só passa se sobrar texto ou imagem.
        const image = isSafeImageDataUrl(msg.image) ? msg.image : undefined;
        if (!msg.text && !image) return;
        this.handlers.onChat({ id: msg.id, from: msg.from, name: msg.name, text: msg.text, ts: msg.ts, image });
      })
      .on('broadcast', { event: 'sound' }, ({ payload }) => {
        const s = payload as SoundEvent;
        const name = cleanSoundName(s?.name);
        if (typeof s?.from !== 'string' || !name || !isSafeSoundDataUrl(s.data)) return;
        this.handlers.onSound({ from: s.from, by: cleanSoundName(s.by) || 'Alguém', name, data: s.data });
      });
  }

  join(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      this.channel.subscribe(async (status, err) => {
        if (this.closed) return;
        if (status === 'SUBSCRIBED') {
          await this.channel.track(this.meta);
          if (!settled) {
            settled = true;
            resolve();
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          const message = err?.message ?? 'Falha ao conectar no servidor de sinalização';
          if (!settled) {
            settled = true;
            reject(new Error(message));
          } else {
            // Reconexões depois de entrar são tentadas automaticamente pelo cliente Realtime.
            this.handlers.onError(message);
          }
        }
      });
    });
  }

  updateMeta(patch: Partial<Omit<PresenceMeta, 'id'>>): void {
    this.meta = { ...this.meta, ...patch };
    if (!this.closed) void this.channel.track(this.meta);
  }

  sendSignal(to: string, signal: Signal): void {
    if (this.closed) return;
    const payload: SignalEnvelope = { from: this.meta.id, to, signal };
    void this.channel.send({ type: 'broadcast', event: 'signal', payload });
  }

  sendChat(message: ChatMessage): void {
    if (this.closed) return;
    void this.channel.send({ type: 'broadcast', event: 'chat', payload: message });
  }

  sendSound(sound: SoundEvent): void {
    if (this.closed) return;
    void this.channel.send({ type: 'broadcast', event: 'sound', payload: sound });
  }

  async leave(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.channel.untrack();
    } catch {
      /* canal pode já ter caído */
    }
    await supabase?.removeChannel(this.channel);
  }
}
