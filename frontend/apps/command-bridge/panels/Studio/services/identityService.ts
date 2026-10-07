import { IdentityProfile, UserProfile } from '../types';

export function normalizeStudioIdentity(profile: UserProfile, profileStatus: 'idle' | 'loading' | 'saved' | 'error' = 'idle'): IdentityProfile {
  const axis = (profile as any)?.axis || {};
  const publicIdentity = (profile as any)?.publicIdentity || {};
  const chip = (profile as any)?.studio?.identityChip || {};
  const presence = axis.status || 'online';
  return {
    id: axis.userId || axis.handle || profile.name || 'studio-self',
    name: profile.name,
    handle: axis.handle || publicIdentity.handle || profile.name,
    avatar: profile.avatar,
    role: profile.role,
    tagline: publicIdentity.tagline || axis.presenceText || profile.bio,
    status: profileStatus === 'error' ? 'offline' : presence === 'away' ? 'away' : 'online',
    location: profile.location,
    group: chip.badge || 'builder',
    favorite: false,
    isSelf: true,
    source: 'studio',
    recentActivity: axis.presenceText || publicIdentity.tagline || 'Studio identity active',
    mutualSpaces: ['Studio', 'Axis', ...(Array.isArray(publicIdentity.topics) ? publicIdentity.topics.slice(0, 1) : ['Command Bridge'])],
    accentColor: chip.accentColor || axis.color || '#8b5cf6',
    badge: chip.badge || 'Builder',
    cardStyle: chip.cardStyle || 'glass',
    visibleFields: chip.visibleFields || {
      handle: true,
      role: true,
      location: true,
      activity: true,
      spaces: true,
    },
  };
}
