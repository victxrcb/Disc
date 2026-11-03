export const ACTIVITIES = [
  { id: 'running', label: 'Corrida' },
  { id: 'gym', label: 'Academia' },
  { id: 'swimming', label: 'Natação' },
  { id: 'cycling', label: 'Pedalada' },
  { id: 'walking', label: 'Caminhada' },
  { id: 'soccer', label: 'Futebol' },
  { id: 'yoga', label: 'Yoga' },
  { id: 'martial', label: 'Luta' },
  { id: 'functional', label: 'Funcional' },
  { id: 'other', label: 'Outro' },
] as const;

export type ActivityId = (typeof ACTIVITIES)[number]['id'];
export type Badge = 'alfa' | 'beta';
export type RankPeriod = 'week' | 'month' | 'all';

export interface Workout {
  id: string;
  group_id: string;
  user_id: string;
  title: string;
  activity: ActivityId;
  duration_minutes: number;
  performed_on: string; // YYYY-MM-DD
  created_at: string;
}

export function activityLabel(id: string): string {
  return ACTIVITIES.find((item) => item.id === id)?.label ?? 'Outro';
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}min`;
}

function pad(n: number): string { return String(n).padStart(2, '0'); }

/** Data local no formato YYYY-MM-DD (toISOString usaria UTC e viraria o dia à noite). */
export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayKey(): string { return toDateKey(new Date()); }

export function yesterdayKey(): string {
  const now = new Date();
  return toDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
}

export function formatDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (key === toDateKey(today)) return 'Hoje';
  if (key === toDateKey(yesterday)) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'long' });
}

/** Primeiro dia (inclusive) do período; `null` = sem limite. Semana começa na segunda. */
export function periodStart(period: RankPeriod): string | null {
  const now = new Date();
  if (period === 'all') return null;
  if (period === 'month') return toDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
  const offset = (now.getDay() + 6) % 7;
  return toDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset));
}

export interface RankEntry {
  userId: string;
  minutes: number;
  sessions: number;
  position: number; // empates dividem a posição (1, 1, 3…), igual ao rank() do banco
}

/** Soma por membro (inclusive quem ainda não treinou) e ordena por tempo; desempate alfabético estável por id. */
export function buildRanking(workouts: Workout[], memberIds: string[], period: RankPeriod): RankEntry[] {
  const since = periodStart(period);
  const totals = new Map(memberIds.map((id) => [id, { minutes: 0, sessions: 0 }]));
  for (const workout of workouts) {
    if (since && workout.performed_on < since) continue;
    const total = totals.get(workout.user_id);
    if (!total) continue; // ex-membro
    total.minutes += workout.duration_minutes;
    total.sessions += 1;
  }
  const sorted = [...totals].map(([userId, t]) => ({ userId, ...t })).sort((a, b) => b.minutes - a.minutes || a.userId.localeCompare(b.userId));
  const ranking: RankEntry[] = [];
  sorted.forEach((entry, index) => {
    const tied = index > 0 && sorted[index - 1].minutes === entry.minutes;
    ranking.push({ ...entry, position: tied ? ranking[index - 1].position : index + 1 });
  });
  return ranking;
}

/** Selo que a posição daria (mesma regra de `profile_badges` no banco). */
export function badgeFor(entry: RankEntry, groupSize: number): Badge | null {
  if (groupSize < 2 || entry.minutes <= 0) return null;
  return entry.position === 1 ? 'alfa' : entry.position === 2 ? 'beta' : null;
}
