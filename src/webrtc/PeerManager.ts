import type { Signal } from './signaling';

export interface LocalTrack {
  track: MediaStreamTrack;
  stream: MediaStream;
  /** Bitrate máximo do encoder (bps); undefined = padrão do navegador. */
  maxBitrate?: number;
  maxFramerate?: number;
  degradationPreference?: RTCDegradationPreference;
}

export interface PeerManagerEvents {
  onRemoteStreams(peerId: string, streams: MediaStream[]): void;
  onConnectionState(peerId: string, state: RTCPeerConnectionState): void;
}

interface Peer {
  id: string;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  senders: Map<MediaStreamTrack, RTCRtpSender>;
  remoteStreams: Map<string, MediaStream>;
  pendingCandidates: RTCIceCandidateInit[];
  /** Fila para processar sinais um de cada vez (evita corrida entre offer/answer/candidates). */
  queue: Promise<void>;
}

/**
 * Malha WebRTC: uma RTCPeerConnection por participante, usando o padrão
 * "perfect negotiation" para que qualquer lado possa (re)negociar a qualquer momento
 * (ex.: quando alguém começa ou para de compartilhar a tela).
 */
export class PeerManager {
  private peers = new Map<string, Peer>();
  private localTracks: LocalTrack[] = [];

  constructor(
    private selfId: string,
    private iceServers: RTCIceServer[],
    private sendSignal: (to: string, signal: Signal) => void,
    private events: PeerManagerEvents,
  ) {}

  has(peerId: string): boolean {
    return this.peers.has(peerId);
  }

  ensurePeer(peerId: string): Peer {
    const existing = this.peers.get(peerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer: Peer = {
      id: peerId,
      pc,
      // Comparação determinística: os dois lados concordam sobre quem cede numa colisão.
      polite: this.selfId < peerId,
      makingOffer: false,
      ignoreOffer: false,
      senders: new Map(),
      remoteStreams: new Map(),
      pendingCandidates: [],
      queue: Promise.resolve(),
    };
    this.peers.set(peerId, peer);

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) {
          this.sendSignal(peerId, { type: 'description', description: pc.localDescription.toJSON() });
        }
      } catch (err) {
        console.warn('[webrtc] falha ao criar offer', err);
      } finally {
        peer.makingOffer = false;
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.sendSignal(peerId, { type: 'candidate', candidate: candidate.toJSON() });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce();
      this.events.onConnectionState(peerId, pc.connectionState);
    };

    pc.onsignalingstatechange = () => {
      // Os encodings só existem de fato depois da negociação; reaplica limites de bitrate.
      if (pc.signalingState === 'stable') this.applyAllEncodings(peer);
    };

    pc.ontrack = ({ track, streams }) => {
      const owned = streams.length ? streams : [new MediaStream([track])];
      for (const stream of owned) {
        if (!peer.remoteStreams.has(stream.id)) {
          peer.remoteStreams.set(stream.id, stream);
          stream.onremovetrack = () => {
            if (stream.getTracks().length === 0) peer.remoteStreams.delete(stream.id);
            this.emitStreams(peer);
          };
          stream.onaddtrack = () => this.emitStreams(peer);
        }
      }
      track.onunmute = () => this.emitStreams(peer);
      this.emitStreams(peer);
    };

    // Uma conexão sem nenhuma track nunca dispara negotiationneeded (ex.: microfone negado).
    // Um transceiver de recepção garante que a conexão aconteça e que ainda dá para ouvir os outros.
    if (this.localTracks.every((t) => t.track.kind !== 'audio')) {
      pc.addTransceiver('audio', { direction: 'recvonly' });
    }
    for (const local of this.localTracks) this.addTrackToPeer(peer, local);

