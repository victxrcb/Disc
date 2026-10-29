import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { compressImage, imageFromDataTransfer, ImageTooLargeError } from '../lib/chatImage';
import { Icon } from './Icon';
import { ImageLightbox } from './ImageLightbox';

export interface ChatMessage {
  id: string;
  from: string;
  name: string;
  text: string;
  /** Epoch em ms, ISO string ou Date. */
  ts: number | string | Date;
  /** data URL de imagem (já validada por quem entrega a mensagem). */
  image?: string;
}

export interface ChatPanelProps {
  messages: ChatMessage[];
  selfId: string;
  onSend(text: string, image?: string): void;
}

/** Mensagens do mesmo autor com intervalo menor que isso ficam no mesmo grupo. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;
/** Distância (px) do fim da lista em que ainda consideramos o usuário "no fim". */
const STICK_THRESHOLD_PX = 80;
const MAX_INPUT_HEIGHT_PX = 140;

const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const fullFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'medium' });

function toMs(ts: ChatMessage['ts']): number {
  const ms = ts instanceof Date ? ts.getTime() : new Date(ts).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

interface MessageGroup {
  key: string;
  from: string;
  name: string;
  isSelf: boolean;
  startMs: number;
  items: { id: string; text: string; image?: string; ms: number }[];
}

function groupMessages(messages: ChatMessage[], selfId: string): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const m of messages) {
    const ms = toMs(m.ts);
    const last = groups[groups.length - 1];
    const lastItem = last?.items[last.items.length - 1];
    if (last && lastItem && last.from === m.from && ms - lastItem.ms < GROUP_WINDOW_MS) {
      last.items.push({ id: m.id, text: m.text, image: m.image, ms });
    } else {
      groups.push({
        key: m.id,
        from: m.from,
        name: m.name,
        isSelf: m.from === selfId,
        startMs: ms,
        items: [{ id: m.id, text: m.text, image: m.image, ms }],
      });
    }
  }
  return groups;
}

// http(s)://… ou www.…
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;

const count = (s: string, ch: string) => s.split(ch).length - 1;

