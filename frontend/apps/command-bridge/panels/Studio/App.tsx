import * as React from 'react';
import { useState, useEffect } from 'react';
import DashboardCanvas from './components/DashboardCanvas';
import BottomNav from './components/ui/BottomNav';
import GalleryWidget from './components/widgets/GalleryWidget';
import { ProfileWidget } from './components/widgets/ProfileWidget';
import HubFeedWidget from './components/widgets/HubFeedWidget';
import ChatDetail from './components/views/ChatDetail';
import PathwaysView from './components/views/PathwaysView';
import CommunityView from './components/views/CommunityView';
import CommunityHubView from './components/views/CommunityHubView';
import PortfolioView from './components/views/PortfolioView';
import EcosystemView from './components/views/EcosystemView';
import ProfileEditorView from './components/views/ProfileEditorView';
import StudioSpaceView from './components/views/StudioSpaceView';
import NavConfigModal, { NavTheme } from './components/ui/NavConfigModal';
import { INITIAL_WIDGETS, INITIAL_PROFILE } from './constants';
import { WidgetData, UserProfile, AppView, ChatSession, IdentityProfile } from './types';
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion';
import { startDirect } from './services/directsService';
import { stableAvatar } from './services/avatarService';

const fallbackImage = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=1000&auto=format&fit=crop';

function mapStudioProfile(profile: any): UserProfile {
  const name = profile?.name || INITIAL_PROFILE.name;
  const handle = profile?.axis?.handle || profile?.publicIdentity?.handle || name;
  const id = profile?.axis?.userId || profile?.studio?.identity?.userId || handle || name;
  return {
    name,
    role: profile?.role || INITIAL_PROFILE.role,
    bio: profile?.bio || INITIAL_PROFILE.bio,
    manifesto: profile?.manifesto || INITIAL_PROFILE.manifesto,
    avatar: stableAvatar({ id, name, handle, avatar: profile?.avatar || INITIAL_PROFILE.avatar }),
    location: profile?.location || INITIAL_PROFILE.location,
    timezone: profile?.timezone || INITIAL_PROFILE.timezone,
    coverImage: profile?.coverImage || fallbackImage,
    axis: profile?.axis,
    publicIdentity: profile?.publicIdentity,
    studio: profile?.studio,
  } as UserProfile;
}

function ensureCoreStudioWidgets(widgets: WidgetData[]) {
  const next = Array.isArray(widgets) && widgets.length ? [...widgets] : [...INITIAL_WIDGETS];
  if (!next.some(widget => widget.type === 'SOCIAL_ACTIVITY')) {
    next.splice(Math.min(4, next.length), 0, {
      id: 'w-social-activity',
      type: 'SOCIAL_ACTIVITY',
      title: 'SOMA Social',
      colSpan: 1,
      rowSpan: 1,
      content: {},
    });
  }
  return next;
}

