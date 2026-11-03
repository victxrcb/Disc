import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth, type Profile } from '../lib/auth';
import type { Workout, ActivityId, Badge } from '../lib/workouts';

export interface WorkoutGroup {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  members: Profile[];
}

export interface GroupMessage {
  id: string;
  group_id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

const PROFILE_COLUMNS = 'id,username,display_name,avatar_url,banner_url,theme';
const UNAVAILABLE = 'Os treinos ainda não estão disponíveis. Aplique a migração do Supabase.';

export function useWorkoutGroups() {
  const { user } = useAuth();
  const userId = user?.id;
  const [groups, setGroups] = useState<WorkoutGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!supabase || !userId) return;
    const { data: groupRows, error: groupError } = await supabase.from('workout_groups').select('*').order('created_at', { ascending: false });
    if (groupError) { setError(UNAVAILABLE); setLoading(false); return; }
    const ids = (groupRows ?? []).map((group) => group.id as string);
    const { data: memberRows } = ids.length ? await supabase.from('workout_group_members').select('group_id,user_id').in('group_id', ids) : { data: [] };
    const personIds = [...new Set((memberRows ?? []).map((row) => row.user_id as string))];
    const { data: people } = personIds.length ? await supabase.from('profiles').select(PROFILE_COLUMNS).in('id', personIds) : { data: [] };
    const byId = new Map((people ?? []).map((person) => [person.id as string, person as Profile]));
    setGroups((groupRows ?? []).map((group) => ({
      ...group,
      members: (memberRows ?? []).filter((row) => row.group_id === group.id).flatMap((row) => { const person = byId.get(row.user_id as string); return person ? [person] : []; }),
    } as WorkoutGroup)));
    setError(''); setLoading(false);
  }, [userId]);

  useEffect(() => {
    void refresh();
    if (!supabase || !userId) return;
    const client = supabase;
    const channel = client.channel(`workout-groups:${userId}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workout_groups' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workout_group_members' }, () => void refresh())
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [userId, refresh]);

  /** Cria o grupo com você como dono e já adiciona os amigos escolhidos. Retorna o id ou uma mensagem de erro. */
  const createGroup = async (name: string, friendIds: string[]): Promise<{ id?: string; error?: string }> => {
    if (!supabase || !userId) return { error: 'Sessão indisponível.' };
    const id = crypto.randomUUID(); // o id nasce aqui: o retorno do insert exigiria já ser membro para ler
    const { error: groupError } = await supabase.from('workout_groups').insert({ id, name: name.trim(), owner_id: userId });
    if (groupError) return { error: groupError.message };
    const { error: memberError } = await supabase.from('workout_group_members').insert([userId, ...friendIds].map((member) => ({ group_id: id, user_id: member })));
    if (memberError) { await supabase.from('workout_groups').delete().eq('id', id); return { error: memberError.message }; }
    await refresh();
    return { id };
  };

  const addMembers = async (groupId: string, ids: string[]): Promise<string | null> => {
    if (!supabase || ids.length === 0) return null;
    const { error: insertError } = await supabase.from('workout_group_members').insert(ids.map((id) => ({ group_id: groupId, user_id: id })));
    await refresh();
    return insertError?.message ?? null;
  };

  const removeMember = async (groupId: string, memberId: string) => {
    await supabase?.from('workout_group_members').delete().eq('group_id', groupId).eq('user_id', memberId);
    await refresh();
  };

  const renameGroup = async (groupId: string, name: string) => {
    await supabase?.from('workout_groups').update({ name: name.trim() }).eq('id', groupId);
    await refresh();
  };

  const deleteGroup = async (groupId: string) => {
    await supabase?.from('workout_groups').delete().eq('id', groupId);
    await refresh();
  };

  return { groups, loading, error, createGroup, addMembers, removeMember, renameGroup, deleteGroup };
}

export function useGroupWorkouts(groupId: string) {
  const { user } = useAuth();
  const userId = user?.id;
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase || !userId) return;
    const client = supabase;
    let active = true;
    setWorkouts([]); setLoading(true);
    void client.from('workouts').select('*').eq('group_id', groupId).order('performed_on', { ascending: false }).order('created_at', { ascending: false }).limit(2000)
      .then(({ data }) => { if (!active) return; setWorkouts((data ?? []) as Workout[]); setLoading(false); });
    const channel = client.channel(`workouts:${groupId}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'workouts', filter: `group_id=eq.${groupId}` }, (event) => {
        const row = event.new as Workout;
        setWorkouts((list) => list.some((item) => item.id === row.id) ? list : [row, ...list]);
      })
      // DELETE não aceita filtro por grupo; remover por id é inofensivo para ids de outros grupos.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'workouts' }, (event) => {
        const id = (event.old as { id?: string }).id;
        if (id) setWorkouts((list) => list.filter((item) => item.id !== id));
      })
      .subscribe();
    return () => { active = false; void client.removeChannel(channel); };
  }, [groupId, userId]);

  const addWorkout = async (input: { title: string; activity: ActivityId; duration_minutes: number; performed_on: string }): Promise<string | null> => {
    if (!supabase || !userId) return 'Sessão indisponível.';
    const { data, error } = await supabase.from('workouts').insert({ ...input, title: input.title.trim(), group_id: groupId, user_id: userId }).select().single();
    if (error) return error.message;
    if (data) setWorkouts((list) => list.some((item) => item.id === data.id) ? list : [data as Workout, ...list]);
    return null;
  };

  const deleteWorkout = async (id: string) => {
    if (!supabase) return;
    const { error } = await supabase.from('workouts').delete().eq('id', id);
    if (!error) setWorkouts((list) => list.filter((item) => item.id !== id));
  };

  return { workouts, loading, addWorkout, deleteWorkout };
}

