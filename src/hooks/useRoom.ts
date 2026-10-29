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
import { Signaling, type ChatMessage, type PresenceMeta, type SoundEvent } from '../webrtc/signaling';
import { isSafeImageDataUrl } from '../lib/chatImage';
import { MusicSync } from '../lib/music';
import { loadEffectsVolume, playSoundData, type Sound } from '../lib/soundpad';
import {
  loadMicSettings,
  openMic,
  saveMicSettings,
  type MicMeter,
  type MicPipeline,
  type MicSettings,
} from '../lib/mic';

export const MAX_PARTICIPANTS = 5;
const MAX_MESSAGES = 500;
/** Antiflood do soundpad: no máximo SOUND_BURST sons por pessoa a cada SOUND_WINDOW_MS. */
const SOUND_BURST = 8;
const SOUND_WINDOW_MS = 3000;
const MAX_SOUND_TOASTS = 3;
export const MAX_MESSAGE_LENGTH = 2000;

export type RoomStatus = 'joining' | 'joined' | 'full' | 'error';

export interface Participant extends PresenceMeta {
  isSelf: boolean;
  connection: RTCPeerConnectionState | null;
  micStream: MediaStream | null;
  screenStream: MediaStream | null;
  cameraStream: MediaStream | null;
}

export type SoundToastItem = SoundEvent & { key: number };

export interface RoomState {
  status: RoomStatus;
  error: string | null;
  micError: string | null;
  shareError: string | null;
  cameraError: string | null;
  cameraOn: boolean;
  cameraBusy: boolean;
  toggleCamera(): Promise<void>;
  selfId: string;
  participants: Participant[];
  messages: ChatMessage[];
  muted: boolean;
  sharing: boolean;
  shareHasAudio: boolean;
  quality: QualityId;
  /** Entrada de áudio escolhida (dispositivo, sensibilidade e processamento). */
  micSettings: MicSettings;
  /** false quando o navegador não permite ajustar o volume da entrada (sem AudioContext). */
  micGainSupported: boolean;
  /** false quando o navegador não consegue filtrar por sensibilidade (sem AudioWorklet). */
  micGateSupported: boolean;
  /** Leitura ao vivo do volume da entrada, para o medidor. */
  micMeter(): MicMeter;
  /** Aplica mudanças na entrada. Devolve uma mensagem de erro, ou null se deu certo. */
  changeMic(patch: Partial<MicSettings>, force?: boolean): Promise<string | null>;
  toggleMute(): void;
  startShare(): Promise<void>;
  stopShare(): void;
  setQuality(id: QualityId): void;
  sendChat(text: string, image?: string): void;
  /** Toca o som para todos da sala (e para você). */
  playSound(sound: Sound): void;
  /** Sons tocados recentemente, para os avisos "Fulano tocou X" (mais novo por último). */
  soundToasts: SoundToastItem[];
  dismissSoundToast(key: number): void;
  /** Música compartilhada da sala (YouTube). */
  music: MusicSync;
}

function micErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError') return 'Microfone bloqueado. Você entrou só para ouvir — libere o microfone no navegador e entre de novo.';
  if (name === 'NotFoundError') return 'Nenhum microfone encontrado. Você entrou só para ouvir.';
  return 'Não foi possível usar o microfone. Você entrou só para ouvir.';
}

