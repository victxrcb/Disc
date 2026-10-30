import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import type { DirectMessage } from './useSocial';

type SeenMap = Record<string, string>;

function seenKey(userId: string): string {
  return `discord2:dm-seen:${userId}`;
}

function loadSeen(userId: string | undefined): SeenMap {
  if (!userId) return {};
  try {
    return JSON.parse(localStorage.getItem(seenKey(userId)) ?? '{}') as SeenMap;
  } catch {
    return {};
  }
}

/** Última mensagem de cada conversa e o que ainda não foi lido (marcado neste dispositivo). */
export function useConversations() {
  const { user } = useAuth();
  const userId = user?.id;
  const [lastByFriend, setLastByFriend] = useState<ReadonlyMap<string, DirectMessage>>(new Map());
  const [seen, setSeen] = useState<SeenMap>(() => loadSeen(userId));

  useEffect(() => { setSeen(loadSeen(userId)); }, [userId]);

  useEffect(() => {
    if (!supabase || !userId) return;
    const client = supabase;
    let active = true;
    setLastByFriend(new Map());
    const remember = (list: DirectMessage[]) => setLastByFriend((prev) => {
      const next = new Map(prev);
      for (const msg of list) {
        const friendId = msg.sender_id === userId ? msg.recipient_id : msg.sender_id;
        const current = next.get(friendId);
        if (!current || Date.parse(current.created_at) < Date.parse(msg.created_at)) next.set(friendId, msg);
      }
      return next;
    });
    void client.from('direct_messages').select('*')
      .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
      .order('created_at', { ascending: false }).limit(500)
      .then(({ data }) => { if (active) remember((data ?? []) as DirectMessage[]); });
    const channel = client.channel(`inbox:${userId}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, (event) => {
        const msg = event.new as DirectMessage;
        if (msg.sender_id === userId || msg.recipient_id === userId) remember([msg]);
      })
      .subscribe();
    return () => { active = false; void client.removeChannel(channel); };
  }, [userId]);

  const markSeen = useCallback((friendId: string) => {
    if (!userId) return;
    setSeen((prev) => {
      const next = { ...prev, [friendId]: new Date().toISOString() };
      try { localStorage.setItem(seenKey(userId), JSON.stringify(next)); } catch { /* segue só na memória */ }
      return next;
    });
  }, [userId]);

  const isUnread = useCallback((friendId: string) => {
    const last = lastByFriend.get(friendId);
    if (!last || last.sender_id !== friendId) return false;
    const seenAt = seen[friendId];
    return !seenAt || Date.parse(seenAt) < Date.parse(last.created_at);
  }, [lastByFriend, seen]);

  const unreadCount = useMemo(() => [...lastByFriend.keys()].filter(isUnread).length, [lastByFriend, isUnread]);

  return { lastByFriend, isUnread, markSeen, unreadCount };
}