export function useGroupMessages(groupId: string) {
  const { user } = useAuth();
  const userId = user?.id;
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!supabase || !userId) return;
    const client = supabase;
    let active = true;
    setMessages([]); setLoading(true); setError('');
    void client.from('workout_messages').select('*').eq('group_id', groupId).order('created_at', { ascending: false }).limit(300)
      .then(({ data, error: loadError }) => {
        if (!active) return;
        if (loadError) setError('Não foi possível carregar o chat.');
        setMessages(((data ?? []) as GroupMessage[]).reverse());
        setLoading(false);
      });
    const channel = client.channel(`group-chat:${groupId}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'workout_messages', filter: `group_id=eq.${groupId}` }, (event) => {
        const msg = event.new as GroupMessage;
        setMessages((list) => list.some((item) => item.id === msg.id) ? list : [...list, msg]);
      })
      .subscribe();
    return () => { active = false; void client.removeChannel(channel); };
  }, [groupId, userId]);

  const send = async (text: string): Promise<boolean> => {
    const body = text.trim().slice(0, 2000);
    if (!body || !supabase || !userId) return false;
    setError('');
    const { data, error: sendError } = await supabase.from('workout_messages').insert({ group_id: groupId, sender_id: userId, body }).select().single();
    if (sendError) { setError('A mensagem não foi enviada. Você ainda está no grupo?'); return false; }
    if (data) setMessages((list) => list.some((item) => item.id === data.id) ? list : [...list, data as GroupMessage]);
    return true;
  };

  return { messages, loading, error, send };
}

/** Selos Alfa/Beta dos usuários informados. Falha em silêncio (sem migração, sem selos). */
export function useProfileBadges(ids: string[], refreshKey: unknown): ReadonlyMap<string, Badge> {
  const [badges, setBadges] = useState<ReadonlyMap<string, Badge>>(new Map());
  const key = [...new Set(ids)].sort().join(',');
  useEffect(() => {
    if (!supabase || !key) { setBadges(new Map()); return; }
    let active = true;
    void supabase.rpc('profile_badges', { ids: key.split(',') }).then(({ data, error }) => {
      if (!active || error) return;
      setBadges(new Map((data ?? []).map((row: { user_id: string; badge: Badge }) => [row.user_id, row.badge])));
    });
    return () => { active = false; };
  }, [key, refreshKey]);
  return badges;
}
