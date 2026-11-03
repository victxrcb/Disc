import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Avatar } from '../components/Avatar';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { GroupChat } from '../components/GroupChat';
import { Icon } from '../components/Icon';
import { RankBadge } from '../components/RankBadge';
import { DateField, DurationField, Select } from '../components/WorkoutFields';
import { useAuth, type Profile } from '../lib/auth';
import { useGroupWorkouts, useWorkoutGroups, type WorkoutGroup } from '../hooks/useWorkoutGroups';
import {
  ACTIVITIES, activityLabel, badgeFor, buildRanking, formatDay, formatDuration, periodStart, todayKey, yesterdayKey,
  type ActivityId, type RankPeriod,
} from '../lib/workouts';

type View = 'log' | 'ranking' | 'chat' | 'members';
const VIEWS: { id: View; label: string }[] = [
  { id: 'log', label: 'Treinos' },
  { id: 'ranking', label: 'Ranking' },
  { id: 'chat', label: 'Chat' },
  { id: 'members', label: 'Membros' },
];
const PERIODS: { id: RankPeriod; label: string }[] = [
  { id: 'week', label: 'Semana' },
  { id: 'month', label: 'Mês' },
  { id: 'all', label: 'Total' },
];

interface Props { friends: Profile[]; }

export function Workouts({ friends }: Props) {
  const data = useWorkoutGroups();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const selected = data.groups.find((group) => group.id === selectedId) ?? null;

  // Se o grupo aberto some (saída, exclusão), volta para a lista.
  useEffect(() => { if (selectedId && !data.loading && !selected) setSelectedId(null); }, [selectedId, selected, data.loading]);

  const showPane = creating || selected;
  return <div className={`messages-page workouts-page${showPane ? ' has-chat' : ''}`}>
    <aside className="conv-list">
      <header><h1>Treinos</h1><p>Grupos para registrar e competir com a galera.</p></header>
      <div className="workouts-new"><button className="btn btn--small btn--primary" onClick={() => { setCreating(true); setSelectedId(null); }}><Icon name="plus" size={16} />Novo grupo</button></div>
      {data.error && <p className="notice notice--error workouts-notice">{data.error}</p>}
      {!data.loading && !data.error && data.groups.length === 0 && <div className="conv-empty"><p>Crie um grupo e convide amigos para registrar os treinos juntos.</p></div>}
      <div className="conv-list__items">{data.groups.map((group) => <button key={group.id} className={`conv-item${selectedId === group.id && !creating ? ' is-active' : ''}`} onClick={() => { setSelectedId(group.id); setCreating(false); }}>
        <span className="group-icon"><Icon name="dumbbell" /></span>
        <span className="conv-item__text"><strong>{group.name}</strong><small>{group.members.length} {group.members.length === 1 ? 'membro' : 'membros'}</small></span>
      </button>)}</div>
    </aside>
    <section className="conv-pane">
      <ErrorBoundary area="os treinos" key={creating ? 'novo' : selectedId ?? 'vazio'}>
        {creating
          ? <CreateGroup friends={friends} onCancel={() => setCreating(false)} onCreate={async (name, ids) => {
            const result = await data.createGroup(name, ids);
            if (result.id) { setSelectedId(result.id); setCreating(false); }
            return result.error ?? null;
          }} />
          : selected
            ? <GroupView group={selected} friends={friends} actions={data} onBack={() => setSelectedId(null)} />
            : <div className="conv-placeholder"><span><Icon name="trophy" size={28} /></span><h2>Escolha um grupo</h2><p>Registre treinos, acompanhe o ranking e converse com o grupo.</p></div>}
      </ErrorBoundary>
    </section>
  </div>;
}