/** Mensagem para a troca de microfone no meio da chamada (a pessoa continua com o anterior). */
function micSwitchMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError') return 'O navegador não permitiu usar esse microfone.';
  if (name === 'NotFoundError') return 'Esse microfone não foi encontrado.';
  return 'Não foi possível usar esse microfone. Continuamos com o anterior.';
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
  const [soundToasts, setSoundToasts] = useState<SoundToastItem[]>([]);
  // Uma instância por entrada na sala; envia pelo canal atual (se houver).
  const music = useMemo(
    () => new MusicSync(selfId, name, (msg) => signalingRef.current?.sendMusic(msg)),
    [selfId, name],
  );
  const soundTimes = useRef(new Map<string, number[]>());
  const toastSeq = useRef(0);

  /** Registra um som de `from` se ainda couber na janela do antiflood. */
  const allowSound = useCallback((from: string) => {
    const now = Date.now();
    const recent = (soundTimes.current.get(from) ?? []).filter((t) => now - t < SOUND_WINDOW_MS);
    const allowed = recent.length < SOUND_BURST;
    if (allowed) recent.push(now);
    soundTimes.current.set(from, recent);
    return allowed;
  }, []);

  // O mesmo som da mesma pessoa repetido atualiza o aviso existente em vez de empilhar outro.
  const showSoundToast = useCallback((sound: SoundEvent) => {
    setSoundToasts((list) => {
      const rest = list.filter((t) => !(t.from === sound.from && t.name === sound.name));
      return [...rest, { ...sound, key: ++toastSeq.current }].slice(-MAX_SOUND_TOASTS);
    });
  }, []);

  const dismissSoundToast = useCallback((key: number) => {
    setSoundToasts((list) => list.filter((t) => t.key !== key));
  }, []);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraBusy, setCameraBusy] = useState(false);
  const cameraRef = useRef<MediaStream | null>(null);
  const cameraPending = useRef(false);
  const cameraSeq = useRef(0);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [micSettings, setMicSettings] = useState<MicSettings>(loadMicSettings);
  const [micGainSupported, setMicGainSupported] = useState(true);
  const [micGateSupported, setMicGateSupported] = useState(false);
  const [quality, setQualityState] = useState<QualityId>(DEFAULT_QUALITY);

  const signalingRef = useRef<Signaling | null>(null);
  const peersRef = useRef<PeerManager | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStream | null>(null);
  const qualityRef = useRef<QualityId>(DEFAULT_QUALITY);
  const mutedRef = useRef(false);
  const micSettingsRef = useRef(micSettings);
  const pipelineRef = useRef<MicPipeline | null>(null);
  const micSeq = useRef(0);
  const changeMicRef = useRef<RoomState['changeMic']>(async () => null);

  const pushMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      const next = [...prev, msg];
      return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
    });
  }, []);

  const stopCamera = useCallback(() => {
    const stream = cameraRef.current;
    cameraRef.current = null;
    for (const track of stream?.getTracks() ?? []) {
      track.onended = null;
      peersRef.current?.removeLocalTrack(track);
      track.stop();
    }
    setCameraStream(null);
    signalingRef.current?.updateMeta({ cameraStreamId: null });
  }, []);

  const toggleCamera = useCallback(async () => {
    if (cameraRef.current) {
      stopCamera();
      return;
    }
    const peers = peersRef.current;
    if (cameraPending.current || !peers) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Câmera indisponível. Abra a chamada por HTTPS em um navegador compatível.');
      return;
    }
    cameraPending.current = true;
    setCameraBusy(true);
    setCameraError(null);
    const request = ++cameraSeq.current;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 1280 }, height: { ideal: 720 },
          frameRate: { ideal: 24, max: 30 },
        },
      });
      // Uma permissão concedida depois de sair nunca deve deixar a câmera ligada.
      if (request !== cameraSeq.current || peersRef.current !== peers) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const track = stream.getVideoTracks()[0];
      if (!track || track.readyState === 'ended') throw new Error('Câmera sem vídeo');
      track.contentHint = 'motion';
      cameraRef.current = stream;
      track.onended = () => {
        if (cameraRef.current !== stream) return;
        stopCamera();
        setCameraError('A câmera foi desconectada ou interrompida. Tente ligá-la novamente.');
      };
      peers.addLocalTrack({ track, stream, maxBitrate: 1_500_000, maxFramerate: 30 });
      setCameraStream(stream);
      signalingRef.current?.updateMeta({ cameraStreamId: stream.id });
    } catch (err) {
      stream?.getTracks().forEach((track) => {
        track.onended = null;
        peers.removeLocalTrack(track);
        track.stop();
      });
      if (request !== cameraSeq.current || peersRef.current !== peers) return;
      cameraRef.current = null;
      setCameraStream(null);
      const reason = err instanceof DOMException ? err.name : '';
      setCameraError(reason === 'NotAllowedError'
        ? 'Câmera bloqueada. Permita o acesso à câmera nas configurações do navegador e tente novamente.'
        : reason === 'NotFoundError'
          ? 'Nenhuma câmera encontrada neste dispositivo.'
          : 'Não foi possível ligar a câmera. Verifique se ela está em uso em outro aplicativo.');
    } finally {
      if (request === cameraSeq.current) {
        cameraPending.current = false;
        setCameraBusy(false);
      }
    }
  }, [stopCamera]);

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
      cameraSeq.current++;
      cameraPending.current = false;
      for (const track of cameraRef.current?.getTracks() ?? []) {
        track.onended = null;
        track.stop();
      }
      cameraRef.current = null;
      if (screenRef.current) {
        for (const t of screenRef.current.getTracks()) {
          t.onended = null;
          t.stop();
        }
        screenRef.current = null;
      }
      micRef.current?.getTracks().forEach((t) => t.stop());
      micRef.current = null;
      pipelineRef.current?.close();
      pipelineRef.current = null;
      peers?.closeAll();
      void signaling?.leave();
      signalingRef.current = null;
      peersRef.current = null;
    };

    // Microfone desconectado em uso: tenta o padrão do sistema; sem nenhum, avisa que ficou mudo.
    const onMicLost = (lost: MicPipeline) => {
      if (disposed || pipelineRef.current !== lost) return;
      void changeMicRef.current({ deviceId: '' }, true).then((message) => {
        if (message && !disposed && pipelineRef.current === lost) {
          setMicError('O microfone foi desconectado e nenhum outro foi encontrado. Você segue só ouvindo.');
        }
      });
    };

    const run = async () => {
      let pipeline: MicPipeline | null = null;
      try {
        pipeline = await openMic(micSettingsRef.current, onMicLost);
      } catch (err) {
        setMicError(micErrorMessage(err));
      }
      if (disposed) {
        pipeline?.close();
        return;
      }
      // O stream enviado aos peers é estável: trocar de microfone só troca a faixa dentro dele.
      const mic = pipeline ? new MediaStream([pipeline.track]) : null;
      pipelineRef.current = pipeline;
      micRef.current = mic;
      setMicStream(mic);
      setMicGainSupported(pipeline?.gainSupported ?? true);
      setMicGateSupported(pipeline?.gateSupported ?? false);

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
              music.requestState(); // quem já está na sala responde com a música atual
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
            music.setParticipants(list);
          },
          onSignal: (from, signal) => {
            if (!disposed) peers?.handleSignal(from, signal);
          },
          onChat: (msg) => {
            if (!disposed) pushMessage(msg);
          },
          onSound: (sound) => {
            if (disposed) return;
            if (!allowSound(sound.from)) return;
            playSoundData(sound.data, loadEffectsVolume());
            showSoundToast(sound);
          },
          onMusic: (msg) => {
            if (!disposed) music.receive(msg);
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
  }, [roomCode, name, selfId, pushMessage, music]);

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    micRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMuted(next);
    signalingRef.current?.updateMeta({ muted: next });
  }, []);

  const changeMic = useCallback(async (patch: Partial<MicSettings>, force = false): Promise<string | null> => {
    const prev = micSettingsRef.current;
    const next = { ...prev, ...patch };
    micSettingsRef.current = next;
    setMicSettings(next);
    saveMicSettings(next);

    const current = pipelineRef.current;
    if (!current) return null;
    const reopen =
      force ||
      next.deviceId !== prev.deviceId ||
      next.noiseSuppression !== prev.noiseSuppression ||
      next.echoCancellation !== prev.echoCancellation ||
      next.autoGainControl !== prev.autoGainControl;
    if (!reopen) {
      current.setGain(next.gain);
      current.setGate(next.gate, next.gateThreshold);
      return null;
    }

    const seq = ++micSeq.current;
    let fresh: MicPipeline;
    try {
      fresh = await openMic(next, (lost) => {
        if (pipelineRef.current === lost) void changeMicRef.current({ deviceId: '' }, true);
      });
    } catch (err) {
      // Mantém o que estava funcionando e desfaz a escolha.
      if (seq === micSeq.current && pipelineRef.current === current) {
        const restored = { ...micSettingsRef.current, ...prev, gain: micSettingsRef.current.gain };
        micSettingsRef.current = restored;
        setMicSettings(restored);
        saveMicSettings(restored);
      }
      return micSwitchMessage(err);
    }
    if (seq !== micSeq.current || pipelineRef.current !== current) {
      fresh.close(); // outra troca (ou a saída da sala) passou na frente
      return null;
    }

    const stream = micRef.current;
    const oldTrack = current.track;
    fresh.track.enabled = !mutedRef.current;
    fresh.setGain(micSettingsRef.current.gain);
    fresh.setGate(micSettingsRef.current.gate, micSettingsRef.current.gateThreshold);
    pipelineRef.current = fresh;
    if (stream) {
      stream.removeTrack(oldTrack);
      stream.addTrack(fresh.track);
    }
    setMicGainSupported(fresh.gainSupported);
    setMicGateSupported(fresh.gateSupported);
    setMicStream(new MediaStream([fresh.track]));
    // Dispositivo escolhido não existia mais: segue no padrão e guarda isso.
    if (next.deviceId && fresh.deviceId && fresh.deviceId !== next.deviceId) {
      const synced = { ...micSettingsRef.current, deviceId: '' };
      micSettingsRef.current = synced;
      setMicSettings(synced);
      saveMicSettings(synced);
    }
    await peersRef.current?.replaceLocalTrack(oldTrack, fresh.track);
    current.close();
    setMicError(null);
    return null;
  }, []);
  changeMicRef.current = changeMic;

  const micMeter = useCallback(
    (): MicMeter => pipelineRef.current?.meter() ?? { db: -70, open: true, threshold: micSettingsRef.current.gateThreshold },
    [],
  );

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

  const playSound = useCallback(
    (sound: Sound) => {
      if (!allowSound(selfId)) return;
      const event: SoundEvent = { from: selfId, by: name, name: sound.name, data: sound.data, duration: sound.duration };
      signalingRef.current?.sendSound(event);
      playSoundData(sound.data, loadEffectsVolume());
      showSoundToast(event);
    },
    [name, selfId, allowSound, showSoundToast],
  );

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
            cameraStream,
          };
        }
        const streams = remoteStreams[p.id] ?? [];
        const screen = p.screenStreamId ? streams.find((s) => s.id === p.screenStreamId) ?? null : null;
        const camera = p.cameraStreamId ? streams.find((stream) => stream.id === p.cameraStreamId) ?? null : null;
        const mic = streams.find((s) => s.id !== p.screenStreamId && s.id !== p.cameraStreamId && s.getAudioTracks().length > 0) ?? null;
        return {
          ...p,
          isSelf: false,
          connection: connStates[p.id] ?? null,
          cameraStream: camera && camera.getVideoTracks().some((track) => track.readyState === 'live') ? camera : null,
          micStream: mic,
          screenStream: screen && screen.getVideoTracks().length > 0 ? screen : null,
        };
      });
  }, [presence, selfId, name, muted, micStream, screenStream, cameraStream, remoteStreams, connStates]);

  return {
    status,
    error,
    micError,
    shareError,
    selfId,
    participants,
    messages,
    muted,
    cameraOn: cameraStream !== null,
    cameraBusy,
    cameraError,
    toggleCamera,
    sharing: screenStream !== null,
    shareHasAudio: (screenStream?.getAudioTracks().length ?? 0) > 0,
    quality,
    micSettings,
    micGainSupported,
    micGateSupported,
    micMeter,
    changeMic,
    toggleMute,
    startShare,
    stopShare: stopShareInternal,
    setQuality,
    sendChat,
    playSound,
    soundToasts,
    dismissSoundToast,
    music,
  };
}
