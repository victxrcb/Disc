import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getIceServers } from '../lib/iceServers';
import {
  DEFAULT_QUALITY,
  QUALITY_PRESETS,
  SCREEN_AUDIO_BITRATE,
  videoConstraints,
  type QualityId,
  type QualityPreset,
} from '../lib/quality';
import { PeerManager } from '../webrtc/PeerManager';
import { Signaling, type ChatMessage, type PresenceMeta } from '../webrtc/signaling';
import { isSafeImageDataUrl } from '../lib/chatImage';

export const MAX_PARTICIPANTS = 5;
const MAX_MESSAGES = 500;
export const MAX_MESSAGE_LENGTH = 2000;

export type RoomStatus = 'joining' | 'joined' | 'full' | 'error';

export interface Participant extends PresenceMeta {
  isSelf: boolean;
  connection: RTCPeerConnectionState | null;
  micStream: MediaStream | null;
  screenStream: MediaStream | null;
}

export interface RoomState {
  status: RoomStatus;
  error: string | null;
  micError: string | null;
  shareError: string | null;
  selfId: string;
  participants: Participant[];
  messages: ChatMessage[];
  muted: boolean;
  sharing: boolean;
  shareHasAudio: boolean;
  quality: QualityId;
  toggleMute(): void;
  startShare(): Promise<void>;
  stopShare(): void;
  setQuality(id: QualityId): void;
  sendChat(text: string, image?: string): void;
}

function micErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError') return 'Microfone bloqueado. Você entrou só para ouvir — libere o microfone no navegador e entre de novo.';
  if (name === 'NotFoundError') return 'Nenhum microfone encontrado. Você entrou só para ouvir.';
  return 'Não foi possível usar o microfone. Você entrou só para ouvir.';
}

function applyPresetToTrack(track: MediaStreamTrack, q: QualityPreset): void {
  track.contentHint = q.frameRate >= 60 ? 'motion' : 'detail';
}

function encodingFor(q: QualityPreset) {
  return {
    maxBitrate: q.maxBitrate,
    maxFramerate: q.frameRate,
    // Texto/código: mantém a nitidez e sacrifica fps. 60fps (jogos/vídeo): mantém a fluidez.
    degradationPreference: (q.frameRate >= 60 ? 'maintain-framerate' : 'maintain-resolution') as RTCDegradationPreference,
  };
}

type OwnAudioSettings = MediaTrackSettings & { restrictOwnAudio?: boolean; displaySurface?: string };

/**
 * Áudio da tela inteira inclui o som da própria chamada. Garante restrictOwnAudio quando o
 * navegador suporta; se não suportar, avisa (quem ouve escutaria a própria voz de volta).
 */
async function excludeOwnAudio(audio: MediaStreamTrack, video: MediaStreamTrack | undefined): Promise<string | null> {
  const surface = (video?.getSettings() as OwnAudioSettings | undefined)?.displaySurface;
  if (surface !== 'monitor') return null; // aba/janela não capturam o áudio desta página
  if ((audio.getSettings() as OwnAudioSettings).restrictOwnAudio) return null;
  try {
    await audio.applyConstraints({ restrictOwnAudio: true } as MediaTrackConstraints);
  } catch {
    /* sem suporte */
  }
  if ((audio.getSettings() as OwnAudioSettings).restrictOwnAudio) return null;
  return 'Seu navegador vai enviar o som da chamada junto com o áudio da tela, e os outros vão ouvir a própria voz de volta. Use fone de ouvido ou compartilhe uma aba em vez da tela inteira.';
}

