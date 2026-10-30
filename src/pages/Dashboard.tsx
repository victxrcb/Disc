import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Avatar, PresenceAvatar } from '../components/Avatar';
import { DirectChat } from '../components/DirectChat';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { Icon } from '../components/Icon';
import { ProfileEditor } from '../components/ProfileEditor';
import { useAuth, type Profile } from '../lib/auth';
import { generateRoomCode, isValidRoomCode, normalizeRoomCode, CODE_LENGTH } from '../lib/roomCode';
import { useSocial } from '../hooks/useSocial';
import { useConversations } from '../hooks/useConversations';
import { useOnlineUsers } from '../lib/presence';

type Tab = 'calls' | 'messages' | 'friends' | 'profile';
interface Props { initialCode: string; onJoin(code: string): void; }

function greeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

function shortTime(iso: string): string {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function Dashboard({ initialCode, onJoin }: Props) {
  const { profile, signOut } = useAuth();
  const social = useSocial();
  const online = useOnlineUsers();
  const inbox = useConversations();
  const [tab, setTab] = useState<Tab>('calls');
  const [code, setCode] = useState(initialCode);
  const [friendName, setFriendName] = useState('');
  const [friendNotice, setFriendNotice] = useState('');
  const [chatWith, setChatWith] = useState<Profile | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [freshFriends, setFreshFriends] = useState<ReadonlySet<string>>(new Set());
  const knownFriends = useRef<Set<string> | null>(null);

  // Destaca amizades novas (aceitas aqui ou pelo outro lado) por alguns segundos.
  useEffect(() => {
    if (social.loading) return;
    const ids = social.friends.map((item) => item.id);
    const known = knownFriends.current;
    knownFriends.current = new Set(ids);
    if (!known) return;
    const added = ids.filter((id) => !known.has(id));
    if (added.length === 0) return;
    setFreshFriends((prev) => new Set([...prev, ...added]));
    window.setTimeout(() => setFreshFriends((prev) => new Set([...prev].filter((id) => !added.includes(id)))), 3200);
  }, [social.friends, social.loading]);

  // Com a conversa aberta, tudo que chega nela já conta como lido.
  const chatId = chatWith?.id;
  const lastInChat = chatId ? inbox.lastByFriend.get(chatId)?.id : undefined;
  const { markSeen } = inbox;
  useEffect(() => {
    if (tab === 'messages' && chatId) markSeen(chatId);
  }, [tab, chatId, lastInChat, markSeen]);

  const navIndex = (['calls', 'messages', 'friends'] as Tab[]).indexOf(tab);
  const openChat = (person: Profile) => { setChatWith(person); setTab('messages'); };
  const acceptFriend = (id: string) => {
    setAccepting(id);
    // Deixa a confirmação tocar antes de a linha sair da lista de pedidos.
    window.setTimeout(() => void social.answerFriend(id, true).finally(() => setAccepting(null)), 450);
  };
  const join = (event: FormEvent) => { event.preventDefault(); if (isValidRoomCode(code)) onJoin(code); };
  const add = async (event: FormEvent) => { event.preventDefault(); const error = await social.addFriend(friendName); setFriendNotice(error ?? 'Pedido de amizade enviado.'); if (!error) setFriendName(''); };
  if (!profile) return <main className="app-loading"><div className="spinner" /><p>Preparando seu perfil…</p></main>;
  const friendCount = social.friends.length;
  // Online primeiro; depois em ordem alfabética.
  const friends = [...social.friends].sort((a, b) => Number(online.has(b.person.id)) - Number(online.has(a.person.id)) || a.person.display_name.localeCompare(b.person.display_name));
  const onlineCount = friends.filter((item) => online.has(item.person.id)).length;
  const newestFriend = friends.find((item) => freshFriends.has(item.id));
  // Conversas: mais recentes primeiro; quem nunca conversou fica embaixo, online antes.
  const conversations = [...friends].sort((a, b) => {
    const la = inbox.lastByFriend.get(a.person.id)?.created_at;
    const lb = inbox.lastByFriend.get(b.person.id)?.created_at;
    if (la && lb) return Date.parse(lb) - Date.parse(la);
    return Number(Boolean(lb)) - Number(Boolean(la));
  });
  return <div className="dashboard">
    <aside className="app-sidebar">
      <div className="brand"><img src="/favicon.png" alt="" /><span>Discord 2.0</span></div>
      <nav className="side-nav">
        {/* Indicador único que desliza até o item ativo. */}
        {navIndex >= 0 && <span className="side-nav__indicator" aria-hidden="true" style={{ '--nav-index': navIndex } as CSSProperties} />}
        <button className={tab === 'calls' ? 'is-active' : ''} onClick={() => setTab('calls')}><Icon name="camera" />Chamadas</button>
        <button className={tab === 'messages' ? 'is-active' : ''} onClick={() => setTab('messages')}><Icon name="chat" />Mensagens{inbox.unreadCount > 0 && <b>{inbox.unreadCount}</b>}</button>
        <button className={tab === 'friends' ? 'is-active' : ''} onClick={() => setTab('friends')}><Icon name="users" />Amigos{social.incoming.length > 0 && <b>{social.incoming.length}</b>}</button>
      </nav>
      <div className={`sidebar-user${tab === 'profile' ? ' is-active' : ''}`}>
        <button className="sidebar-user__profile" onClick={() => setTab('profile')} title="Abrir seu perfil" aria-current={tab === 'profile' ? 'page' : undefined}>
          <Avatar profile={profile} size="sm" />
          <span className="sidebar-user__info"><strong>{profile.display_name}</strong><span>@{profile.username}</span></span>
        </button>
        <button className="icon-btn" onClick={() => void signOut()} title="Sair" aria-label="Sair"><Icon name="leave" /></button>
      </div>
    </aside>
    <main className="dashboard__content">
      {tab === 'calls' && <div className="calls-page">
        <header className="dash-head">
          <h1>{greeting()}, {profile.display_name}.</h1>
          <p>{friendCount === 0 ? 'Ninguém na sua lista ainda.' : onlineCount > 0 ? `${onlineCount} de ${friendCount} ${friendCount === 1 ? 'amigo' : 'amigos'} online agora.` : `${friendCount} ${friendCount === 1 ? 'amigo' : 'amigos'} na sua lista, ninguém online agora.`}</p>
        </header>
        {social.invites.length > 0 && <section className="call-invites"><h2>Convites para você</h2>{social.invites.map((invite) => <article key={invite.id}><Avatar profile={invite.sender ?? { display_name: 'Amigo', avatar_url: null }} size="sm" /><div><strong>{invite.sender?.display_name ?? 'Um amigo'} chamou você</strong><span>Sala {invite.room_code}</span></div><button className="btn btn--primary btn--small" onClick={() => { void social.answerCall(invite, true); onJoin(invite.room_code); }}>Entrar</button><button className="icon-btn" onClick={() => void social.answerCall(invite, false)}><Icon name="close" /></button></article>)}</section>}
        <section className="call-hero">
          <div className="call-hero__copy">
            <h2>Abra uma sala.</h2>
            <p>Voz, câmera, tela e chat. Gere um código e mande para a galera.</p>
            <div className="call-hero__actions">
              <button className="btn btn--primary call-hero__create" onClick={() => onJoin(generateRoomCode())}><Icon name="plus" />Criar chamada</button>
              <form className="call-hero__join" onSubmit={join}>
                <input value={code} onChange={(e) => setCode(normalizeRoomCode(e.target.value))} placeholder="Código" maxLength={CODE_LENGTH} aria-label="Código da sala" />
                <button className="btn" disabled={!isValidRoomCode(code)}>Entrar</button>
              </form>
            </div>
          </div>
        </section>
        <section className="friends-quick">
          <div className="dash-section"><h2>Amigos{friendCount > 0 && <span>{friendCount}</span>}</h2><button className="link-btn" onClick={() => setTab('friends')}>Ver todos</button></div>
          {friendCount > 0 && <div className="friend-grid">{friends.slice(0, 6).map((item) => <button key={item.id} className={`friend-card${freshFriends.has(item.id) ? ' is-new' : ''}`} onClick={() => openChat(item.person)}><PresenceAvatar profile={item.person} online={online.has(item.person.id)} /><strong>{item.person.display_name}</strong><span>{online.has(item.person.id) ? 'Online' : `@${item.person.username}`}</span></button>)}</div>}
          {!social.loading && friendCount === 0 && <div className="friends-empty">
            <span className="friends-empty__icon"><Icon name="users" /></span>
            <div><strong>Sua lista está vazia</strong><span>Adicione alguém pelo nome de usuário para conversar e chamar para as salas.</span></div>
            <button className="btn" onClick={() => setTab('friends')}><Icon name="plus" size={16} />Adicionar amigo</button>
          </div>}
        </section>
      </div>}
      {tab === 'friends' && <div className="friends-page"><div className="section-heading"><div><span className="eyebrow">Sua galera</span><h1>Amigos</h1></div></div><form className="add-friend" onSubmit={add}><div><strong>Adicionar amigo</strong><span>Você pode adicionar alguém pelo nome de usuário.</span></div><div><input value={friendName} onChange={(e) => setFriendName(e.target.value)} placeholder="nome_de_usuario" required /><button className="btn btn--primary">Enviar pedido</button></div>{friendNotice && <small>{friendNotice}</small>}</form>{social.error && <p className="notice notice--error">{social.error}</p>}
        {social.incoming.length > 0 && <section className="friend-list"><h2>Pedidos recebidos — {social.incoming.length}</h2>{social.incoming.map((item) => <article key={item.id} className={accepting === item.id ? 'is-accepting' : undefined}><Avatar profile={item.person} /><div><strong>{item.person.display_name}</strong><span>@{item.person.username} quer ser seu amigo</span></div><button className="icon-btn icon-btn--accept" onClick={() => acceptFriend(item.id)} disabled={accepting === item.id} title="Aceitar" aria-label={`Aceitar pedido de ${item.person.display_name}`}><Icon name="check" /></button><button className="icon-btn" onClick={() => void social.answerFriend(item.id, false)}><Icon name="close" /></button></article>)}</section>}
        {social.outgoing.length > 0 && <section className="friend-list"><h2>Pedidos enviados — {social.outgoing.length}</h2>{social.outgoing.map((item) => <article key={item.id}><Avatar profile={item.person} /><div><strong>{item.person.display_name}</strong><span>@{item.person.username} · aguardando resposta</span></div><span className="pending-pill">Pendente</span><button className="icon-btn" title="Cancelar pedido" aria-label={`Cancelar pedido para ${item.person.display_name}`} onClick={() => void social.removeFriend(item.id)}><Icon name="close" /></button></article>)}</section>}
        <section className="friend-list"><h2>Todos os amigos — {friendCount}{onlineCount > 0 && ` · ${onlineCount} online`}</h2>{friends.map((item) => <article key={item.id} className={freshFriends.has(item.id) ? 'is-new' : undefined}><PresenceAvatar profile={item.person} online={online.has(item.person.id)} /><div><strong>{item.person.display_name}</strong><span>@{item.person.username} · {online.has(item.person.id) ? 'Online' : 'Offline'}</span></div><button className="btn btn--small" onClick={() => openChat(item.person)}><Icon name="chat" size={16} /> Mensagem</button><button className="icon-btn" title="Remover amizade" onClick={() => void social.removeFriend(item.id)}><Icon name="close" /></button></article>)}{social.friends.length === 0 && <div className="empty-state"><p>Nenhum amigo adicionado ainda.</p></div>}</section>
      </div>}
      {tab === 'messages' && <div className={`messages-page${chatWith ? ' has-chat' : ''}`}>
        <aside className="conv-list">
          <header><h1>Mensagens</h1><p>{inbox.unreadCount > 0 ? `${inbox.unreadCount} ${inbox.unreadCount === 1 ? 'conversa não lida' : 'conversas não lidas'}` : 'Suas conversas com a galera.'}</p></header>
          {!social.loading && conversations.length === 0 && <div className="conv-empty"><p>Adicione amigos para começar a conversar.</p><button className="btn btn--small" onClick={() => setTab('friends')}><Icon name="plus" size={16} />Adicionar amigo</button></div>}
          <div className="conv-list__items">{conversations.map((item) => {
            const last = inbox.lastByFriend.get(item.person.id);
            const unread = inbox.isUnread(item.person.id);
            return <button key={item.id} className={`conv-item${chatWith?.id === item.person.id ? ' is-active' : ''}${unread ? ' is-unread' : ''}`} onClick={() => setChatWith(item.person)}>
              <PresenceAvatar profile={item.person} size="sm" online={online.has(item.person.id)} />
              <span className="conv-item__text"><strong>{item.person.display_name}</strong><small>{last ? `${last.sender_id === profile.id ? 'Você: ' : ''}${last.body}` : 'Nenhuma mensagem ainda'}</small></span>
              <span className="conv-item__meta">{last && <time>{shortTime(last.created_at)}</time>}{unread && <i aria-label="Não lida" />}</span>
            </button>;
          })}</div>
        </aside>
        <section className="conv-pane">
          <ErrorBoundary area="a conversa" key={chatWith?.id ?? 'vazio'}>
            {chatWith
              ? <DirectChat friend={chatWith} online={online.has(chatWith.id)} onClose={() => setChatWith(null)} />
              : <div className="conv-placeholder"><span><Icon name="chat" size={28} /></span><h2>Escolha uma conversa</h2><p>As mensagens com seus amigos aparecem aqui, em tempo real.</p></div>}
          </ErrorBoundary>
        </section>
      </div>}
      {tab === 'profile' && <ProfileEditor />}
    </main>{newestFriend && <div className="friend-toast" role="status" key={newestFriend.id}><span className="friend-toast__icon"><Icon name="check" size={16} /></span>Agora você e <strong>{newestFriend.person.display_name}</strong> são amigos.</div>}
  </div>;
}
