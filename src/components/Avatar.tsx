import type { Profile } from '../lib/auth';

export function Avatar({ profile, size = 'md' }: { profile: Pick<Profile, 'display_name' | 'avatar_url'>; size?: 'sm' | 'md' | 'lg' }) {
  return profile.avatar_url
    ? <img className={`avatar avatar--${size}`} src={profile.avatar_url} alt="" referrerPolicy="no-referrer" />
    : <span className={`avatar avatar--${size} avatar--fallback`}>{profile.display_name.trim().charAt(0).toUpperCase() || '?'}</span>;
}

/** Avatar com a bolinha de status (online/offline) no canto. */
export function PresenceAvatar({ profile, size = 'md', online }: { profile: Pick<Profile, 'display_name' | 'avatar_url'>; size?: 'sm' | 'md' | 'lg'; online: boolean }) {
  return <span className={`presence-avatar presence-avatar--${size}${online ? ' is-online' : ''}`}><Avatar profile={profile} size={size} /><i title={online ? 'Online' : 'Offline'} /></span>;
}
