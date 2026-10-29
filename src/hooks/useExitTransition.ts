import { useEffect, useRef, useState } from 'react';

export interface TransitionItem<T> {
  item: T;
  leaving: boolean;
}

/**
 * Só visual: mantém itens removidos por `duration` ms marcados como `leaving`,
 * para o CSS animar a saída antes de o React tirar o elemento da tela.
 */
export function useExitTransition<T extends { id: string }>(items: T[], duration: number): TransitionItem<T>[] {
  const [leaving, setLeaving] = useState<Map<string, { item: T; index: number }>>(() => new Map());
  const prev = useRef(items);
  const timers = useRef(new Set<number>());

  useEffect(() => {
    const current = new Set(items.map((i) => i.id));
    const gone = prev.current
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !current.has(item.id));
    prev.current = items;
    if (gone.length === 0) return;

    setLeaving((m) => {
      const next = new Map(m);
      for (const g of gone) next.set(g.item.id, g);
      return next;
    });
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setLeaving((m) => {
        const next = new Map(m);
        for (const g of gone) next.delete(g.item.id);
        return next;
      });
    }, duration);
    timers.current.add(timer);
  }, [items, duration]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => window.clearTimeout(t));
  }, []);

  const present = new Set(items.map((i) => i.id));
  const result: TransitionItem<T>[] = items.map((item) => ({ item, leaving: false }));
  // Reinsere quem está saindo perto da posição antiga, para a grade não "pular".
  for (const { item, index } of leaving.values()) {
    if (present.has(item.id)) continue;
    result.splice(Math.min(index, result.length), 0, { item, leaving: true });
  }
  return result;
}
