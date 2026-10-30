import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { THEME_OPTIONS, useTheme, type AppTheme } from '../lib/theme';
import { Avatar } from './Avatar';
import { Icon } from './Icon';

export function ProfileEditor() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [username, setUsername] = useState(profile?.username ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const avatarFileRef = useRef<HTMLInputElement>(null);
  const bannerFileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setDisplayName(profile?.display_name ?? ''); setUsername(profile?.username ?? ''); }, [profile]);
  if (!user || !profile) return <div className="empty-state"><p>Preparando seu perfil…</p></div>;

  const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24);
  const cleanDisplayName = displayName.trim().slice(0, 32);
  // O tema é salvo na hora; o botão só cuida de nome e usuário.
  const dirty = cleanDisplayName !== profile.display_name || cleanUsername !== profile.username;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!dirty) return;
    setBusy(true); setMessage('');
    if (cleanUsername.length < 3) { setMessage('Use pelo menos 3 caracteres no nome de usuário.'); setBusy(false); return; }
    const { error } = await supabase!.from('profiles').update({ username: cleanUsername, display_name: cleanDisplayName, theme }).eq('id', user.id);
    setMessage(error ? (error.code === '23505' ? 'Esse nome de usuário já está em uso.' : error.message) : 'Perfil atualizado.');
    if (!error) await refreshProfile();
    setBusy(false);
  };
  const uploadAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !supabase) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size > 5 * 1024 * 1024) { setMessage('Escolha uma imagem ou GIF de até 5 MB.'); event.target.value = ''; return; }
    setBusy(true); setMessage('');
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const path = `${user.id}/avatar.${ext}`;
    const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
    if (error) setMessage(error.message);
    else {
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      await supabase.from('profiles').update({ avatar_url: `${data.publicUrl}?v=${Date.now()}` }).eq('id', user.id);
      await refreshProfile(); setMessage('Foto atualizada.');
    }
    setBusy(false); event.target.value = '';
  };
  const uploadBanner = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !supabase) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setMessage('Escolha uma imagem ou GIF de até 10 MB.');
      event.target.value = '';
      return;
    }
    setBusy(true); setMessage('');
    const extensionByType: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
    const path = `${user.id}/banner.${extensionByType[file.type]}`;
    const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
    if (error) setMessage(error.message);
    else {
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      const { error: updateError } = await supabase.from('profiles').update({ banner_url: `${data.publicUrl}?v=${Date.now()}` }).eq('id', user.id);
      if (updateError) setMessage(updateError.message);
      else { await refreshProfile(); setMessage('Banner atualizado.'); }
    }
    setBusy(false); event.target.value = '';
  };
  const chooseTheme = async (next: AppTheme) => {
    setTheme(next);
    setMessage('');
    const { error } = await supabase!.from('profiles').update({ theme: next }).eq('id', user.id);
    if (error) {
      setMessage(`O tema foi aplicado neste dispositivo, mas não foi salvo na conta: ${error.message}`);
      return;
    }
    setMessage('Tema atualizado.');
    await refreshProfile();
  };
  return <div className="profile-editor">
    <div className={`profile-editor__cover${profile.banner_url ? ' has-banner' : ''}`}>
      {profile.banner_url && <img src={profile.banner_url} alt="" />}
      <button type="button" className="profile-editor__banner-button" onClick={() => bannerFileRef.current?.click()} disabled={busy}>
        <Icon name="upload" size={16} />{profile.banner_url ? 'Trocar banner' : 'Adicionar banner'}
      </button>
      <input ref={bannerFileRef} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={uploadBanner} />
    </div>
    <div className="profile-editor__identity">
      <button type="button" className="profile-editor__avatar" onClick={() => avatarFileRef.current?.click()} disabled={busy} title="Trocar foto" aria-label="Trocar foto">
        <Avatar profile={profile} size="lg" /><span className="profile-editor__avatar-edit"><Icon name="camera" size={16} /></span>
      </button>
      <div className="profile-editor__name"><strong>{profile.display_name}</strong><span>@{profile.username}</span></div>
      <button type="button" className="btn btn--small" onClick={() => avatarFileRef.current?.click()} disabled={busy}><Icon name="upload" size={16} />Trocar foto</button>
      <input ref={avatarFileRef} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={uploadAvatar} />
    </div>
    <form onSubmit={save} className="profile-form">
      <div className="profile-form__grid"><label className="field"><span className="field__label">Nome de exibição</span><input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={32} required /></label><label className="field"><span className="field__label">Nome de usuário</span><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} maxLength={24} required /></label></div>
      <div className="profile-theme"><span className="field__label">Tema do app</span><div className="profile-theme__options">{THEME_OPTIONS.map((option) => <button key={option.id} type="button" className={`profile-theme__card profile-theme__card--${option.id}${theme === option.id ? ' is-active' : ''}`} onClick={() => void chooseTheme(option.id)} aria-pressed={theme === option.id}><span className="profile-theme__preview">{option.id === 'celestial' && <video src="/themes/celestial-veil.mp4" autoPlay muted loop playsInline preload="metadata" aria-hidden="true" />}</span><strong>{option.label}</strong><small>{option.description}</small></button>)}</div></div>
      <div className="profile-form__actions">
        <button className="btn btn--primary" disabled={busy || !dirty} title={dirty ? undefined : 'Nenhuma alteração para salvar'}>{busy ? 'Salvando…' : 'Salvar perfil'}</button>
        {dirty && !busy && <button className="btn" type="button" onClick={() => { setDisplayName(profile.display_name); setUsername(profile.username); }}>Descartar</button>}
        {message && <p className={`notice ${message.includes('atualizad') ? 'notice--success' : 'notice--warn'}`} role="status">{message}</p>}
      </div>
      <section className="profile-session">
        <div><strong>Sessão neste dispositivo</strong><span>Sua conta continuará conectada quando você fechar o aplicativo.</span></div>
        <button className="btn btn--danger" type="button" disabled={busy} onClick={() => void signOut()}>Encerrar sessão</button>
      </section>
    </form>
  </div>;
}
