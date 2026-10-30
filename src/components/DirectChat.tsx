import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Profile } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import type { DirectMessage } from '../hooks/useSocial';
import { Avatar, PresenceAvatar } from './Avatar';
import { Icon } from './Icon';

interface Props {
  friend: Profile;
  online?: boolean;
  onClose?(): void;
}

function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

function dayLabel(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, today)) return 'Hoje';
  if (sameDay(date, yesterday)) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
}

export function DirectChat({ friend, online = false, onClose }: Props) {
  const { user } = useAuth();
  const userId = user?.id;
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!supabase || !userId) return;
    const client = supabase;
    let active = true;
    setMessages([]); setLoading(true); setError('');
    void client.from('direct_messages').select('*')
      .or(`and(sender_id.eq.${userId},recipient_id.eq.${friend.id}),and(sender_id.eq.${friend.id},recipient_id.eq.${userId})`)
      .order('created_at').limit(300)
      .then(({ data, error: loadError }) => {
        if (!active) return;
        if (loadError) setError('Não foi possível carregar a conversa.');
        setMessages((data ?? []) as DirectMessage[]);
        setLoading(false);
      });
    // Tópico único por montagem: reaproveitar um canal já inscrito faz o Realtime lançar erro.
    const channel = client.channel(`dm:${userId}:${friend.id}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, (event) => {
        const msg = event.new as DirectMessage;
        const pair = [msg.sender_id, msg.recipient_id];
        if (pair.includes(userId) && pair.includes(friend.id)) setMessages((list) => list.some((m) => m.id === msg.id) ? list : [...list, msg]);
      })
      .subscribe();
    return () => { active = false; void client.removeChannel(channel); };
  }, [friend.id, userId]);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const body = text.trim().slice(0, 2000);
    if (!body || !supabase || !userId) return;
    setText(''); setError('');
    const { data, error: sendError } = await supabase.from('direct_messages').insert({ sender_id: userId, recipient_id: friend.id, body }).select().single();
    if (sendError) { setError('A mensagem não foi enviada. Vocês ainda são amigos?'); setText(body); return; }
    if (data) setMessages((list) => list.some((m) => m.id === data.id) ? list : [...list, data as DirectMessage]);
  };

  return <section className="dm">
    <header className="dm__head">
      {onClose && <button className="icon-btn dm__back" onClick={onClose} aria-label="Voltar para as conversas"><Icon name="close" /></button>}
      <PresenceAvatar profile={friend} size="sm" online={online} />
      <div><strong>{friend.display_name}</strong><span>{online ? 'Online agora' : `@${friend.username}`}</span></div>
    </header>
    <div className="dm__messages">
      {!loading && messages.length === 0 && <div className="dm__empty"><Avatar profile={friend} size="lg" /><h3>Comece a conversa</h3><p>Esta é sua conversa com {friend.display_name}.</p></div>}
      {messages.map((msg, index) => {
        const date = new Date(msg.created_at);
        const previous = messages[index - 1];
        const showDay = !previous || !sameDay(new Date(previous.created_at), date);
        return <div key={msg.id} className="dm__item">
          {showDay && <div className="dm__day"><span>{dayLabel(date)}</span></div>}
          <div className={`dm-message${msg.sender_id === userId ? ' dm-message--self' : ''}`}><p>{msg.body}</p><time>{date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time></div>
        </div>;
      })}
      <div ref={bottom} />
    </div>
    {error && <p className="notice notice--error dm__error" role="alert">{error}</p>}
    <form className="dm__composer" onSubmit={send}><input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Mensagem para ${friend.display_name}`} maxLength={2000} aria-label={`Mensagem para ${friend.display_name}`} /><button className="icon-btn" disabled={!text.trim()} aria-label="Enviar"><Icon name="send" /></button></form>
  </section>;
}