function CreateGroup({ friends, onCreate, onCancel }: { friends: Profile[]; onCreate(name: string, ids: string[]): Promise<string | null>; onCancel(): void }) {
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toggle = (id: string) => setPicked((prev) => { const next = new Set(prev); if (!next.delete(id)) next.add(id); return next; });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true); setError('');
    const failure = await onCreate(name, [...picked]);
    if (failure) { setError(failure); setBusy(false); }
  };
  return <form className="workout-panel" onSubmit={submit}>
    <header className="workout-panel__head">
      <button type="button" className="icon-btn dm__back" onClick={onCancel} aria-label="Voltar"><Icon name="close" /></button>
      <div><span className="eyebrow">Novo grupo</span><h2>Monte o time</h2></div>
    </header>
    <div className="workout-panel__body">
      <label className="field"><span className="field__label">Nome do grupo</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Ex.: Time da corrida" required autoFocus /></label>
      <div className="field"><span className="field__label">Convidar amigos {picked.size > 0 && `· ${picked.size}`}</span>
        {friends.length === 0
          ? <p className="workout-hint">Você ainda não tem amigos na lista. Dá para criar o grupo agora e adicionar gente depois.</p>
          : <div className="member-picker">{friends.map((friend) => <label key={friend.id} className={`member-pick${picked.has(friend.id) ? ' is-picked' : ''}`}>
            <input type="checkbox" checked={picked.has(friend.id)} onChange={() => toggle(friend.id)} />
            <Avatar profile={friend} size="sm" /><span><strong>{friend.display_name}</strong><small>@{friend.username}</small></span>
            <i aria-hidden="true">{picked.has(friend.id) && <Icon name="check" size={16} />}</i>
          </label>)}</div>}
      </div>
      {error && <p className="notice notice--error" role="alert">{error}</p>}
      <div className="workout-actions"><button className="btn btn--primary" disabled={busy || !name.trim()}>{busy ? 'Criando…' : 'Criar grupo'}</button><button type="button" className="btn" onClick={onCancel}>Cancelar</button></div>
    </div>
  </form>;
}

type GroupActions = ReturnType<typeof useWorkoutGroups>;

function GroupView({ group, friends, actions, onBack }: { group: WorkoutGroup; friends: Profile[]; actions: GroupActions; onBack(): void }) {
  const [view, setView] = useState<View>('log');
  useEffect(() => { setView('log'); }, [group.id]);
  return <div className="workout-panel">
    <header className="workout-panel__head">
      <button type="button" className="icon-btn dm__back" onClick={onBack} aria-label="Voltar para os grupos"><Icon name="close" /></button>
      <div><span className="eyebrow">{group.members.length} {group.members.length === 1 ? 'membro' : 'membros'}</span><h2>{group.name}</h2></div>
      <div className="member-stack" aria-hidden="true">{group.members.slice(0, 4).map((member) => <Avatar key={member.id} profile={member} size="sm" />)}</div>
    </header>
    <nav className="workout-tabs" role="tablist">{VIEWS.map((item) => <button key={item.id} role="tab" aria-selected={view === item.id} className={view === item.id ? 'is-active' : ''} onClick={() => setView(item.id)}>{item.label}</button>)}</nav>
    {view === 'chat'
      ? <GroupChat groupId={group.id} groupName={group.name} members={group.members} />
      : view === 'members'
        ? <MembersView group={group} friends={friends} actions={actions} />
        : <WorkoutData group={group} view={view} />}
  </div>;
}

function WorkoutData({ group, view }: { group: WorkoutGroup; view: 'log' | 'ranking' }) {
  const { user } = useAuth();
  const { workouts, loading, addWorkout, deleteWorkout } = useGroupWorkouts(group.id);
  const people = useMemo(() => new Map(group.members.map((member) => [member.id, member])), [group.members]);
  return view === 'log'
    ? <LogView workouts={workouts} loading={loading} people={people} userId={user?.id} onAdd={addWorkout} onDelete={deleteWorkout} />
    : <RankingView group={group} workouts={workouts} loading={loading} userId={user?.id} />;
}

