import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from './auth';
import { supabase } from './supabase';

const PresenceContext = createContext<ReadonlySet<string>>(new Set());

/** Mantém este usuário marcado como online e acompanha quem mais está com o app aberto. */
export function PresenceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id;
  const [online, setOnline] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (!supabase || !userId) {
      setOnline(new Set());
      return;
    }
    const client = supabase;
    const topic = 'presence:online';
    let cancelled = false;
    let channel: ReturnType<typeof client.channel> | undefined;
    void (async () => {
      // O nome do canal é fixo (todos precisam se ver); espera o canal de uma sessão anterior sair,
      // senão o Realtime devolve o canal antigo já inscrito e lança erro ao registrar eventos.
      const stale = client.getChannels().filter((item) => item.topic === `realtime:${topic}`);
      await Promise.all(stale.map((item) => client.removeChannel(item)));
      if (cancelled) return;
      try {
        // A chave da presença é o id do usuário: várias janelas abertas contam como uma pessoa só.
        const current = client.channel(topic, { config: { presence: { key: userId } } });
        channel = current;
        current
          .on('presence', { event: 'sync' }, () => setOnline(new Set(Object.keys(current.presenceState()))))
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') void current.track({ online_at: new Date().toISOString() });
          });
      } catch (error) {
        console.error('[presença] Não foi possível entrar no canal:', error);
      }
    })();
    return () => {
      cancelled = true;
      if (channel) void client.removeChannel(channel);
      setOnline(new Set());
    };
  }, [userId]);

  return <PresenceContext.Provider value={online}>{children}</PresenceContext.Provider>;
}

export function useOnlineUsers(): ReadonlySet<string> {
  return useContext(PresenceContext);
}
