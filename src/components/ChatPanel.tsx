import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Icon } from './Icon';

export interface ChatMessage {
  id: string;
  from: string;
  name: string;
  text: string;
  /** Epoch em ms, ISO string ou Date. */
  ts: number | string | Date;
}

export interface ChatPanelProps {
  messages: ChatMessage[];
  selfId: string;
  onSend(text: string): void;
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
  items: { id: string; text: string; ms: number }[];
}

function groupMessages(messages: ChatMessage[], selfId: string): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const m of messages) {
    const ms = toMs(m.ts);
    const last = groups[groups.length - 1];
    const lastItem = last?.items[last.items.length - 1];
    if (last && lastItem && last.from === m.from && ms - lastItem.ms < GROUP_WINDOW_MS) {
      last.items.push({ id: m.id, text: m.text, ms });
    } else {
      groups.push({
        key: m.id,
        from: m.from,
        name: m.name,
        isSelf: m.from === selfId,
        startMs: ms,
        items: [{ id: m.id, text: m.text, ms }],
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

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
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
        className={`chat-panel${drawerOpen ? ' is-open' : ''}`}
        aria-label="Chat da chamada"
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
                  {g.items.map((item) => (
                    <p key={item.id} className="chat-bubble" title={timeFormatter.format(item.ms)}>
                      {linkify(item.text)}
                    </p>
                  ))}
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

        <form className="chat-panel__composer" onSubmit={handleSubmit}>
          <textarea
            ref={inputRef}
            className="chat-panel__input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escreva uma mensagem…"
            rows={1}
            aria-label="Mensagem"
            enterKeyHint="send"
          />
          <button type="submit" className="btn btn--primary chat-panel__send" disabled={!draft.trim()} aria-label="Enviar">
            <Icon name="send" />
          </button>
        </form>
      </aside>
    </>
  );
}

export default ChatPanel;
