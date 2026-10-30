import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Profile } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import type { DirectMessage } from '../hooks/useSocial';
import { Avatar } from './Avatar';
import { Icon } from './Icon';

export function DirectChat({ friend, onClose }: { friend: Profile; onClose(): void }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [text, setText] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const load = async () => {
    if (!supabase || !user) return;
    const { data } = await supabase.from('direct_messages').select('*')
      .or(`and(sender_id.eq.${user.id},recipient_id.eq.${friend.id}),and(sender_id.eq.${friend.id},recipient_id.eq.${user.id})`)
      .order('created_at').limit(300);
    setMessages((data ?? []) as DirectMessage[]);
  };
  useEffect(() => {
    void load();
    if (!supabase || !user) return;
    const client = supabase;
    const channel = client.channel(`dm:${user.id}:${friend.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, (event) => {
        const msg = event.new as DirectMessage;
        if ([msg.sender_id, msg.recipient_id].includes(user.id) && [msg.sender_id, msg.recipient_id].includes(friend.id)) setMessages((list) => list.some((m) => m.id === msg.id) ? list : [...list, msg]);
      }).subscribe();
    return () => { void client.removeChannel(channel); };
  }, [friend.id, user]);
  useEffect(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), [messages]);
  const send = async (event: FormEvent) => {
    event.preventDefault();
    const body = text.trim().slice(0, 2000);
    if (!body || !supabase || !user) return;
    setText('');
    const { data } = await supabase.from('direct_messages').insert({ sender_id: user.id, recipient_id: friend.id, body }).select().single();
    if (data) setMessages((list) => list.some((m) => m.id === data.id) ? list : [...list, data as DirectMessage]);
  };
  return <section className="dm">
    <header className="dm__head"><button className="icon-btn" onClick={onClose}><Icon name="close" /></button><Avatar profile={friend} size="sm" /><div><strong>{friend.display_name}</strong><span>@{friend.username}</span></div></header>
    <div className="dm__messages">{messages.length === 0 && <div className="empty-state"><Avatar profile={friend} size="lg" /><h3>Comece a conversa</h3><p>Esta é sua conversa com {friend.display_name}.</p></div>}{messages.map((msg) => <div key={msg.id} className={`dm-message${msg.sender_id === user?.id ? ' dm-message--self' : ''}`}><p>{msg.body}</p><time>{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>)}<div ref={bottom} /></div>
    <form className="dm__composer" onSubmit={send}><input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Mensagem para ${friend.display_name}`} maxLength={2000} /><button className="icon-btn" disabled={!text.trim()}><Icon name="send" /></button></form>
  </section>;
}