export function useRoom(roomCode: string, name: string): RoomState {
  const selfId = useMemo(() => crypto.randomUUID(), [roomCode]);

  const [status, setStatus] = useState<RoomStatus>('joining');
  const [error, setError] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [presence, setPresence] = useState<PresenceMeta[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream[]>>({});
  const [connStates, setConnStates] = useState<Record<string, RTCPeerConnectionState>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [quality, setQualityState] = useState<QualityId>(DEFAULT_QUALITY);

  const signalingRef = useRef<Signaling | null>(null);
  const peersRef = useRef<PeerManager | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStream | null>(null);
  const qualityRef = useRef<QualityId>(DEFAULT_QUALITY);
  const mutedRef = useRef(false);

  const pushMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      const next = [...prev, msg];
      return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
    });
  }, []);

  const stopShareInternal = useCallback(() => {
    const stream = screenRef.current;
    if (!stream) return;
    screenRef.current = null;
    for (const track of stream.getTracks()) {
      track.onended = null;
      track.stop();
      peersRef.current?.removeLocalTrack(track);
    }
    setScreenStream(null);
    setShareError(null);
    signalingRef.current?.updateMeta({ screenStreamId: null });
  }, []);

  useEffect(() => {
    let disposed = false;
    let decided = false;
    const seenPeers = new Set<string>();
    let signaling: Signaling | null = null;
    let peers: PeerManager | null = null;

    const cleanup = () => {
      if (screenRef.current) {
        for (const t of screenRef.current.getTracks()) {
          t.onended = null;
          t.stop();
        }
        screenRef.current = null;
      }
      micRef.current?.getTracks().forEach((t) => t.stop());
      micRef.current = null;
      peers?.closeAll();
      void signaling?.leave();
      signalingRef.current = null;
      peersRef.current = null;
    };

    const run = async () => {
      let mic: MediaStream | null = null;
      try {
        mic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
      } catch (err) {
        setMicError(micErrorMessage(err));
      }
      if (disposed) {
        mic?.getTracks().forEach((t) => t.stop());
        return;
      }
      micRef.current = mic;
      setMicStream(mic);

      peers = new PeerManager(
        selfId,
        getIceServers(),
        (to, signal) => signaling?.sendSignal(to, signal),
        {
          onRemoteStreams: (peerId, streams) => setRemoteStreams((prev) => ({ ...prev, [peerId]: streams })),
          onConnectionState: (peerId, state) => setConnStates((prev) => ({ ...prev, [peerId]: state })),
        },
      );
      peersRef.current = peers;
      const micTrack = mic?.getAudioTracks()[0];
      if (mic && micTrack) peers.addLocalTrack({ track: micTrack, stream: mic });

      signaling = new Signaling(
        roomCode,
        { id: selfId, name, joinedAt: Date.now(), muted: false, screenStreamId: null },
        {
          onPresence: (list) => {
            if (disposed || !peers) return;
            const others = list.filter((p) => p.id !== selfId);

            if (!decided) {
              // Só decide depois de se ver na presença (garante que a lista já veio do servidor).
              if (!list.some((p) => p.id === selfId)) return;
              decided = true;
              if (others.length >= MAX_PARTICIPANTS) {
                setStatus('full');
                disposed = true;
                cleanup();
                return;
              }
              setStatus('joined');
            }

            for (const p of others) {
              seenPeers.add(p.id);
              peers.ensurePeer(p.id);
            }
            for (const id of [...seenPeers]) {
              if (others.some((p) => p.id === id)) continue;
              seenPeers.delete(id);
              peers.removePeer(id);
              setRemoteStreams(({ [id]: _gone, ...rest }) => rest);
              setConnStates(({ [id]: _gone, ...rest }) => rest);
            }
            setPresence(list);
          },
          onSignal: (from, signal) => {
            if (!disposed) peers?.handleSignal(from, signal);
          },
          onChat: (msg) => {
            if (!disposed) pushMessage(msg);
          },
          onError: (message) => {
            if (!disposed) setError(message);
          },
        },
      );
      signalingRef.current = signaling;

      try {
        await signaling.join();
        if (!disposed) setError(null);
      } catch (err) {
        if (disposed) return;
        setStatus('error');
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    void run();
    window.addEventListener('beforeunload', cleanup);
    return () => {
      disposed = true;
      window.removeEventListener('beforeunload', cleanup);
      cleanup();
    };
  }, [roomCode, name, selfId, pushMessage]);

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    micRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMuted(next);
    signalingRef.current?.updateMeta({ muted: next });
  }, []);

  const startShare = useCallback(async () => {
    if (screenRef.current || !peersRef.current) return;
    setShareError(null);
    const q = QUALITY_PRESETS[qualityRef.current];

    let stream: MediaStream;
    try {
      // systemAudio/selfBrowserSurface/restrictOwnAudio ainda não estão nos tipos do TS, mas Chrome/Edge os aceitam.
      const options = {
        video: videoConstraints(q),
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          suppressLocalAudioPlayback: false,
          // Tira da captura do sistema o som tocado por esta página (as vozes da chamada);
          // sem isso, quem fala ouve a própria voz voltar pela transmissão.
          restrictOwnAudio: true,
        },
        systemAudio: 'include',
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
      } as DisplayMediaStreamOptions;
      stream = await navigator.mediaDevices.getDisplayMedia(options);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') return; // usuário cancelou
      setShareError('Não foi possível compartilhar a tela.');
      return;
    }

    let echoWarning: string | null = null;
    for (const audio of stream.getAudioTracks()) {
      echoWarning ??= await excludeOwnAudio(audio, stream.getVideoTracks()[0]);
    }

    const peers = peersRef.current;
    if (!peers) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    screenRef.current = stream;
    const [video] = stream.getVideoTracks();
    if (video) {
      applyPresetToTrack(video, q);
      video.onended = () => stopShareInternal(); // botão "Parar de compartilhar" do navegador
      peers.addLocalTrack({ track: video, stream, ...encodingFor(q) });
    }
    for (const audio of stream.getAudioTracks()) {
      audio.contentHint = 'music';
      peers.addLocalTrack({ track: audio, stream, maxBitrate: SCREEN_AUDIO_BITRATE });
    }

    setScreenStream(stream);
    if (echoWarning) setShareError(echoWarning);
    signalingRef.current?.updateMeta({ screenStreamId: stream.id });
  }, [stopShareInternal]);

  const setQuality = useCallback((id: QualityId) => {
    qualityRef.current = id;
    setQualityState(id);
    const video = screenRef.current?.getVideoTracks()[0];
    if (!video) return;
    const q = QUALITY_PRESETS[id];
    applyPresetToTrack(video, q);
    video.applyConstraints(videoConstraints(q)).catch((err) => console.warn('[share] applyConstraints', err));
    peersRef.current?.updateEncoding(video, encodingFor(q));
  }, []);

  const sendChat = useCallback(
    (raw: string, image?: string) => {
      const text = raw.trim().slice(0, MAX_MESSAGE_LENGTH);
      const safeImage = isSafeImageDataUrl(image) ? image : undefined;
      if ((!text && !safeImage) || !signalingRef.current) return;
      const msg: ChatMessage = { id: crypto.randomUUID(), from: selfId, name, text, ts: Date.now(), image: safeImage };
      signalingRef.current.sendChat(msg);
      pushMessage(msg);
    },
    [name, selfId, pushMessage],
  );

  const participants = useMemo<Participant[]>(() => {
    const list = presence.some((p) => p.id === selfId)
      ? presence
      : [...presence, { id: selfId, name, joinedAt: Date.now(), muted, screenStreamId: screenStream?.id ?? null }];

    return [...list]
      .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id))
      .map((p) => {
        if (p.id === selfId) {
          return {
            ...p,
            muted,
            screenStreamId: screenStream?.id ?? null,
            isSelf: true,
            connection: null,
            micStream,
            screenStream,
          };
        }
        const streams = remoteStreams[p.id] ?? [];
        const screen = p.screenStreamId ? streams.find((s) => s.id === p.screenStreamId) ?? null : null;
        const mic = streams.find((s) => s.id !== p.screenStreamId && s.getAudioTracks().length > 0) ?? null;
        return {
          ...p,
          isSelf: false,
          connection: connStates[p.id] ?? null,
          micStream: mic,
          screenStream: screen && screen.getVideoTracks().length > 0 ? screen : null,
        };
      });
  }, [presence, selfId, name, muted, micStream, screenStream, remoteStreams, connStates]);

  return {
    status,
    error,
    micError,
    shareError,
    selfId,
    participants,
    messages,
    muted,
    sharing: screenStream !== null,
    shareHasAudio: (screenStream?.getAudioTracks().length ?? 0) > 0,
    quality,
    toggleMute,
    startShare,
    stopShare: stopShareInternal,
    setQuality,
    sendChat,
  };
}