/** Remove pontuação final que provavelmente não faz parte da URL ("veja x.com/a)." → "x.com/a"). */
function trimUrl(url: string): string {
  while (
    /[.,;:!?'"\]}]$/.test(url) ||
    (url.endsWith(')') && count(url, '(') < count(url, ')'))
  ) {
    url = url.slice(0, -1);
  }
  return url;
}

function linkify(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    const url = trimUrl(match[0]);
    if (start > cursor) out.push(text.slice(cursor, start));
    const href = /^www\./i.test(url) ? `https://${url}` : url;
    out.push(
      <a key={start} href={href} target="_blank" rel="noopener noreferrer nofollow">
        {url}
      </a>,
    );
    cursor = start + url.length;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Cor estável por autor, derivada do id. */
function hueFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function ChatPanel({ messages, selfId, onSend }: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [showJump, setShowJump] = useState(false);
  const [attachment, setAttachment] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [viewing, setViewing] = useState<{ src: string; alt: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const prevCount = useRef(messages.length);

  const groups = useMemo(() => groupMessages(messages, selfId), [messages, selfId]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    stickToBottom.current = true;
    setShowJump(false);
  }, []);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
    stickToBottom.current = atBottom;
    if (atBottom) setShowJump(false);
  };

  // Auto-scroll: só desce sozinho se o usuário já estava no fim ou se a última mensagem é dele.
  useLayoutEffect(() => {
    const added = messages.length - prevCount.current;
    prevCount.current = messages.length;
    if (added <= 0) return;

    const lastIsSelf = messages[messages.length - 1]?.from === selfId;
    if (stickToBottom.current || lastIsSelf) scrollToBottom();
    else setShowJump(true);

    if (!drawerOpen) {
      const fromOthers = messages.slice(-added).filter((m) => m.from !== selfId).length;
      if (fromOthers) setUnread((n) => n + fromOthers);
    }
  }, [messages, selfId, drawerOpen, scrollToBottom]);

  // Posição inicial no fim.
  useLayoutEffect(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  useEffect(() => {
    if (!drawerOpen) return;
    setUnread(0);
    scrollToBottom();
    inputRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen, scrollToBottom]);

  const resizeInput = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // box-sizing: border-box — a altura precisa incluir a borda, senão sobra 1–2px de overflow e aparece a barra de rolagem.
    const border = el.offsetHeight - el.clientHeight;
    el.style.height = `${Math.min(el.scrollHeight + border, MAX_INPUT_HEIGHT_PX)}px`;
  };

  useLayoutEffect(resizeInput, [draft]);

  const attach = async (file: File | null | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    setAttachError(null);
    setAttaching(true);
    try {
      setAttachment(await compressImage(file));
    } catch (err) {
      setAttachError(err instanceof ImageTooLargeError ? err.message : 'Não foi possível ler essa imagem.');
    } finally {
      setAttaching(false);
      inputRef.current?.focus();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const file = imageFromDataTransfer(e.clipboardData);
    if (!file) return; // texto comum segue o fluxo normal
    e.preventDefault();
    void attach(file);
  };

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    void attach(e.target.files?.[0]);
    e.target.value = ''; // permite escolher o mesmo arquivo de novo
  };

  const handleDragOver = (e: DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    setDragging(true);
  };

  const handleDrop = (e: DragEvent) => {
    setDragging(false);
    const file = imageFromDataTransfer(e.dataTransfer);
    if (!file) return;
    e.preventDefault();
    void attach(file);
  };

  const canSend = !attaching && (draft.trim() !== '' || attachment !== null);

  const send = () => {
    const text = draft.trim();
    if (!canSend) return;
    onSend(text, attachment ?? undefined);
    setDraft('');
    setAttachment(null);
    setAttachError(null);
    stickToBottom.current = true;
    inputRef.current?.focus();
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    send();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter envia; Shift+Enter quebra linha; não envia durante composição IME.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <>
      <button
        type="button"
        className="chat-fab"
        onClick={() => setDrawerOpen(true)}
        aria-label={unread ? `Abrir chat (${unread} não lidas)` : 'Abrir chat'}
        aria-expanded={drawerOpen}
        aria-controls="chat-panel"
      >
        <Icon name="chat" />
        {unread > 0 && (
          <span className="chat-fab__badge" key={unread}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      <div
        className={`chat-backdrop${drawerOpen ? ' is-open' : ''}`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />

      <aside
        id="chat-panel"
        className={`chat-panel${drawerOpen ? ' is-open' : ''}${dragging ? ' is-dragging' : ''}`}
        aria-label="Chat da chamada"
        onDragOver={handleDragOver}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={handleDrop}
      >
        <header className="chat-panel__header">
          <h2 className="chat-panel__title">Chat</h2>
          <button
            type="button"
            className="icon-btn chat-panel__close"
            onClick={() => setDrawerOpen(false)}
            aria-label="Fechar chat"
          >
            <Icon name="close" />
          </button>
        </header>

        <div
          ref={listRef}
          className="chat-panel__list"
          onScroll={handleScroll}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
        >
          {groups.length === 0 ? (
            <p className="chat-panel__empty">Nenhuma mensagem ainda. Diga oi 👋</p>
          ) : (
            groups.map((g) => (
              <section
                key={g.key}
                className={`chat-group${g.isSelf ? ' chat-group--self' : ''}`}
                style={{ '--author-hue': hueFor(g.from) } as CSSProperties}
              >
                {!g.isSelf && (
                  <div className="chat-group__avatar" aria-hidden="true">
                    {initials(g.name)}
                  </div>
                )}
                <div className="chat-group__body">
                  <div className="chat-group__meta">
                    <span className="chat-group__name">{g.isSelf ? 'Você' : g.name}</span>
                    <time dateTime={new Date(g.startMs).toISOString()} title={fullFormatter.format(g.startMs)}>
                      {timeFormatter.format(g.startMs)}
                    </time>
                  </div>
                  {g.items.map((item) => {
                    const alt = `Imagem enviada por ${g.isSelf ? 'você' : g.name}`;
                    return (
                      <div
                        key={item.id}
                        className={`chat-bubble${item.image ? ' chat-bubble--image' : ''}`}
                        title={timeFormatter.format(item.ms)}
                      >
                        {item.image && (
                          <button
                            type="button"
                            className="chat-image"
                            onClick={() => setViewing({ src: item.image!, alt })}
                            aria-label={`${alt}. Abrir`}
                          >
                            <img
                              src={item.image}
                              alt={alt}
                              // A altura só é conhecida depois do carregamento; mantém a lista no fim.
                              onLoad={() => {
                                if (stickToBottom.current) scrollToBottom();
                              }}
                            />
                          </button>
                        )}
                        {item.text && <p className="chat-bubble__text">{linkify(item.text)}</p>}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>

        {showJump && (
          <button type="button" className="chat-panel__jump" onClick={() => scrollToBottom('smooth')}>
            Novas mensagens ↓
          </button>
        )}

        {(attachment || attaching || attachError) && (
          <div className="chat-attach" aria-live="polite">
            {attaching && <span className="chat-attach__status">Preparando imagem…</span>}
            {attachError && <span className="chat-attach__error">{attachError}</span>}
            {attachment && (
              <div className="chat-attach__preview">
                <img src={attachment} alt="Imagem anexada" />
                <button
                  type="button"
                  className="chat-attach__remove"
                  onClick={() => setAttachment(null)}
                  aria-label="Remover imagem"
                  title="Remover imagem"
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
            )}
          </div>
        )}

        <form className="chat-panel__composer" onSubmit={handleSubmit}>
          <button
            type="button"
            className="icon-btn chat-panel__attach"
            onClick={() => fileRef.current?.click()}
            disabled={attaching}
            aria-label="Anexar imagem"
            title="Anexar imagem (ou cole com Ctrl+V)"
          >
            <Icon name="image" />
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleFile} />
          <textarea
            ref={inputRef}
            className="chat-panel__input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={attachment ? 'Adicione uma legenda…' : 'Escreva uma mensagem…'}
            rows={1}
            aria-label="Mensagem"
            enterKeyHint="send"
          />
          <button type="submit" className="btn btn--primary chat-panel__send" disabled={!canSend} aria-label="Enviar">
            <Icon name="send" />
          </button>
        </form>
        {dragging && (
          <div className="chat-drop" aria-hidden="true">
            <Icon name="image" size={28} />
            Solte a imagem para anexar
          </div>
        )}
      </aside>

      {viewing && <ImageLightbox src={viewing.src} alt={viewing.alt} onClose={() => setViewing(null)} />}
    </>
  );
}

export default ChatPanel;