function LogView({ workouts, loading, people, userId, onAdd, onDelete }: {
  workouts: ReturnType<typeof useGroupWorkouts>['workouts']; loading: boolean; people: ReadonlyMap<string, Profile>; userId?: string;
  onAdd: ReturnType<typeof useGroupWorkouts>['addWorkout']; onDelete(id: string): Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [activity, setActivity] = useState<ActivityId>('running');
  const [total, setTotal] = useState(30);
  const [date, setDate] = useState(todayKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const valid = title.trim().length > 0 && total >= 1 && total <= 1440 && date !== '' && date <= todayKey();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true); setError('');
    const failure = await onAdd({ title, activity, duration_minutes: total, performed_on: date });
    setBusy(false);
    if (failure) { setError(failure); return; }
    setTitle('');
  };

  const weekStart = periodStart('week')!;
  const myWeek = workouts.filter((item) => item.user_id === userId && item.performed_on >= weekStart).reduce((sum, item) => sum + item.duration_minutes, 0);
  const days = useMemo(() => {
    const map = new Map<string, typeof workouts>();
    for (const item of workouts) map.set(item.performed_on, [...(map.get(item.performed_on) ?? []), item]);
    return [...map].sort(([a], [b]) => b.localeCompare(a));
  }, [workouts]);

  return <div className="workout-panel__body">
    <form className="workout-form" onSubmit={submit}>
      <div className="workout-form__top"><strong>Registrar treino</strong><span>{myWeek > 0 ? `Você treinou ${formatDuration(myWeek)} esta semana` : 'Nada registrado por você esta semana'}</span></div>
      <div className="workout-form__grid">
        <label className="field workout-form__title"><span className="field__label">Nome do registro</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder="Ex.: Treino de peito" required /></label>
        <div className="field"><span className="field__label">Exercício</span><Select<ActivityId> label="Exercício" value={activity} options={ACTIVITIES} onChange={setActivity} /></div>
        <div className="field"><span className="field__label">Data</span><DateField value={date} max={todayKey()} today={todayKey()} yesterday={yesterdayKey()} onChange={setDate} /></div>
        <div className="field workout-form__duration"><span className="field__label">Duração</span><DurationField minutes={total} onChange={setTotal} /></div>
      </div>
      {error && <p className="notice notice--error" role="alert">{error}</p>}
      <div className="workout-actions"><button className="btn btn--primary" disabled={!valid || busy}><Icon name="plus" size={16} />{busy ? 'Salvando…' : 'Registrar'}</button>{total > 0 && <span className="workout-hint">{formatDuration(total)}</span>}</div>
    </form>
    {!loading && workouts.length === 0 && <div className="empty-state"><Icon name="dumbbell" size={28} /><h3>Nenhum treino ainda</h3><p>Registre o primeiro e abra a disputa.</p></div>}
    {days.map(([day, items]) => <section key={day} className="workout-day">
      <h3>{formatDay(day)}<span>{formatDuration(items.reduce((sum, item) => sum + item.duration_minutes, 0))}</span></h3>
      {items.map((item) => {
        const person = people.get(item.user_id);
        return <article key={item.id} className="workout-item">
          {person ? <Avatar profile={person} size="sm" /> : <span className="avatar avatar--sm avatar--fallback">?</span>}
          <div><strong>{item.title}</strong><span>{item.user_id === userId ? 'Você' : person?.display_name ?? 'Ex-membro'} · {activityLabel(item.activity)}</span></div>
          <b className="workout-item__time">{formatDuration(item.duration_minutes)}</b>
          {item.user_id === userId && <button className="icon-btn" onClick={() => void onDelete(item.id)} title="Excluir registro" aria-label={`Excluir ${item.title}`}><Icon name="trash" size={16} /></button>}
        </article>;
      })}
    </section>)}
  </div>;
}

function RankingView({ group, workouts, loading, userId }: { group: WorkoutGroup; workouts: ReturnType<typeof useGroupWorkouts>['workouts']; loading: boolean; userId?: string }) {
  const [period, setPeriod] = useState<RankPeriod>('all');
  const people = useMemo(() => new Map(group.members.map((member) => [member.id, member])), [group.members]);
  const ranking = useMemo(() => buildRanking(workouts, group.members.map((member) => member.id), period), [workouts, group.members, period]);
  // O selo vale pelo ranking total, qualquer que seja o filtro exibido.
  const overall = useMemo(() => buildRanking(workouts, group.members.map((member) => member.id), 'all'), [workouts, group.members]);
  const badgeOf = (id: string) => { const entry = overall.find((item) => item.userId === id); return entry ? badgeFor(entry, group.members.length) : null; };
  const top = Math.max(...ranking.map((entry) => entry.minutes), 1);
  return <div className="workout-panel__body">
    <div className="ranking-head">
      <div><strong>Ranking por horas de treino</strong><span>Quem acumula mais tempo lidera o grupo.</span></div>
      <div className="segmented" role="group" aria-label="Período">{PERIODS.map((item) => <button key={item.id} className={period === item.id ? 'is-active' : ''} aria-pressed={period === item.id} onClick={() => setPeriod(item.id)}>{item.label}</button>)}</div>
    </div>
    {group.members.length < 2 && !loading && <p className="notice notice--warn">Os selos só valem em grupos com 2 ou mais pessoas. Convide amigos pela aba Membros.</p>}
    <ol className="ranking">{ranking.map((entry) => {
      const person = people.get(entry.userId);
      if (!person) return null;
      const badge = badgeOf(entry.userId);
      return <li key={entry.userId} className={`ranking__row${entry.userId === userId ? ' is-self' : ''}${entry.position <= 3 && entry.minutes > 0 ? ` is-podium-${entry.position}` : ''}`}>
        <span className="ranking__pos">{entry.position}</span>
        <Avatar profile={person} />
        <div className="ranking__who"><strong>{person.display_name}{entry.userId === userId && ' (você)'}</strong><span>{entry.sessions} {entry.sessions === 1 ? 'treino' : 'treinos'}</span>
          <div className="ranking__bar" aria-hidden="true"><i style={{ width: `${(entry.minutes / top) * 100}%` }} /></div></div>
        <RankBadge badge={badge} />
        <b className="ranking__time">{formatDuration(entry.minutes)}</b>
      </li>;
    })}</ol>
    <p className="workout-hint ranking__legend"><RankBadge badge="alfa" size="sm" /> 1º lugar no total · <RankBadge badge="beta" size="sm" /> 2º lugar no total. Os selos aparecem no seu perfil.</p>
  </div>;
}

