import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ChatPanel } from '../components/ChatPanel';
import { Controls } from '../components/Controls';
import { Icon } from '../components/Icon';
import { MusicPanel } from '../components/MusicPanel';
import { ParticipantTile } from '../components/ParticipantTile';
import { ScreenView } from '../components/ScreenView';
import { SoundToast } from '../components/SoundToast';
import { Avatar } from '../components/Avatar';
import { useExitTransition } from '../hooks/useExitTransition';
import { MAX_PARTICIPANTS, useRoom } from '../hooks/useRoom';
import { useSocial } from '../hooks/useSocial';

/** Igual à duração da animação .tile-wrap--leaving (var(--dur)). */
const TILE_EXIT_MS = 220;

type StageFocus = { kind: 'screen' | 'participant'; id: string };

interface Props {
  code: string;
  name: string;
  avatarUrl: string | null;
  onLeave(): void;
}

function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1800);
      },
      () => {},
    );
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [copied, copy];
}

export function Room({ code, name, avatarUrl, onLeave }: Props) {
  const room = useRoom(code, name, avatarUrl);
  const social = useSocial();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invited, setInvited] = useState<string[]>([]);
  const musicPlaying = useSyncExternalStore(room.music.subscribe, () => room.music.getState().playing);
  const [chatOpen, setChatOpen] = useState(true);
  const [unread, setUnread] = useState(0);
  const [stageFocus, setStageFocus] = useState<StageFocus | null>(null);
  const [copiedLink, copyLink] = useCopy();
  const [copiedCode, copyCode] = useCopy();
  const seenMessages = useRef(0);
  const tiles = useExitTransition(room.participants, TILE_EXIT_MS);

  // Não lidas para o botão de chat da barra (desktop, com o chat fechado).
  useEffect(() => {
    const added = room.messages.length - seenMessages.current;
    seenMessages.current = room.messages.length;
    if (added > 0 && !chatOpen) {
      setUnread((n) => n + room.messages.slice(-added).filter((m) => m.from !== room.selfId).length);
    }
  }, [room.messages, chatOpen, room.selfId]);

  if (room.status === 'full' || room.status === 'error') {
    return (
      <main className="home">
        <div className="home__card">
          <div className={`status-icon${room.status === 'error' ? ' status-icon--error' : ''}`}>
            <Icon name={room.status === 'full' ? 'users' : 'alert'} size={28} />
          </div>
          <h1 className="home__title">{room.status === 'full' ? 'Sala cheia' : 'Não foi possível entrar'}</h1>
          <p className="home__lead">
            {room.status === 'full'
              ? `A chamada ${code} já tem ${MAX_PARTICIPANTS} pessoas, o máximo para conexão direta entre navegadores.`
              : (room.error ?? 'Erro desconhecido.')}
          </p>
          <button className="btn btn--primary btn--block" onClick={onLeave}>
            Voltar ao início
          </button>
        </div>
      </main>
    );
  }

  const sharers = room.participants.filter((p) => p.screenStream);
  const focusedParticipant = stageFocus?.kind === 'participant'
    ? room.participants.find((p) => p.id === stageFocus.id && p.cameraStream) ?? null
    : null;
  const focusedScreen = focusedParticipant
    ? null
    : (stageFocus?.kind === 'screen' ? sharers.find((p) => p.id === stageFocus.id) : null)
      ?? sharers.find((p) => !p.isSelf)
      ?? sharers[0]
      ?? null;
  const publicAppUrl =
    (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.replace(/\/+$/, '') ||
    'https://disc-call.vercel.app';
  const link = `${publicAppUrl}/${code}`;
  const isDesktopApp = import.meta.env.MODE === 'desktop';

  return (
    <div className="room">
      <header className="room__header">
        <div className="brand brand--small">
          <img src="/favicon.png" alt="" width={26} height={26} />
          <span>Discord 2.0</span>
        </div>
        <div className="room-invite">
          <button className="btn btn--small" onClick={() => setInviteOpen((open) => !open)}><Icon name="users" size={16} /> Convidar amigos</button>
          {inviteOpen && <div className="room-invite__menu"><strong>Convidar para a chamada</strong>{social.friends.length === 0 ? <p>Adicione amigos para convidá-los por aqui.</p> : social.friends.map((friend) => <div key={friend.id}><Avatar profile={friend.person} size="sm" /><span>{friend.person.display_name}</span><button className="btn btn--small" disabled={invited.includes(friend.person.id)} onClick={() => { void social.inviteToCall(friend.person.id, code); setInvited((list) => [...list, friend.person.id]); }}>{invited.includes(friend.person.id) ? 'Enviado' : 'Convidar'}</button></div>)}</div>}
        </div>
        <div className="room__code">
          <button className="code-chip" onClick={() => copyCode(code)} title="Copiar código">
            <span className="code-chip__value">{code}</span>
            <span className="code-chip__icon" key={copiedCode ? 'ok' : 'copy'}>
              <Icon name={copiedCode ? 'check' : 'copy'} size={16} />
            </span>
          </button>
          <button className="btn btn--small" onClick={() => copyLink(link)}>
            {copiedLink ? 'Link copiado!' : 'Copiar convite'}
          </button>
        </div>
        <div className={`room__count${room.status === 'joining' ? ' room__count--joining' : ''}`}>
          {room.status === 'joining' ? 'Entrando…' : `${room.participants.length}/${MAX_PARTICIPANTS} na chamada`}
        </div>
      </header>

      {(room.micError || room.shareError || room.cameraError || room.error) && (
        <div className="notices">
          {room.micError && <p className="notice notice--warn">{room.micError}</p>}
          {room.cameraError && <p className="notice notice--warn" role="status">{room.cameraError}</p>}
          {room.shareError && <p className="notice notice--error">{room.shareError}</p>}
          {room.error && <p className="notice notice--error">Conexão com o servidor instável: {room.error}</p>}
        </div>
      )}

      <div className="room__body">
        <main className="room__main">
          {focusedScreen || focusedParticipant ? (
            <>
              <div className="stage">
                {focusedParticipant ? (
                  <ParticipantTile participant={focusedParticipant} featured />
                ) : focusedScreen ? (
                  <ScreenView participant={focusedScreen} focused />
                ) : null}
              </div>
              <div className="strip">
                {sharers
                  .filter((p) => p.id !== focusedScreen?.id)
                  .map((p) => (
                    <ScreenView
                      key={`screen-${p.id}`}
                      participant={p}
                      focused={false}
                      onFocus={() => setStageFocus({ kind: 'screen', id: p.id })}
                    />
                  ))}
                {tiles
                  .filter(({ item: p }) => p.id !== focusedParticipant?.id)
                  .map(({ item: p, leaving }) => (
                    <div key={p.id} className={`tile-wrap${leaving ? ' tile-wrap--leaving' : ''}`} aria-hidden={leaving || undefined}>
                      <ParticipantTile
                        participant={p}
                        compact
                        onSelect={p.cameraStream ? () => setStageFocus({ kind: 'participant', id: p.id }) : undefined}
                      />
                    </div>
                  ))}
              </div>
            </>
          ) : (
            <div className="grid" data-count={room.participants.length} aria-busy={room.status === 'joining'}>
              {tiles.map(({ item: p, leaving }) => (
                <div key={p.id} className={`tile-wrap${leaving ? ' tile-wrap--leaving' : ''}`} aria-hidden={leaving || undefined}>
                  <ParticipantTile participant={p} />
                </div>
              ))}
              {room.status === 'joining' &&
                [0, 1].map((i) => (
                  <div key={`skeleton-${i}`} className="tile-wrap" aria-hidden="true">
                    <div className="tile tile--skeleton">
                      <div className="skeleton skeleton--avatar" />
                      <div className="skeleton skeleton--name" />
                    </div>
                  </div>
                ))}
              {room.participants.length === 1 && room.status === 'joined' && (
                <div className="invite-hint">
                  <p>Só você por aqui.</p>
                  <p>
                    Mande o código <strong>{code}</strong> ou o link de convite para seus amigos.
                  </p>
                </div>
              )}
            </div>
          )}
          {room.soundToasts.length > 0 && (
            <div className="sound-toasts">
              {room.soundToasts.map((t) => (
                <SoundToast
                  key={t.key}
                  sound={t}
                  fromSelf={t.from === room.selfId}
                  onDone={() => room.dismissSoundToast(t.key)}
                />
              ))}
            </div>
          )}
          {room.sharing && !room.shareHasAudio && (
            <p className="share-hint">
              {isDesktopApp ? (
                <>Sua tela está sem áudio. Pare a transmissão e ative “Compartilhar áudio do sistema” no seletor antes de escolher a janela ou tela.</>
              ) : (
                <>Sua tela está sem áudio. No Chrome/Edge, marque “Compartilhar áudio do sistema” (tela inteira) ou “Compartilhar áudio da guia” ao escolher o que compartilhar.</>
              )}
            </p>
          )}

          <Controls
            muted={room.muted}
            micAvailable={!room.micError}
            micSettings={room.micSettings}
            micGainSupported={room.micGainSupported}
            micGateSupported={room.micGateSupported}
            getMicMeter={room.micMeter}
            onMicChange={room.changeMic}
            cameraOn={room.cameraOn}
            cameraBusy={room.cameraBusy}
            cameraAvailable={room.status === 'joined'}
            onToggleCamera={() => void room.toggleCamera()}
            sharing={room.sharing}
            quality={room.quality}
            chatOpen={chatOpen}
            unread={unread}
            onToggleMute={room.toggleMute}
            onToggleShare={() => (room.sharing ? room.stopShare() : void room.startShare())}
            onQualityChange={room.setQuality}
            onToggleChat={() => {
              setChatOpen((o) => !o);
              setUnread(0);
            }}
            onPlaySound={room.playSound}
            onLeave={onLeave}
          />
        </main>

        <div className={`room__chat${chatOpen ? '' : ' room__chat--hidden'}`}>
          <ChatPanel
            messages={room.messages}
            selfId={room.selfId}
            onSend={room.sendChat}
            musicPanel={<MusicPanel music={room.music} />}
            musicPlaying={musicPlaying}
          />
        </div>
      </div>
    </div>
  );
}
