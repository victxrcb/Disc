import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { THEME_OPTIONS, useTheme, type AppTheme } from '../lib/theme';
import { Avatar } from './Avatar';

export function ProfileEditor() {
  const { user, profile, refreshProfile } = useAuth();
  const { theme, setTheme } = useTheme();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [username, setUsername] = useState(profile?.username ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setDisplayName(profile?.display_name ?? ''); setUsername(profile?.username ?? ''); }, [profile]);
  if (!user || !profile) return <div className="empty-state"><p>Preparando seu perfil…</p></div>;

  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('');
    const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24);
    if (cleanUsername.length < 3) { setMessage('Use pelo menos 3 caracteres no nome de usuário.'); setBusy(false); return; }
    const { error } = await supabase!.from('profiles').update({ username: cleanUsername, display_name: displayName.trim().slice(0, 32), theme }).eq('id', user.id);
    setMessage(error ? (error.code === '23505' ? 'Esse nome de usuário já está em uso.' : error.message) : 'Perfil atualizado.');
    if (!error) await refreshProfile();
    setBusy(false);
  };
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !supabase) return;
    if (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) { setMessage('Escolha uma imagem de até 5 MB.'); return; }
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
  const chooseTheme = async (next: AppTheme) => {
    setTheme(next);
    await supabase?.from('profiles').update({ theme: next }).eq('id', user.id);
    await refreshProfile();
  };
  return <div className="profile-editor">
    <div className="profile-editor__cover"><div className="profile-editor__avatar"><Avatar profile={profile} size="lg" /><button type="button" onClick={() => fileRef.current?.click()}>Trocar foto</button><input ref={fileRef} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={upload} /></div></div>
    <form onSubmit={save} className="profile-form"><div className="section-heading"><div><span className="eyebrow">Identidade</span><h2>Seu perfil</h2></div></div>
      <div className="profile-form__grid"><label className="field"><span className="field__label">Nome de exibição</span><input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={32} required /></label><label className="field"><span className="field__label">Nome de usuário</span><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} maxLength={24} required /></label></div>
      <div className="profile-theme"><span className="field__label">Personalização do app</span><div className="profile-theme__options">{THEME_OPTIONS.map((option) => <button key={option.id} type="button" className={`profile-theme__card profile-theme__card--${option.id}${theme === option.id ? ' is-active' : ''}`} onClick={() => void chooseTheme(option.id)}><span className="profile-theme__preview" /><strong>{option.label}</strong><small>{option.description}</small></button>)}</div></div>
      {message && <p className={`notice ${message.includes('atualizad') ? 'notice--success' : 'notice--warn'}`}>{message}</p>}<button className="btn btn--primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar perfil'}</button>
    </form>
  </div>;
}
