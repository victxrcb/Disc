import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import {
  expectedPosition,
  fetchYouTubeTitle,
  MAX_QUEUE,
  parseYouTubeId,
  thumbnailUrl,
  type MusicState,
  type MusicSync,
} from '../lib/music';
import { loadString, saveString } from '../lib/storage';
import { createPlayer, YT_STATE, youTubeErrorMessage, type YTPlayer } from '../lib/youtube';
import { Icon } from './Icon';
import { VolumeControl } from './VolumeControl';

const VOLUME_KEY = 'disc:music:volume';
/** Diferença (s) entre o player e a posição da sala a partir da qual corrigimos. */
const DRIFT_TOLERANCE = 1.5;
const SYNC_INTERVAL_MS = 1000;
/** Se deveria estar tocando e não começou nesse tempo, o navegador bloqueou o autoplay. */
const AUTOPLAY_GRACE_MS = 3000;

function loadVolume(): number {
  const v = Number(loadString(VOLUME_KEY) || '0.6');
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.6;
}

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const total = Math.floor(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

interface Props {
  music: MusicSync;
}

/** Aba "Música": player do YouTube sincronizado com a sala, controles e fila. */
export function MusicPanel({ music }: Props) {
  const state = useSyncExternalStore(music.subscribe, music.getState);
  const [link, setLink] = useState('');
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [volume, setVolume] = useState(loadVolume);
  const [time, setTime] = useState({ current: 0, duration: 0 });
  const [scrub, setScrub] = useState<number | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);

  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const creating = useRef(false);
  const loadedTrack = useRef<string | null>(null);
  const shouldPlaySince = useRef<number | null>(null);
  const stateRef = useRef<MusicState>(state);
  stateRef.current = state;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  // Leva o player ao estado da sala: faixa, play/pause e posição (com tolerância).
  const syncPlayer = () => {
    const player = playerRef.current;
    if (!player) return;
    const s = stateRef.current;
    if (!s.current) {
      if (loadedTrack.current) player.stopVideo();
      loadedTrack.current = null;
      shouldPlaySince.current = null;
      setBlocked(false);
      return;
    }
    const target = expectedPosition(s);
    if (loadedTrack.current !== s.current.id) {
      loadedTrack.current = s.current.id;
      setPlayerError(null);
      const opts = { videoId: s.current.videoId, startSeconds: target };
      if (s.playing) player.loadVideoById(opts);
      else player.cueVideoById(opts);
    } else {
      const ps = player.getPlayerState();
      if (s.playing && ps !== YT_STATE.PLAYING && ps !== YT_STATE.BUFFERING && ps !== YT_STATE.ENDED) player.playVideo();
      if (!s.playing && (ps === YT_STATE.PLAYING || ps === YT_STATE.BUFFERING)) player.pauseVideo();
      // Durante carregamento/buffer o currentTime ainda não vale: só corrige tocando ou pausado.
      if (ps === YT_STATE.PLAYING || ps === YT_STATE.PAUSED) {
        const duration = player.getDuration();
        const drift = Math.abs(player.getCurrentTime() - target);
        if (drift > DRIFT_TOLERANCE && (!duration || target < duration - 1)) player.seekTo(target, true);
      }
    }
    if (s.playing) shouldPlaySince.current ??= Date.now();
    else shouldPlaySince.current = null;
  };
  const syncRef = useRef(syncPlayer);
  syncRef.current = syncPlayer;

  // Cria o player na primeira música; ele continua montado (inclusive com a aba oculta).
  useEffect(() => {
    if (!state.current || playerRef.current || creating.current || !hostRef.current) return;
    creating.current = true;
    const el = document.createElement('div');
    hostRef.current.appendChild(el);
    createPlayer(el, {
      onStateChange: (e) => {
        const cur = stateRef.current.current;
        if (e.data === YT_STATE.PLAYING) {
          setBlocked(false);
          const title = e.target.getVideoData().title;
          if (cur && title) music.setTitle(cur.id, title);
        }
        if (e.data === YT_STATE.ENDED && cur && loadedTrack.current === cur.id) music.ended(cur.id);
      },
      onError: (e) => {
        const cur = stateRef.current.current;
        setPlayerError(youTubeErrorMessage(e.data));
        if (cur) window.setTimeout(() => music.ended(cur.id), 1500);
      },
    })
      .then((player) => {
        playerRef.current = player;
        player.setVolume(Math.round(volumeRef.current * 100));
        syncRef.current();
      })
      .catch((err: Error) => {
        creating.current = false;
        setPlayerError(err.message);
      });
  }, [state.current, music]);

  useEffect(() => {
    syncRef.current();
  }, [state]);

  // Correção periódica de deriva + relógio da barra de progresso + detecção de autoplay bloqueado.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (!player || !stateRef.current.current) return;
      syncRef.current();
      setTime({ current: player.getCurrentTime(), duration: player.getDuration() });
      const since = shouldPlaySince.current;
      const ps = player.getPlayerState();
      setBlocked(
        since !== null &&
          Date.now() - since > AUTOPLAY_GRACE_MS &&
          ps !== YT_STATE.PLAYING &&
          ps !== YT_STATE.BUFFERING,
      );
    }, SYNC_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(
    () => () => {
      playerRef.current?.destroy();
      playerRef.current = null;
    },
    [],
  );

  const changeVolume = (v: number) => {
    setVolume(v);
    saveString(VOLUME_KEY, String(v));
    playerRef.current?.setVolume(Math.round(v * 100));
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const videoId = parseYouTubeId(link);
    if (!videoId) {
      setNotice({ kind: 'error', text: 'Link inválido. Cole um link de vídeo do YouTube.' });
      return;
    }
    setAdding(true);
    const title = (await fetchYouTubeTitle(videoId)) ?? 'Vídeo do YouTube';
    setAdding(false);
    const result = music.add(videoId, title);
    if (result === 'full') {
      setNotice({ kind: 'error', text: `A fila já tem ${MAX_QUEUE} músicas.` });
      return;
    }
    setLink('');
    setNotice({ kind: 'ok', text: result === 'playing' ? `Tocando “${title}”` : `“${title}” entrou na fila` });
  };

  const commitScrub = () => {
    if (scrub === null) return;
    music.seek(scrub);
    playerRef.current?.seekTo(scrub, true);
    setTime((t) => ({ ...t, current: scrub }));
    setScrub(null);
  };

  const cur = state.current;
  const duration = time.duration || 0;
  const shown = scrub ?? (cur ? Math.min(duration || Infinity, time.current) : 0);

  return (
    <div className="music">
      <form className="music__add" onSubmit={add}>
        <input
          type="url"
          inputMode="url"
          value={link}
          onChange={(e) => {
            setLink(e.target.value);
            setNotice(null);
          }}
          placeholder="Cole um link do YouTube"
          aria-label="Link do YouTube"
          disabled={adding}
        />
        <button type="submit" className="btn btn--primary" disabled={!link.trim() || adding}>
          <Icon name="plus" size={16} />
          {cur ? 'Fila' : 'Tocar'}
        </button>
      </form>
      {notice && (
        <p className={`music__notice music__notice--${notice.kind}`} key={notice.text}>
          {notice.text}
        </p>
      )}

      <section className={`music__now${cur ? '' : ' music__now--empty'}`} aria-label="Tocando agora">
        <div className="music__player">
          <div ref={hostRef} className="music__frame" />
          {blocked && (
            <button type="button" className="music__unblock" onClick={() => playerRef.current?.playVideo()}>
              <Icon name="play" size={20} /> Clique para ouvir
            </button>
          )}
        </div>

        {cur ? (
          <>
            <div className="music__meta">
              <span className="music__title" title={cur.title}>
                {cur.title}
              </span>
              <span className="music__by">adicionada por {cur.addedBy || 'alguém'}</span>
            </div>
            {playerError && <p className="music__notice music__notice--error">{playerError}</p>}

            <div className="music__seek">
              <span>{formatTime(shown)}</span>
              <input
                type="range"
                min={0}
                max={Math.max(1, Math.floor(duration))}
                step={1}
                value={Math.floor(shown)}
                disabled={!duration}
                onChange={(e) => setScrub(Number(e.target.value))}
                onPointerUp={commitScrub}
                onKeyUp={commitScrub}
                onBlur={commitScrub}
                aria-label="Posição da música"
                aria-valuetext={`${formatTime(shown)} de ${formatTime(duration)}`}
                style={{ ['--fill' as string]: `${duration ? (shown / duration) * 100 : 0}%` }}
              />
              <span>{formatTime(duration)}</span>
            </div>

            <div className="music__controls">
              <button
                type="button"
                className="music__btn music__btn--main"
                onClick={() => music.togglePlay()}
                aria-label={state.playing ? 'Pausar para todos' : 'Tocar para todos'}
                title={state.playing ? 'Pausar para todos' : 'Tocar para todos'}
              >
                <span className="music__btn-icon" key={state.playing ? 'pause' : 'play'}>
                  <Icon name={state.playing ? 'pause' : 'play'} />
                </span>
              </button>
              <button
                type="button"
                className="music__btn"
                onClick={() => music.next()}
                aria-label="Próxima"
                title={state.queue.length ? 'Próxima da fila' : 'Encerrar música'}
              >
                <Icon name="next" />
              </button>
              <button
                type="button"
                className="music__btn"
                onClick={() => music.stop()}
                aria-label="Parar e limpar fila"
                title="Parar e limpar a fila"
              >
                <Icon name="stop" />
              </button>
              <VolumeControl
                value={volume}
                onChange={changeVolume}
                max={1}
                label="Volume da música (só para você)"
                className="music__volume"
              />
            </div>
          </>
        ) : (
          <p className="music__empty">
            Nenhuma música tocando. Cole um link do YouTube acima e todos na chamada vão ouvir juntos.
          </p>
        )}
      </section>

      {state.queue.length > 0 && (
        <section className="music__queue" aria-label="Fila">
          <h3>
            Fila <span>{state.queue.length}</span>
          </h3>
          <ol>
            {state.queue.map((t, i) => (
              <li key={t.id} className="music__item">
                <img src={thumbnailUrl(t.videoId)} alt="" loading="lazy" />
                <span className="music__item-text">
                  <span className="music__item-title" title={t.title}>
                    {t.title}
                  </span>
                  <span className="music__by">{t.addedBy || 'alguém'}</span>
                </span>
                <span className="music__item-actions">
                  <button type="button" className="icon-btn" onClick={() => music.play(t.id)} aria-label={`Tocar agora: ${t.title}`} title="Tocar agora">
                    <Icon name="play" size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => music.move(t.id, -1)}
                    disabled={i === 0}
                    aria-label="Subir na fila"
                    title="Subir"
                  >
                    <Icon name="up" size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => music.move(t.id, 1)}
                    disabled={i === state.queue.length - 1}
                    aria-label="Descer na fila"
                    title="Descer"
                  >
                    <Icon name="down" size={16} />
                  </button>
                  <button type="button" className="icon-btn" onClick={() => music.remove(t.id)} aria-label={`Remover ${t.title}`} title="Remover">
                    <Icon name="close" size={16} />
                  </button>
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