function StudioSignInGate({
  profile,
  onRegistered,
  mode = 'register',
}: {
  profile: any;
  onRegistered: (profile: any) => void;
  mode?: 'register' | 'signin';
}) {
  const initialHandle = String(profile?.axis?.handle || profile?.publicIdentity?.handle || profile?.name || '')
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  const [displayName, setDisplayName] = useState(profile?.name || '');
  const [username, setUsername] = useState(initialHandle);
  const [passcode, setPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [status, setStatus] = useState<{ checking?: boolean; available?: boolean; handle?: string; reason?: string }>({});
  const [busy, setBusy] = useState(false);
  const currentUserId = profile?.axis?.userId || profile?.studio?.identity?.userId || '';
  const passcodeMismatch = mode === 'register' && confirmPasscode.length > 0 && passcode !== confirmPasscode;
  const passcodeReady = passcode.trim().length >= 4 && (mode === 'signin' || passcode === confirmPasscode);

  useEffect(() => {
    if (mode === 'signin') {
      setStatus({});
      return;
    }
    const q = username.trim();
    if (!q) {
      setStatus({});
      return;
    }
    setStatus(prev => ({ ...prev, checking: true }));
    const timer = window.setTimeout(() => {
      fetch(`/api/studio/identity/check?username=${encodeURIComponent(q)}&currentUserId=${encodeURIComponent(currentUserId)}`)
        .then(r => r.json())
        .then(data => setStatus({ checking: false, available: Boolean(data.available), handle: data.handle, reason: data.reason }))
        .catch(() => setStatus({ checking: false, available: false, reason: 'Could not check username.' }));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [username, currentUserId, mode]);

  const register = async () => {
    if (busy || !passcodeReady || (mode === 'register' && !status.available)) return;
    setBusy(true);
    try {
      const response = await fetch(mode === 'signin' ? '/api/studio/identity/login' : '/api/studio/identity/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, displayName, currentUserId, passcode }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        setStatus({ checking: false, available: false, reason: data.reason || data.error || 'Registration failed.' });
        return;
      }
      const axisUser = {
        id: data.user.userId,
        name: data.user.displayName,
        color: data.user.color || 'violet',
        avatar: stableAvatar({
          id: data.user.userId,
          name: data.user.displayName,
          handle: data.user.handle,
          avatar: data.profile?.avatar,
        }),
        handle: data.user.handle,
        role: data.profile?.role,
        bio: data.profile?.bio,
        location: data.profile?.location,
        timezone: data.profile?.timezone,
      };
      if (data.token) localStorage.setItem('studio_session_v1', data.token);
      localStorage.setItem('studio_user_v2', JSON.stringify(data.user));
      localStorage.setItem('axis_user_v2', JSON.stringify(axisUser));
      window.dispatchEvent(new CustomEvent('studio:profile-saved', { detail: data.profile }));
      onRegistered(data.profile);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/88 px-5 backdrop-blur-xl">
      <div className="w-full max-w-md overflow-hidden rounded-[28px] border border-white/10 bg-[#0b0c10] shadow-2xl">
        <div className="border-b border-white/8 bg-white/[0.03] px-7 py-6">
          <p className="mb-2 text-[10px] font-black uppercase tracking-[0.34em] text-violet-300/80">Studio Identity</p>
          <h2 className="text-2xl font-black tracking-tight text-white">{mode === 'signin' ? 'Sign in to Studio' : 'Claim your username'}</h2>
          <p className="mt-2 text-sm leading-relaxed text-white/45">
            {mode === 'signin'
              ? 'Enter your Studio username and passcode to restore the local session.'
              : 'This becomes your portable Studio ID across Axis, Directs, Rooms, communities, and future Command Bridge apps.'}
          </p>
        </div>
        <div className="space-y-4 px-7 py-6">
          {mode === 'register' && (
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">Display name</span>
              <input
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm text-white outline-none transition focus:border-violet-300/50"
                placeholder="Barry"
              />
            </label>
          )}
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">Username</span>
            <div className="flex items-center rounded-2xl border border-white/10 bg-white/[0.06] px-4 transition focus-within:border-violet-300/50">
              <span className="text-white/30">@</span>
              <input
                value={username}
                onChange={e => setUsername(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') register(); }}
                className="min-w-0 flex-1 bg-transparent py-3 pl-1 text-sm text-white outline-none"
                placeholder="username"
                autoFocus
              />
            </div>
            <div className={`mt-2 min-h-[18px] text-xs ${status.available ? 'text-emerald-300' : status.reason ? 'text-rose-300' : 'text-white/30'}`}>
              {mode === 'signin'
                ? 'This ID follows you through Studio, Axis, Directs, Rooms, and communities.'
                : status.checking
                ? 'Checking availability...'
                : status.available
                  ? `@${status.handle} is available.`
                  : status.reason || 'Use letters, numbers, and underscores.'}
            </div>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">Passcode</span>
            <input
              value={passcode}
              onChange={e => setPasscode(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') register(); }}
              type="password"
              className="w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm text-white outline-none transition focus:border-violet-300/50"
              placeholder={mode === 'signin' ? 'Enter passcode' : 'Create passcode'}
            />
            <div className="mt-2 text-xs text-white/30">Local protection for this Studio identity. Minimum 4 characters.</div>
          </label>
          {mode === 'register' && (
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">Verify passcode</span>
              <input
                value={confirmPasscode}
                onChange={e => setConfirmPasscode(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') register(); }}
                type="password"
                className="w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm text-white outline-none transition focus:border-violet-300/50"
                placeholder="Re-enter passcode"
              />
              <div className={`mt-2 min-h-[18px] text-xs ${passcodeMismatch ? 'text-rose-300' : passcodeReady ? 'text-emerald-300' : 'text-white/30'}`}>
                {passcodeMismatch ? 'Passcodes do not match.' : passcodeReady ? 'Passcodes match.' : 'Confirm before registering.'}
              </div>
            </label>
          )}
          <button
            onClick={register}
            disabled={busy || !passcodeReady || (mode === 'register' && !status.available)}
            className="w-full rounded-2xl bg-white py-3 text-sm font-black text-black transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {busy ? (mode === 'signin' ? 'Signing in...' : 'Registering...') : (mode === 'signin' ? 'Sign In' : 'Register Studio ID')}
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [widgets, setWidgets] = useState<WidgetData[]>(INITIAL_WIDGETS);
  const [userProfile, setUserProfile] = useState<UserProfile>(INITIAL_PROFILE);
  const [studioProfile, setStudioProfile] = useState<any>(null);
  const latestStudioRef = React.useRef<any>(null);
  const [profileStatus, setProfileStatus] = useState<'idle' | 'loading' | 'saved' | 'error'>('loading');
  const [isEditMode, setIsEditMode] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [currentView, setCurrentView] = useState<AppView>('home');
  const [activeChat, setActiveChat] = useState<ChatSession | null>(null);
  const [activeIdentity, setActiveIdentity] = useState<IdentityProfile | null>(null);
  const [signedOut, setSignedOut] = useState(() => localStorage.getItem('studio:signed-out') === 'true');
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  
  // Nav Settings
  const [navTheme, setNavTheme] = useState<NavTheme>({ style: 'ISLAND', color: '#ffffff' });
  const [showNavConfig, setShowNavConfig] = useState(false);
  
  // Community Hub State
  const [communityNavState, setCommunityNavState] = useState<{ id?: string, mode?: 'explore' | 'detail' | 'create' }>({});

  useEffect(() => {
      let cancelled = false;
      fetch('/api/studio/profile')
          .then(r => r.json())
          .then(data => {
              if (cancelled || !data?.profile) return;
              latestStudioRef.current = data.profile;
              setStudioProfile(data.profile);
              setUserProfile(mapStudioProfile(data.profile));
              if (Array.isArray(data.profile?.studio?.widgets)) setWidgets(ensureCoreStudioWidgets(data.profile.studio.widgets));
              if (data.profile?.studio?.navTheme) setNavTheme(data.profile.studio.navTheme);
              setProfileStatus('idle');
          })
          .catch(() => setProfileStatus('error'));
      return () => { cancelled = true; };
  }, []);

  const persistStudio = (nextProfile: any, nextWidgets = widgets, nextNavTheme = navTheme) => {
      const base = latestStudioRef.current || studioProfile || {};
      const merged = {
          ...base,
          ...(nextProfile || {}),
          studio: {
              ...(base.studio || {}),
              ...(nextProfile?.studio || {}),
              widgets: nextWidgets,
              navTheme: nextNavTheme,
          },
      };
      latestStudioRef.current = merged;
      setStudioProfile(merged);
      setProfileStatus('loading');
      fetch('/api/studio/profile', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile: merged }),
      })
          .then(r => r.json())
          .then(data => {
              if (!data?.ok) throw new Error(data?.error || 'save failed');
              latestStudioRef.current = data.profile;
              setStudioProfile(data.profile);
              setProfileStatus('saved');
              window.setTimeout(() => setProfileStatus('idle'), 1800);
              window.dispatchEvent(new CustomEvent('studio:profile-saved', { detail: data.profile }));
          })
          .catch(() => setProfileStatus('error'));
  };

  // Widget Operations — pass null as nextProfile so widget saves never touch profile fields
  const updateWidget = (id: string, updates: Partial<WidgetData>) => {
    setWidgets(prev => {
        const next = prev.map(w => w.id === id ? { ...w, ...updates } : w);
        persistStudio(null, next);
        return next;
    });
  };

  const removeWidget = (id: string) => {
    setWidgets(prev => {
        const next = prev.filter(w => w.id !== id);
        persistStudio(null, next);
        return next;
    });
  };

  const addWidget = (widget: WidgetData) => {
    setWidgets(prev => {
        const next = [...prev, widget];
        persistStudio(null, next);
        return next;
    });
  };

  const reorderWidgets = (dragIndex: number, hoverIndex: number) => {
    setWidgets(prev => {
        const newWidgets = [...prev];
        const draggedItem = newWidgets[dragIndex];
        newWidgets.splice(dragIndex, 1);
        newWidgets.splice(hoverIndex, 0, draggedItem);
        persistStudio(null, newWidgets);
        return newWidgets;
    });
  };

  const updateNavTheme = (theme: NavTheme) => {
      setNavTheme(theme);
      persistStudio(null, widgets, theme);
  };

  const updateStudioPortfolio = (portfolio: any[]) => {
      persistStudio({ studio: { portfolio } });
      setUserProfile(prev => ({ ...prev, studio: { ...((prev as any).studio || {}), portfolio } } as UserProfile));
  };
  
  const updateProfile = (updates: Partial<UserProfile>) => {
      setUserProfile(prev => {
          const nextProfile = { ...prev, ...updates };
          const base = latestStudioRef.current || studioProfile || {};
          const merged = {
              ...base,
              ...nextProfile,
              axis: {
                  ...(base.axis || {}),
                  ...((prev as any).axis || {}),
                  ...((updates as any).axis || {}),
              },
              publicIdentity: {
                  ...(base.publicIdentity || {}),
                  ...((prev as any).publicIdentity || {}),
                  ...((updates as any).publicIdentity || {}),
                  tagline: (updates as any).publicIdentity?.tagline ?? (base.publicIdentity?.tagline || nextProfile.role),
                  topics: (updates as any).publicIdentity?.topics ?? (base.publicIdentity?.topics || (prev as any).publicIdentity?.topics),
              },
          };
          persistStudio(merged);
          return nextProfile;
      });
  };

  // Navigation Logic
  const handleNavigate = (view: AppView) => {
      setCurrentView(view);
      setActiveChat(null); 
      if (view !== 'studio-space') setActiveIdentity(null);
      window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Listen for custom navigation events from deep widgets
  useEffect(() => {
      const handleAppNavigate = (e: any) => {
          const { view, context } = e.detail;
          if (view === 'community-hub') {
              setCommunityNavState({
                  id: context?.communityId,
                  mode: context?.mode || (context?.communityId ? 'detail' : 'explore')
              });
              setCurrentView('community-hub');
              window.scrollTo({ top: 0, behavior: 'smooth' });
          } else if (view === 'portfolio') {
              setCurrentView('portfolio');
              window.scrollTo({ top: 0, behavior: 'smooth' });
          } else if (view === 'ecosystem') {
              setCurrentView('ecosystem');
              window.scrollTo({ top: 0, behavior: 'smooth' });
          } else if (view === 'stage') {
              setCurrentView('stage');
              window.scrollTo({ top: 0, behavior: 'smooth' });
          } else if (view === 'chats') {
              setCurrentView('chats');
              if (context?.chat) setActiveChat(context.chat);
              window.scrollTo({ top: 0, behavior: 'smooth' });
          } else if (view === 'studio-space') {
              setActiveIdentity(context?.identity || null);
              setCurrentView('studio-space');
              window.scrollTo({ top: 0, behavior: 'smooth' });
          }
      };

      // The Stage iframe (Studio.dc.html) posts this when its logo is clicked.
      const handleStageMessage = (e: MessageEvent) => {
          if (e?.data?.type === 'studio-stage-exit') handleNavigate('home');
      };

      window.addEventListener('app:navigate', handleAppNavigate);
      window.addEventListener('studio:navigate', handleAppNavigate);
      window.addEventListener('message', handleStageMessage);
      return () => {
          window.removeEventListener('app:navigate', handleAppNavigate);
          window.removeEventListener('studio:navigate', handleAppNavigate);
          window.removeEventListener('message', handleStageMessage);
      };
  }, []);

  const handleAdd = () => {
      if (currentView !== 'home') {
          setCurrentView('home');
          setTimeout(() => setShowCatalog(true), 300); 
      } else {
          setShowCatalog(true);
      }
  };

  const handleEditProfile = () => {
      setCurrentView('profile-editor');
      setIsEditMode(false); // Optional: Exit grid edit mode when entering specific editor
      window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openIdentityDirect = async (identity: IdentityProfile) => {
      let chat: ChatSession;
      try {
          chat = await startDirect({ id: identity.id, name: identity.name, image: identity.avatar });
      } catch {
          chat = {
              id: identity.id,
              title: identity.name,
              image: identity.avatar,
              members: '',
              messagesCount: 'Direct contact',
              status: 'active',
              axisSource: 'local',
          } as ChatSession;
      }
      setActiveChat(chat);
      setCurrentView('chats');
  };

  // Scroll Animation for Header
  const { scrollY } = useScroll();
  const headerOpacity = useTransform(scrollY, [0, 100], [1, 0]);
  const headerY = useTransform(scrollY, [0, 100], [0, -40]);
  const headerPointerEvents = useTransform(scrollY, (y) => y > 90 ? 'none' : 'auto');

  // View Transition Variants
  const pageVariants = {
    initial: { opacity: 0, x: 10 },
    in: { opacity: 1, x: 0 },
    out: { opacity: 0, x: -10 }
  };

  const pageTransition = {
    type: "tween",
    ease: "circOut",
    duration: 0.3
  };

  // Helper to get dummy widget data for standalone views if needed
  const getDummyWidgetData = (type: any): WidgetData => ({
      id: 'standalone', type, title: 'Standalone', colSpan: 4, rowSpan: 4, content: {}
  });

  // Find existing profile widget for editor view
  const profileWidget = widgets.find(w => w.type === 'PROFILE') || getDummyWidgetData('PROFILE');
  const identityRegistered = Boolean(studioProfile?.studio?.identity?.registered && studioProfile?.axis?.userId && studioProfile?.axis?.handle);

  const handleIdentityRegistered = (profile: any) => {
      localStorage.removeItem('studio:signed-out');
      setSignedOut(false);
      latestStudioRef.current = profile;
      setStudioProfile(profile);
      setUserProfile(mapStudioProfile(profile));
      if (Array.isArray(profile?.studio?.widgets)) setWidgets(ensureCoreStudioWidgets(profile.studio.widgets));
      if (profile?.studio?.navTheme) setNavTheme(profile.studio.navTheme);
      setProfileStatus('saved');
      window.setTimeout(() => setProfileStatus('idle'), 1500);
  };

  const signOutStudio = () => {
      localStorage.setItem('studio:signed-out', 'true');
      localStorage.removeItem('studio_session_v1');
      localStorage.removeItem('studio_user_v2');
      localStorage.removeItem('axis_user_v2');
      setAccountMenuOpen(false);
      setSignedOut(true);
  };

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#000000] font-sans text-white selection:bg-purple-500/30 [transform:translateZ(0)]">
      {profileStatus !== 'loading' && studioProfile && (!identityRegistered || signedOut) && (
        <StudioSignInGate profile={studioProfile} onRegistered={handleIdentityRegistered} mode={identityRegistered ? 'signin' : 'register'} />
      )}
      {identityRegistered && !signedOut && !activeChat && currentView !== 'home' && currentView !== 'ecosystem' && currentView !== 'stage' && currentView !== 'profile-editor' && (
        <div className="fixed right-4 top-4 z-[90]">
          <button
            onClick={() => setAccountMenuOpen(v => !v)}
            title="Studio account"
            className="flex items-center gap-2 rounded-full border border-white/10 bg-black/55 px-3 py-2 text-left text-xs text-white/55 backdrop-blur-xl transition hover:border-white/20 hover:text-white"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-400/15 text-[10px] font-black text-violet-200">
              {(userProfile.name || '?')[0].toUpperCase()}
            </span>
            <span className="hidden sm:block">@{studioProfile?.axis?.handle || 'studio'}</span>
          </button>
          {accountMenuOpen && (
            <div className="mt-2 w-56 overflow-hidden rounded-2xl border border-white/10 bg-[#0b0c10]/95 p-2 text-xs text-white/65 shadow-2xl backdrop-blur-xl">
              <div className="px-3 py-2">
                <div className="font-bold text-white">{userProfile.name}</div>
                <div className="text-white/40">@{studioProfile?.axis?.handle || 'studio'}</div>
              </div>
              <button
                onClick={() => { setAccountMenuOpen(false); setCurrentView('profile-editor'); }}
                className="block w-full rounded-xl px-3 py-2 text-left transition hover:bg-white/5 hover:text-white"
              >
                Edit profile
              </button>
              <button
                onClick={signOutStudio}
                className="block w-full rounded-xl px-3 py-2 text-left text-rose-300/80 transition hover:bg-rose-500/10 hover:text-rose-200"
              >
                Sign out / switch user
              </button>
            </div>
          )}
        </div>
      )}
      
      {/* Nav Config Modal */}
      <NavConfigModal 
        isOpen={showNavConfig} 
        onClose={() => setShowNavConfig(false)}
        currentTheme={navTheme}
        onSave={updateNavTheme}
      />

      {/* Main Content Area */}
      <main className="mx-auto h-full min-h-0 w-full max-w-none overflow-y-auto overflow-x-hidden pb-28 custom-scrollbar">
          <AnimatePresence mode="wait">
            
            {/* HOME VIEW */}
            {currentView === 'home' && (
                <motion.div 
                    key="home"
                    initial="initial" animate="in" exit="out" variants={pageVariants} transition={pageTransition}
                >
                    <DashboardCanvas 
                        widgets={widgets} 
                        userProfile={userProfile}
                        isEditMode={isEditMode}
                        onUpdateWidget={updateWidget}
                        onRemoveWidget={removeWidget}
                        onAddWidget={addWidget}
                        onReorderWidget={reorderWidgets}
                        onUpdateProfile={updateProfile}
                        showCatalog={showCatalog}
                        setShowCatalog={setShowCatalog}
                        onEditProfile={handleEditProfile}
                        profileStatus={profileStatus}
                    />
                </motion.div>
            )}

            {/* CHATS VIEW */}
            {currentView === 'chats' && (
                <motion.div 
                    key="chats"
                    initial="initial" animate="in" exit="out" variants={pageVariants} transition={pageTransition}
                    className="w-full min-h-screen"
                >
                    {activeChat ? (
                        <ChatDetail 
                            chat={activeChat} 
                            onBack={() => setActiveChat(null)} 
                            currentUserAvatar={userProfile.avatar}
                        />
                    ) : (
                        <div className="max-w-2xl mx-auto min-h-[80vh]">
                            <GalleryWidget 
                                data={getDummyWidgetData('GALLERY')} 
                                onChatSelect={(chat) => setActiveChat(chat)}
                                currentUser={userProfile}
                            />
                        </div>
                    )}
                </motion.div>
            )}

            {/* PATHWAYS VIEW — Scatter Protocol P2P (Snapchat × BitChat) */}
            {currentView === 'pathways' && (
                <motion.div
                    key="pathways"
                    initial="initial" animate="in" exit="out" variants={pageVariants} transition={pageTransition}
                    className="w-full min-h-screen"
                >
                    <PathwaysView
                        currentUser={userProfile}
                        onBack={() => handleNavigate('home')}
                    />
                </motion.div>
            )}

            {/* PROFILE VIEW (Public View) */}
            {currentView === 'profile' && (
                <motion.div 
                    key="profile"
                    initial="initial" animate="in" exit="out" variants={pageVariants} transition={pageTransition}
                    className="w-full min-h-screen relative"
                >
                    <div className="relative z-10 min-h-screen">
                        <ProfileWidget 
                            data={profileWidget} 
                            profile={userProfile} 
                            isEditMode={isEditMode}
                            onUpdateProfile={updateProfile}
                        />
                    </div>
                </motion.div>
            )}
            
            {/* PROFILE EDITOR VIEW (Settings) */}
            {currentView === 'profile-editor' && (
                <motion.div 
                    key="profile-editor"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.4 }}
                    className="fixed inset-0 z-[100] w-full bg-black overflow-y-auto"
                >
                    <ProfileEditorView 
                        profile={userProfile}
                        widgetData={profileWidget}
                        onUpdateProfile={updateProfile}
                        onUpdateWidget={updateWidget}
                        onBack={() => handleNavigate('home')}
                    />
                </motion.div>
            )}

            {/* COMMUNITY PEOPLE VIEW */}
            {currentView === 'community' && (
                <motion.div 
                    key="community"
                    initial="initial" animate="in" exit="out" variants={pageVariants} transition={pageTransition}
                    className="w-full min-h-screen"
                >
                    <CommunityView 
                        currentUser={userProfile}
                        onBack={() => handleNavigate('home')}
                    />
                </motion.div>
            )}

            {/* COMMUNITY HUB VIEW (Groups) */}
            {currentView === 'community-hub' && (
                <motion.div 
                    key="community-hub"
                    initial="initial" animate="in" exit="out" variants={pageVariants} transition={pageTransition}
                    className="w-full min-h-screen"
                >
                    <CommunityHubView 
                        currentUser={userProfile}
                        onBack={() => handleNavigate('home')}
                        initialCommunityId={communityNavState.id}
                        initialMode={communityNavState.mode}
                    />
                </motion.div>
            )}

            {/* PORTFOLIO VIEW */}
            {currentView === 'portfolio' && (
                <motion.div 
                    key="portfolio"
                    initial="initial" animate="in" exit="out" variants={pageVariants} transition={pageTransition}
                    className="w-full min-h-screen"
                >
                    <PortfolioView
                        currentUser={userProfile}
                        onPortfolioChange={updateStudioPortfolio}
                        onBack={() => handleNavigate('home')}
                    />
                </motion.div>
            )}

            {/* ECOSYSTEM COCKPIT VIEW */}
            {currentView === 'ecosystem' && (
                <motion.div 
                    key="ecosystem"
                    initial="initial" animate="in" exit="out" variants={pageVariants} transition={pageTransition}
                    className="fixed inset-0 z-[100] w-full bg-black"
                >
                    <EcosystemView
                        currentUser={userProfile}
                        onBack={() => handleNavigate('home')}
                    />
                </motion.div>
            )}

            {/* STAGE VIEW — the full Studio experience (Current / Flux / Brainrot / Signals / Live / Communities) */}
            {currentView === 'stage' && (
                <motion.div
                    key="stage"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="fixed inset-0 z-[100] w-full bg-[#06060a]"
                >
                    <iframe
                        src="/stage/Studio.dc.html"
                        title="Studio Stage"
                        className="absolute inset-0 h-full w-full border-0"
                        allow="autoplay; fullscreen; clipboard-read; clipboard-write"
                    />
                </motion.div>
            )}

            {currentView === 'studio-space' && activeIdentity && (
                <motion.div
                    key="studio-space"
                    initial="initial" animate="in" exit="out" variants={pageVariants} transition={pageTransition}
                    className="w-full min-h-screen"
                >
                    <StudioSpaceView
                        identity={activeIdentity}
                        currentUser={userProfile}
                        onBack={() => handleNavigate('home')}
                        onDirect={openIdentityDirect}
                    />
                </motion.div>
            )}

          </AnimatePresence>
      </main>

      {!activeChat && currentView !== 'ecosystem' && currentView !== 'stage' && currentView !== 'profile-editor' && (
          <BottomNav
            currentView={currentView}
            onNavigate={handleNavigate}
            theme={navTheme}
            isEditMode={false}
            onEditNav={() => setShowNavConfig(true)}
          />
      )}
    </div>
  );
}

export default App;
