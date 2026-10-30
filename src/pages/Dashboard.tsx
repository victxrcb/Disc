import { useState, type FormEvent } from 'react';
import { Avatar } from '../components/Avatar';
import { DirectChat } from '../components/DirectChat';
import { Icon } from '../components/Icon';
import { ProfileEditor } from '../components/ProfileEditor';
import { useAuth, type Profile } from '../lib/auth';
import { generateRoomCode, isValidRoomCode, normalizeRoomCode, CODE_LENGTH } from '../lib/roomCode';
import { useSocial } from '../hooks/useSocial';

type Tab = 'calls' | 'friends' | 'profile';
interface Props { initialCode: string; onJoin(code: string): void; }

function greeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

export function Dashboard({ initialCode, onJoin }: Props) {
  const { profile, signOut } = useAuth();
  const social = useSocial();
  const [tab, setTab] = useState<Tab>('calls');
  const [code, setCode] = useState(initialCode);
  const [friendName, setFriendName] = useState('');
  const [friendNotice, setFriendNotice] = useState('');
  const [chatWith, setChatWith] = useState<Profile | null>(null);
  const join = (event: FormEvent) => { event.preventDefault(); if (isValidRoomCode(code)) onJoin(code); };
  const add = async (event: FormEvent) => { event.preventDefault(); const error = await social.addFriend(friendName); setFriendNotice(error ?? 'Pedido de amizade enviado.'); if (!error) setFriendName(''); };
  if (!profile) return <main className="app-loading"><div className="spinner" /><p>Preparando seu perfil…</p></main>;
  const friendCount = social.friends.length;
  return <div className="dashboard">
    <aside className="app-sidebar">
      <div className="brand"><img src="/favicon.png" alt="" /><span>Discord 2.0</span></div>
      <nav>
        <button className={tab === 'calls' ? 'is-active' : ''} onClick={() => setTab('calls')}><Icon name="camera" />Chamadas</button>
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
          <p>{friendCount > 0 ? `${friendCount} ${friendCount === 1 ? 'amigo' : 'amigos'} na sua lista.` : 'Ninguém na sua lista ainda.'}</p>
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
          {friendCount > 0 && <div className="friend-grid">{social.friends.slice(0, 6).map((item) => <button key={item.id} className="friend-card" onClick={() => setChatWith(item.person)}><Avatar profile={item.person} /><strong>{item.person.display_name}</strong><span>@{item.person.username}</span></button>)}</div>}
          {!social.loading && friendCount === 0 && <div className="friends-empty">
            <span className="friends-empty__icon"><Icon name="users" /></span>
            <div><strong>Sua lista está vazia</strong><span>Adicione alguém pelo nome de usuário para conversar e chamar para as salas.</span></div>
            <button className="btn" onClick={() => setTab('friends')}><Icon name="plus" size={16} />Adicionar amigo</button>
          </div>}
        </section>
      </div>}
      {tab === 'friends' && <div className="friends-page"><div className="section-heading"><div><span className="eyebrow">Sua galera</span><h1>Amigos</h1></div></div><form className="add-friend" onSubmit={add}><div><strong>Adicionar amigo</strong><span>Você pode adicionar alguém pelo nome de usuário.</span></div><div><input value={friendName} onChange={(e) => setFriendName(e.target.value)} placeholder="nome_de_usuario" required /><button className="btn btn--primary">Enviar pedido</button></div>{friendNotice && <small>{friendNotice}</small>}</form>{social.error && <p className="notice notice--error">{social.error}</p>}
        {social.incoming.length > 0 && <section className="friend-list"><h2>Pedidos recebidos — {social.incoming.length}</h2>{social.incoming.map((item) => <article key={item.id}><Avatar profile={item.person} /><div><strong>{item.person.display_name}</strong><span>@{item.person.username} quer ser seu amigo</span></div><button className="icon-btn icon-btn--accept" onClick={() => void social.answerFriend(item.id, true)}><Icon name="check" /></button><button className="icon-btn" onClick={() => void social.answerFriend(item.id, false)}><Icon name="close" /></button></article>)}</section>}
        <section className="friend-list"><h2>Todos os amigos — {social.friends.length}</h2>{social.friends.map((item) => <article key={item.id}><Avatar profile={item.person} /><div><strong>{item.person.display_name}</strong><span>@{item.person.username}</span></div><button className="btn btn--small" onClick={() => setChatWith(item.person)}><Icon name="chat" size={16} /> Mensagem</button><button className="icon-btn" title="Remover amizade" onClick={() => void social.removeFriend(item.id)}><Icon name="close" /></button></article>)}{social.friends.length === 0 && <div className="empty-state"><p>Nenhum amigo adicionado ainda.</p></div>}</section>
      </div>}
      {tab === 'profile' && <ProfileEditor />}
    </main>{chatWith && <DirectChat friend={chatWith} onClose={() => setChatWith(null)} />}
  </div>;
}