function MembersView({ group, friends, actions }: { group: WorkoutGroup; friends: Profile[]; actions: GroupActions }) {
  const { user } = useAuth();
  const isOwner = group.owner_id === user?.id;
  const memberIds = new Set(group.members.map((member) => member.id));
  const candidates = friends.filter((friend) => !memberIds.has(friend.id));
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const toggle = (id: string) => setPicked((prev) => { const next = new Set(prev); if (!next.delete(id)) next.add(id); return next; });
  const add = async () => {
    setError('');
    const failure = await actions.addMembers(group.id, [...picked]);
    if (failure) setError(failure); else setPicked(new Set());
  };
  return <div className="workout-panel__body">
    <section className="friend-list workout-members"><h2>Membros — {group.members.length}</h2>
      {group.members.map((member) => <article key={member.id}>
        <Avatar profile={member} />
        <div><strong>{member.display_name}{member.id === user?.id && ' (você)'}</strong><span>@{member.username}{member.id === group.owner_id && ' · dono do grupo'}</span></div>
        {isOwner && member.id !== user?.id && <button className="icon-btn" title="Remover do grupo" aria-label={`Remover ${member.display_name}`} onClick={() => void actions.removeMember(group.id, member.id)}><Icon name="close" /></button>}
      </article>)}
    </section>
    {isOwner && <section className="workout-add">
      <h3>Adicionar amigos</h3>
      {candidates.length === 0
        ? <p className="workout-hint">Todos os seus amigos já estão no grupo.</p>
        : <><div className="member-picker">{candidates.map((friend) => <label key={friend.id} className={`member-pick${picked.has(friend.id) ? ' is-picked' : ''}`}>
          <input type="checkbox" checked={picked.has(friend.id)} onChange={() => toggle(friend.id)} />
          <Avatar profile={friend} size="sm" /><span><strong>{friend.display_name}</strong><small>@{friend.username}</small></span>
          <i aria-hidden="true">{picked.has(friend.id) && <Icon name="check" size={16} />}</i>
        </label>)}</div>
        <div className="workout-actions"><button className="btn btn--primary btn--small" disabled={picked.size === 0} onClick={() => void add()}>Adicionar{picked.size > 0 && ` (${picked.size})`}</button></div></>}
      {error && <p className="notice notice--error" role="alert">{error}</p>}
    </section>}
    <section className="profile-session">
      {isOwner
        ? <><div><strong>Excluir grupo</strong><span>Apaga o grupo, os treinos e o chat para todos. Não dá para desfazer.</span></div>
          {confirm
            ? <div className="workout-actions"><button className="btn btn--danger" onClick={() => void actions.deleteGroup(group.id)}>Confirmar exclusão</button><button className="btn" onClick={() => setConfirm(false)}>Cancelar</button></div>
            : <button className="btn btn--danger" onClick={() => setConfirm(true)}>Excluir grupo</button>}</>
        : <><div><strong>Sair do grupo</strong><span>Seus registros ficam guardados, mas deixam de contar no ranking.</span></div>
          <button className="btn btn--danger" onClick={() => user && void actions.removeMember(group.id, user.id)}>Sair do grupo</button></>}
    </section>
  </div>;
}
