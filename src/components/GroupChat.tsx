import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Profile } from '../lib/auth';
import { useAuth } from '../lib/auth';
import { useGroupMessages } from '../hooks/useWorkoutGroups';
import { Avatar } from './Avatar';
import { Icon } from './Icon';

function sameDay(a: Date, b: Date): boolean { return a.toDateString() === b.toDateString(); }

function dayLabel(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, today)) return 'Hoje';
  if (sameDay(date, yesterday)) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
}

/** Chat do grupo; reaproveita o visual das mensagens diretas. */
export function GroupChat({ groupId, groupName, members }: { groupId: string; groupName: string; members: Profile[] }) {
  const { user } = useAuth();
  const userId = user?.id;
  const { messages, loading, error, send } = useGroupMessages(groupId);
  const [text, setText] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const byId = new Map(members.map((member) => [member.id, member]));

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = text;
    if (!body.trim()) return;
    setText('');
    if (!(await send(body))) setText(body);
  };

  return <section className="dm dm--group">
    <div className="dm__messages">
      {!loading && messages.length === 0 && <div className="dm__empty"><span className="dm__empty-icon"><Icon name="chat" size={28} /></span><h3>Chat de {groupName}</h3><p>Combine treinos e comemore as metas com o grupo.</p></div>}
      {messages.map((msg, index) => {
        const date = new Date(msg.created_at);
        const previous = messages[index - 1];
        const showDay = !previous || !sameDay(new Date(previous.created_at), date);
        const self = msg.sender_id === userId;
        const sender = byId.get(msg.sender_id);
        const showSender = !self && (showDay || previous?.sender_id !== msg.sender_id);
        return <div key={msg.id} className="dm__item">
          {showDay && <div className="dm__day"><span>{dayLabel(date)}</span></div>}
          {showSender && <div className="group-msg-author">{sender ? <Avatar profile={sender} size="sm" /> : null}<span>{sender?.display_name ?? 'Ex-membro'}</span></div>}
          <div className={`dm-message${self ? ' dm-message--self' : ''}`}><p>{msg.body}</p><time>{date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time></div>
        </div>;
      })}
      <div ref={bottom} />
    </div>
    {error && <p className="notice notice--error dm__error" role="alert">{error}</p>}
    <form className="dm__composer" onSubmit={submit}><input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Mensagem para ${groupName}`} maxLength={2000} aria-label={`Mensagem para ${groupName}`} /><button className="icon-btn" disabled={!text.trim()} aria-label="Enviar"><Icon name="send" /></button></form>
  </section>;
}
