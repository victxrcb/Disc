import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth, type Profile } from '../lib/auth';

export interface Friendship {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: 'pending' | 'accepted';
  created_at: string;
  person: Profile;
}

export interface DirectMessage {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  created_at: string;
}

export interface CallInvite {
  id: string;
  sender_id: string;
  recipient_id: string;
  room_code: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
  sender?: Profile;
}

export function useSocial() {
  const { user } = useAuth();
  const [friendships, setFriendships] = useState<Friendship[]>([]);
  const [invites, setInvites] = useState<CallInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!supabase || !user) return;
    const [{ data: links, error: linksError }, { data: callRows }] = await Promise.all([
      supabase.from('friendships').select('*').or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`).order('created_at'),
      supabase.from('call_invites').select('*').eq('recipient_id', user.id).eq('status', 'pending').order('created_at', { ascending: false }),
    ]);
    if (linksError) { setError('A área social ainda não está disponível. Aplique a migração do Supabase.'); setLoading(false); return; }
    const ids = [...new Set((links ?? []).map((row) => row.requester_id === user.id ? row.addressee_id : row.requester_id))];
    const senderIds = [...new Set((callRows ?? []).map((row) => row.sender_id as string))];
    const allIds = [...new Set([...ids, ...senderIds])];
    const { data: people } = allIds.length ? await supabase.from('profiles').select('id,username,display_name,avatar_url,theme').in('id', allIds) : { data: [] };
    const byId = new Map((people ?? []).map((person) => [person.id, person as Profile]));
    setFriendships((links ?? []).flatMap((row) => {
      const otherId = row.requester_id === user.id ? row.addressee_id : row.requester_id;
      const person = byId.get(otherId);
      return person ? [{ ...row, person } as Friendship] : [];
    }));
    setInvites((callRows ?? []).map((row) => ({ ...row, sender: byId.get(row.sender_id) } as CallInvite)));
    setError(''); setLoading(false);
  }, [user]);

  useEffect(() => {
    void refresh();
    if (!supabase || !user) return;
    const client = supabase;
    const channel = client.channel(`social:${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_invites' }, () => void refresh())
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [user, refresh]);

  const friends = useMemo(() => friendships.filter((item) => item.status === 'accepted'), [friendships]);
  const incoming = useMemo(() => friendships.filter((item) => item.status === 'pending' && item.addressee_id === user?.id), [friendships, user]);
  const outgoing = useMemo(() => friendships.filter((item) => item.status === 'pending' && item.requester_id === user?.id), [friendships, user]);

  const addFriend = async (username: string): Promise<string | null> => {
    if (!supabase || !user) return 'Sessão indisponível.';
    const clean = username.trim().toLowerCase().replace(/^@/, '');
    const { data: person } = await supabase.from('profiles').select('id').eq('username', clean).maybeSingle();
    if (!person) return 'Nenhum usuário encontrado com esse nome.';
    if (person.id === user.id) return 'Você já é seu próprio melhor amigo.';
    const { error: insertError } = await supabase.from('friendships').insert({ requester_id: user.id, addressee_id: person.id });
    if (insertError) return insertError.code === '23505' ? 'Esse pedido de amizade já existe.' : insertError.message;
    await refresh(); return null;
  };

  const answerFriend = async (id: string, accept: boolean) => {
    if (!supabase) return;
    if (accept) await supabase.from('friendships').update({ status: 'accepted' }).eq('id', id);
    else await supabase.from('friendships').delete().eq('id', id);
    await refresh();
  };

  const removeFriend = async (id: string) => { await supabase?.from('friendships').delete().eq('id', id); await refresh(); };
  const inviteToCall = async (friendId: string, roomCode: string) => {
    if (!supabase || !user) return;
    await supabase.from('call_invites').insert({ sender_id: user.id, recipient_id: friendId, room_code: roomCode });
  };
  const answerCall = async (invite: CallInvite, accept: boolean) => {
    await supabase?.from('call_invites').update({ status: accept ? 'accepted' : 'declined' }).eq('id', invite.id);
    await refresh();
  };

  return { friends, incoming, outgoing, invites, loading, error, refresh, addFriend, answerFriend, removeFriend, inviteToCall, answerCall };
}