    this.events.onConnectionState(peerId, pc.connectionState);
    return peer;
  }

  removePeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    peer.pc.onnegotiationneeded = null;
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.onsignalingstatechange = null;
    peer.pc.close();
    this.peers.delete(peerId);
  }

  handleSignal(from: string, signal: Signal): void {
    const peer = this.ensurePeer(from);
    peer.queue = peer.queue
      .then(() => this.processSignal(peer, signal))
      .catch((err) => console.warn('[webrtc] erro ao processar sinal', err));
  }

  private async processSignal(peer: Peer, signal: Signal): Promise<void> {
    const { pc } = peer;
    if (pc.signalingState === 'closed') return;

    if (signal.type === 'description') {
      const { description } = signal;
      const offerCollision =
        description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
      peer.ignoreOffer = !peer.polite && offerCollision;
      if (peer.ignoreOffer) return;

      await pc.setRemoteDescription(description);
      for (const c of peer.pendingCandidates.splice(0)) {
        await pc.addIceCandidate(c).catch(() => {});
      }
      if (description.type === 'offer') {
        await pc.setLocalDescription();
        if (pc.localDescription) {
          this.sendSignal(peer.id, { type: 'description', description: pc.localDescription.toJSON() });
        }
      }
      return;
    }

    if (!pc.remoteDescription) {
      peer.pendingCandidates.push(signal.candidate);
      return;
    }
    try {
      await pc.addIceCandidate(signal.candidate);
    } catch (err) {
      if (!peer.ignoreOffer) throw err;
    }
  }

  addLocalTrack(local: LocalTrack): void {
    this.localTracks.push(local);
    for (const peer of this.peers.values()) this.addTrackToPeer(peer, local);
  }

  removeLocalTrack(track: MediaStreamTrack): void {
    this.localTracks = this.localTracks.filter((t) => t.track !== track);
    for (const peer of this.peers.values()) {
      const sender = peer.senders.get(track);
      if (sender && peer.pc.signalingState !== 'closed') peer.pc.removeTrack(sender);
      peer.senders.delete(track);
    }
  }

  /** Atualiza limites de encoder ao vivo (troca de qualidade durante o compartilhamento). */
  updateEncoding(track: MediaStreamTrack, patch: Partial<Omit<LocalTrack, 'track' | 'stream'>>): void {
    const local = this.localTracks.find((t) => t.track === track);
    if (!local) return;
    Object.assign(local, patch);
    for (const peer of this.peers.values()) {
      const sender = peer.senders.get(track);
      if (sender) void applyEncoding(sender, local);
    }
  }

  closeAll(): void {
    for (const id of [...this.peers.keys()]) this.removePeer(id);
    this.localTracks = [];
  }

  private addTrackToPeer(peer: Peer, local: LocalTrack): void {
    if (peer.senders.has(local.track) || peer.pc.signalingState === 'closed') return;
    const sender = peer.pc.addTrack(local.track, local.stream);
    peer.senders.set(local.track, sender);
    void applyEncoding(sender, local);
  }

  private applyAllEncodings(peer: Peer): void {
    for (const local of this.localTracks) {
      const sender = peer.senders.get(local.track);
      if (sender) void applyEncoding(sender, local);
    }
  }

  private emitStreams(peer: Peer): void {
    if (!this.peers.has(peer.id)) return;
    this.events.onRemoteStreams(peer.id, [...peer.remoteStreams.values()]);
  }
}

async function applyEncoding(sender: RTCRtpSender, local: LocalTrack): Promise<void> {
  if (local.maxBitrate === undefined && local.maxFramerate === undefined && !local.degradationPreference) return;
  try {
    const params = sender.getParameters();
    if (!params.encodings?.length) return; // ainda não negociado; reaplicado quando ficar 'stable'
    for (const enc of params.encodings) {
      if (local.maxBitrate !== undefined) enc.maxBitrate = local.maxBitrate;
      if (local.maxFramerate !== undefined) enc.maxFramerate = local.maxFramerate;
    }
    if (local.degradationPreference) {
      (params as RTCRtpSendParameters & { degradationPreference?: RTCDegradationPreference }).degradationPreference =
        local.degradationPreference;
    }
    await sender.setParameters(params);
  } catch (err) {
    console.warn('[webrtc] não foi possível aplicar parâmetros do encoder', err);
  }
}
