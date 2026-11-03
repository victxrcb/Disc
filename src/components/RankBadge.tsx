import type { Badge } from '../lib/workouts';
import { Icon } from './Icon';

/** Selo de ranking do perfil: Alfa (1º, com coroa) e Beta (2º). */
export function RankBadge({ badge, size = 'md' }: { badge: Badge | null | undefined; size?: 'sm' | 'md' }) {
  if (!badge) return null;
  const title = badge === 'alfa' ? 'Alfa — 1º lugar no ranking de treinos' : 'Beta — 2º lugar no ranking de treinos';
  return <span className={`rank-badge rank-badge--${badge} rank-badge--${size}`} title={title}>
    {badge === 'alfa' && <Icon name="crown" size={16} />}
    {badge === 'alfa' ? 'Alfa' : 'Beta'}
  </span>;
}
