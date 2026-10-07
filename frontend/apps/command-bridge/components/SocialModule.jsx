import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Brain,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  FolderPlus,
  Gamepad2,
  Image,
  MessageSquareReply,
  Orbit,
  Radio,
  Send,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Tv,
  Users,
  Plus,
  X,
} from 'lucide-react';
import { jsonRequest } from '../utils/jsonRequest';

const fmtTime = (value) => {
  if (!value) return 'pending';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'pending';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const fmtAge = (value) => {
  if (!value) return 'no signal';
  const delta = Date.now() - Number(value);
  if (delta < 0) return fmtTime(value);
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const statusClass = (active) =>
  active
    ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
    : 'border-zinc-700 bg-zinc-900/70 text-zinc-500';

const platformAccent = {
  bluesky: 'from-sky-500/25 to-cyan-400/10 border-sky-400/25 text-sky-200',
  x: 'from-zinc-500/20 to-zinc-800/30 border-zinc-500/25 text-zinc-200',
  linkedin: 'from-blue-500/20 to-indigo-500/10 border-blue-400/25 text-blue-200',
  discord: 'from-indigo-500/25 to-violet-500/10 border-indigo-400/25 text-indigo-200',
  twitch: 'from-purple-500/25 to-fuchsia-500/10 border-purple-400/25 text-purple-200',
};

const queueTone = (item) => {
  if (item.postedAt) return 'border-emerald-400/20 bg-emerald-400/5 text-emerald-300';
  if (item.failed) return 'border-rose-400/25 bg-rose-400/5 text-rose-300';
  if ((item.scheduledFor || 0) <= Date.now()) return 'border-amber-400/25 bg-amber-400/5 text-amber-300';
  return 'border-cyan-400/20 bg-cyan-400/5 text-cyan-300';
};

const SocialModule = ({ isConnected }) => {
  const [cockpit, setCockpit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [composer, setComposer] = useState({
    platform: 'bluesky',
    text: '',
    imagePath: '',
    imageAlt: '',
    mode: 'queue',
  });
  const [composerStatus, setComposerStatus] = useState(null);
  const [storyStatus, setStoryStatus] = useState(null);
  const [storyActionStatus, setStoryActionStatus] = useState(null);
  const [imageLibrary, setImageLibrary] = useState({ imageDir: '', images: [] });
  const [imageForm, setImageForm] = useState({ path: '', alt: '', source: '', license: 'user-provided', tags: '' });
  const [imageStatus, setImageStatus] = useState(null);
  const [discordStatus, setDiscordStatus] = useState(null);

  const loadCockpit = async () => {
    const data = await jsonRequest('/api/social/cockpit');
    setCockpit(data);
    setError(null);
    return data;
  };

  const loadStoryStatus = async () => {
    const data = await jsonRequest('/api/social/stories/status');
    setStoryStatus(data);
    return data;
  };

  const loadImageLibrary = async () => {
    const data = await jsonRequest('/api/social/images');
    setImageLibrary({ imageDir: data.imageDir || '', images: data.images || [] });
    return data;
  };

  useEffect(() => {
    if (!isConnected) return undefined;

    const load = async () => {
      try {
        await Promise.all([
          loadCockpit(),
          loadStoryStatus(),
          loadImageLibrary(),
          loadDiscordBotStatus(),
          loadTwitchBotStatus(),
        ]);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    load();
    const interval = setInterval(load, 12000);
    return () => clearInterval(interval);
  }, [isConnected]);

  const submitComposer = async () => {
    if (!composer.text.trim()) {
      setComposerStatus({ ok: false, message: 'Text is required.' });
      return;
    }
    setComposerStatus({ ok: true, message: composer.mode === 'queue' ? 'Queueing...' : 'Posting...' });
    const body = {
      platform: composer.platform,
      text: composer.text.trim(),
      imagePath: composer.imagePath.trim() || undefined,
      imageAlt: composer.imageAlt.trim() || undefined,
      type: composer.imagePath.trim() ? 'image_post' : 'manual_post',
    };
    try {
      await jsonRequest(composer.mode === 'queue' ? '/api/social/queue' : '/api/social/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setComposerStatus({ ok: true, message: composer.mode === 'queue' ? 'Queued.' : 'Posted.' });
      setComposer(prev => ({ ...prev, text: '', imagePath: '', imageAlt: '' }));
      await loadCockpit();
    } catch (err) {
      setComposerStatus({ ok: false, message: err.message });
    }
  };

  const runStoryAction = async (kind) => {
    setStoryActionStatus({
      ok: true,
      message: kind === 'wattpad'
        ? 'Exporting Wattpad draft...'
        : kind === 'full-chapter'
          ? 'Writing full chapter draft...'
          : kind === 'storyboard'
            ? 'Building writer storyboard...'
            : 'Sending to Reflections...',
    });
    try {
      const endpoint = kind === 'wattpad'
        ? '/api/social/stories/wattpad/export'
        : kind === 'full-chapter'
          ? '/api/social/stories/chapter/full'
          : kind === 'storyboard'
            ? '/api/social/stories/storyboard'
          : '/api/social/stories/reflections/export';
      const data = await jsonRequest(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          kind === 'full-chapter'
            ? { targetWords: 1600, useWriterBoard: true }
            : kind === 'storyboard'
              ? { limit: 5 }
              : { includeChapters: true }
        ),
      });
      setStoryActionStatus({
        ok: true,
        message: kind === 'wattpad'
          ? 'Wattpad draft ready.'
          : kind === 'full-chapter'
            ? `Full chapter ready: ${data.wordCount || 'draft'} words.`
            : kind === 'storyboard'
              ? 'Writer storyboard saved to Reflections.'
            : 'Story added to Reflections.',
      });
      await loadStoryStatus();
    } catch (err) {
      setStoryActionStatus({ ok: false, message: err.message });
    }
  };

  const importImage = async () => {
    if (!imageForm.path.trim()) {
      setImageStatus({ ok: false, message: 'Image path is required.' });
      return;
    }
    setImageStatus({ ok: true, message: 'Importing image...' });
    try {
      await jsonRequest('/api/social/images/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: imageForm.path.trim(),
          alt: imageForm.alt.trim(),
          source: imageForm.source.trim() || undefined,
          license: imageForm.license.trim() || undefined,
          tags: imageForm.tags,
        }),
      });
      setImageStatus({ ok: true, message: 'Image saved to library.' });
      setImageForm(prev => ({ ...prev, path: '', alt: '', source: '', tags: '' }));
      await loadImageLibrary();
    } catch (err) {
      setImageStatus({ ok: false, message: err.message });
    }
  };

  const useLibraryImage = (image) => {
    setComposer(prev => ({
      ...prev,
      imagePath: image.path || '',
      imageAlt: image.alt || prev.imageAlt,
      platform: prev.platform === 'linkedin' ? 'bluesky' : prev.platform,
    }));
    setComposerStatus({ ok: true, message: 'Image attached to composer.' });
  };

  const useImageIdea = (idea) => {
    setComposer(prev => ({
      ...prev,
      platform: prev.platform === 'linkedin' ? 'bluesky' : prev.platform,
      imagePath: idea.path || prev.imagePath,
      imageAlt: idea.alt || prev.imageAlt,
      text: idea.caption || prev.text,
    }));
    setComposerStatus({ ok: true, message: 'Image idea loaded.' });
  };

  const [discordBotStatus, setDiscordBotStatus] = useState(null);
  const [discordBotForm, setDiscordBotForm]     = useState({ token: '', masterId: '', channelId: '', mode: 'general' });
  const [discordBotMsg, setDiscordBotMsg]       = useState(null);

  const loadDiscordBotStatus = async () => {
    try {
      const d = await jsonRequest('/api/social/discord/bot/status');
      setDiscordBotStatus(d);
    } catch {}
  };

  const setupDiscordBot = async () => {
    setDiscordBotMsg({ ok: true, text: 'Connecting...' });
    try {
      const d = await jsonRequest('/api/social/discord/bot/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: discordBotForm.token, masterId: discordBotForm.masterId }),
      });
      setDiscordBotMsg({ ok: true, text: 'Bot connected.' });
      await loadDiscordBotStatus();
    } catch (e) { setDiscordBotMsg({ ok: false, text: e.message }); }
  };

  const monitorChannel = async (enable) => {
    if (!discordBotForm.channelId.trim()) return;
    try {
      await jsonRequest('/api/social/discord/bot/monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: discordBotForm.channelId.trim(), enable }),
      });
      setDiscordBotMsg({ ok: true, text: enable ? 'Channel monitored.' : 'Channel removed.' });
      await loadDiscordBotStatus();
    } catch (e) { setDiscordBotMsg({ ok: false, text: e.message }); }
  };

  const setDiscordChannelMode = async () => {
    if (!discordBotForm.channelId.trim()) return;
    try {
      const d = await jsonRequest('/api/social/discord/bot/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: discordBotForm.channelId.trim(), mode: discordBotForm.mode }),
      });
      setDiscordBotMsg({ ok: true, text: `Mode set to ${d.mode?.label || discordBotForm.mode}.` });
      await loadDiscordBotStatus();
    } catch (e) { setDiscordBotMsg({ ok: false, text: e.message }); }
  };

  const simulateDiscordReply = async () => {
    setDiscordStatus({ ok: true, message: 'Simulating Discord reply...' });
    try {
      await jsonRequest('/api/social/discord/simulate-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'soma-lab',
          author: 'discord-demo',
          inboundText: 'SOMA, what are you refining today?',
          responseText: 'I am refining the social cockpit so Discord replies become visible evidence, not invisible background work.',
        }),
      });
      setDiscordStatus({ ok: true, message: 'Discord reply captured.' });
      await loadCockpit();
    } catch (err) {
      setDiscordStatus({ ok: false, message: err.message });
    }
  };

  const [twitchBotStatus, setTwitchBotStatus]   = useState(null);
  const [twitchBotForm, setTwitchBotForm]       = useState({ botUsername: 'SomaAI', oauthToken: '', channels: 'owner' });
  const [twitchBotMsg, setTwitchBotMsg]         = useState(null);
  const [simulateTwitchText, setSimulateTwitchText] = useState('!soma are you ready for stream?');
  const [copiedOverlay, setCopiedOverlay]       = useState(false);
  const [twitchBusy, setTwitchBusy]             = useState(false);
  const [twitchPilotChannel, setTwitchPilotChannel] = useState('');
  const [twitchPilotConsent, setTwitchPilotConsent] = useState(false);
  const [quickChannelInput, setQuickChannelInput]   = useState('');
  const [channelActionMsg, setChannelActionMsg]     = useState(null);

  const joinTwitchChannel = async (channelToJoin) => {
    const target = (channelToJoin || quickChannelInput).trim().replace(/^#/, '');
    if (!target) return;
    if (twitchBusy) return;
    setTwitchBusy(true);
    setChannelActionMsg({ ok: true, text: `Connecting SOMA to #${target}...` });
    try {
      const res = await jsonRequest('/api/social/twitch/bot/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: target }),
      });
      setChannelActionMsg({ ok: true, text: `Connected to #${target}! SOMA is listening in chat.` });
      setQuickChannelInput('');
      if (res.status) setTwitchBotStatus(res.status);
      else await loadTwitchBotStatus();
      await loadCockpit();
    } catch (err) {
      setChannelActionMsg({ ok: false, text: err.message });
    } finally {
      setTwitchBusy(false);
    }
  };

  const partTwitchChannel = async (channelToLeave) => {
    const clean = (channelToLeave || '').trim().replace(/^#/, '');
    if (!clean) return;
    if (twitchBusy) return;
    setTwitchBusy(true);
    setChannelActionMsg({ ok: true, text: `Disconnecting from #${clean}...` });
    try {
      const res = await jsonRequest('/api/social/twitch/bot/part', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: clean }),
      });
      setChannelActionMsg({ ok: true, text: `Disconnected from #${clean}.` });
      if (res.status) setTwitchBotStatus(res.status);
      else await loadTwitchBotStatus();
      await loadCockpit();
    } catch (err) {
      setChannelActionMsg({ ok: false, text: err.message });
    } finally {
      setTwitchBusy(false);
    }
  };

  const updateTwitchPilot = async (revokeChannel = null) => {
    if (twitchBusy) return;
    setTwitchBusy(true);
    try {
      await jsonRequest(`/api/social/twitch/pilot/${revokeChannel ? 'revoke' : 'invite'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(revokeChannel ? { channel: revokeChannel } : {
          channel: twitchPilotChannel, consentConfirmed: twitchPilotConsent, days: 7, dailyLimit: 100
        })
      });
      setTwitchBotMsg({ ok: true, text: revokeChannel ? 'Pilot access revoked. In-flight replies are blocked.' : 'Seven-day pilot invite saved. Add the channel in connection setup to join it. Billing is disabled.' });
      setTwitchPilotChannel(''); setTwitchPilotConsent(false);
      await loadTwitchBotStatus();
    } catch (error) { setTwitchBotMsg({ ok: false, text: error.message }); }
    finally { setTwitchBusy(false); }
  };

  const loadTwitchBotStatus = async () => {
    try {
      const d = await jsonRequest('/api/social/twitch/bot/status');
      setTwitchBotStatus(d);
      if (d.botUsername) {
        setTwitchBotForm(p => ({
          ...p,
          botUsername: d.botUsername || p.botUsername,
          channels: Array.isArray(d.channels) ? d.channels.join(', ') : (d.channels || p.channels)
        }));
      }
    } catch (err) { setTwitchBotMsg({ ok: false, text: err.message }); }
  };

  const setupTwitchBot = async () => {
    if (twitchBusy) return;
    setTwitchBusy(true);
    setTwitchBotMsg({ ok: true, text: 'Connecting to Twitch...' });
    try {
      const d = await jsonRequest('/api/social/twitch/bot/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botUsername: twitchBotForm.botUsername,
          ...(twitchBotForm.oauthToken.trim() ? { oauthToken: twitchBotForm.oauthToken.trim() } : {}),
          channels: twitchBotForm.channels
        }),
      });
      setTwitchBotMsg({ ok: true, text: d.connected ? 'Connected to Twitch. UI token is session-only.' : `Twitch state: ${d.state || 'unknown'}. No live connection confirmed.` });
      setTwitchBotStatus(d);
      await loadCockpit();
    } catch (e) { setTwitchBotMsg({ ok: false, text: e.message }); }
    finally { setTwitchBotForm(p => ({ ...p, oauthToken: '' })); setTwitchBusy(false); }
  };

  const simulateTwitchReply = async () => {
    if (twitchBusy) return;
    setTwitchBusy(true);
    setTwitchBotMsg({ ok: true, text: 'Generating preview only; nothing will be sent to Twitch.' });
    try {
      const data = await jsonRequest('/api/social/twitch/bot/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: simulateTwitchText, channel: twitchBotStatus?.channels?.[0] || 'owner' }),
      });
      setTwitchBotMsg({ ok: data.result?.success === true, text: data.result?.reply || data.result?.reason || 'No command matched. Try !soma, !bees or !roast.' });
      await loadTwitchBotStatus();
      await loadCockpit();
    } catch (error) { setTwitchBotMsg({ ok: false, text: error.message }); }
    finally { setTwitchBusy(false); }
  };

  const disconnectTwitchBot = async () => {
    if (twitchBusy) return;
    setTwitchBusy(true);
    try {
      const data = await jsonRequest('/api/social/twitch/bot/disconnect', { method: 'POST' });
      setTwitchBotStatus(data);
      setTwitchBotMsg({ ok: true, text: 'Twitch disconnected. This stop survives restart.' });
      await loadCockpit();
    } catch (error) { setTwitchBotMsg({ ok: false, text: error.message }); }
    finally { setTwitchBusy(false); }
  };

  const copyOverlayUrl = async () => {
    const url = new URL(twitchBotStatus?.overlayUrl || '/api/social/twitch/overlay', window.location.origin).href;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedOverlay(true);
      setTimeout(() => setCopiedOverlay(false), 2000);
    } catch { setTwitchBotMsg({ ok: false, text: `Copy this OBS URL manually: ${url}` }); }
  };

  const leaderboard = useMemo(() => {
    const scores = cockpit?.growth?.scores || {};
    return Object.entries(scores)
      .map(([type, score]) => ({ type, ...score }))
      .sort((a, b) => (b.avgScore || 0) - (a.avgScore || 0))
      .slice(0, 6);
  }, [cockpit]);

  const patternPrefs = cockpit?.patterns?.strategy?.preferredFeatures || [];
  const patternAvoids = cockpit?.patterns?.strategy?.avoidedFeatures || [];
  const patternGuidance = cockpit?.patterns?.strategy?.guidance || [];

  const queueItems = cockpit?.queue?.items || [];
  const platforms = cockpit?.platforms || {};
  const daemons = cockpit?.daemons || {};
  const engagement = cockpit?.engagement || {};
  const interactions = engagement.interactions || [];
  const proactive = engagement.proactive || {};
  const socialMemory = cockpit?.socialMemory || {};
  const missions = socialMemory.missions || [];
  const topTopics = socialMemory.topTopics || [];
  const topProfiles = socialMemory.topProfiles || [];
  const imageIdeas = socialMemory.imageIdeas || [];
  const socialInbox = socialMemory.inbox || [];
  const discord = cockpit?.discord || {};
  const discordReplies = discord.replies || [];
  const discordConversations = discord.conversations || [];
  const story = storyStatus?.currentStory;
  const writerBoard = storyStatus?.research?.latestStoryboard;

  if (!isConnected) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Users className="mx-auto mb-4 h-16 w-16 text-zinc-600" />
          <p className="text-zinc-500">Waiting for connection...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto custom-scrollbar p-6 space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="flex items-center text-2xl font-bold text-white">
            <Radio className="mr-3 h-7 w-7 text-cyan-300" />
            SOMA Social
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Autonomous public presence, learning loop, queue, replies, and growth memory.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {Object.entries(daemons).map(([key, daemon]) => (
            <div
              key={key}
              className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${statusClass(daemon.active)}`}
            >
              {key}: {daemon.active ? 'active' : daemon.loaded ? 'idle' : 'missing'}
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}

      {loading && !cockpit ? (
        <div className="rounded-lg border border-white/10 bg-zinc-900/60 p-6 text-sm text-zinc-400">
          Loading social cockpit...
        </div>
      ) : (
        <>
          <section className="rounded-lg border border-white/10 bg-zinc-950/60 p-5">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h3 className="flex items-center text-lg font-bold text-white">
                  <Image className="mr-2 h-5 w-5 text-cyan-300" />
                  Social Composer
                </h3>
                <p className="mt-1 text-xs text-zinc-500">
                  Queue or post text with an optional local image path. Bluesky and X support images.
                </p>
              </div>
              {composerStatus && (
                <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${composerStatus.ok ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300' : 'border-rose-400/25 bg-rose-400/10 text-rose-300'}`}>
                  {composerStatus.message}
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[160px_160px_1fr]">
              <select
                value={composer.platform}
                onChange={(e) => setComposer(prev => ({ ...prev, platform: e.target.value }))}
                className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-400/40"
              >
                <option value="bluesky">Bluesky</option>
                <option value="x">X</option>
                <option value="linkedin">LinkedIn</option>
              </select>
              <select
                value={composer.mode}
                onChange={(e) => setComposer(prev => ({ ...prev, mode: e.target.value }))}
                className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-400/40"
              >
                <option value="queue">Queue</option>
                <option value="post">Post now</option>
              </select>
              <input
                value={composer.imagePath}
                onChange={(e) => setComposer(prev => ({ ...prev, imagePath: e.target.value }))}
                placeholder="Optional local image path, e.g. C:\\Users\\owner\\Pictures\\soma.png"
                className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-400/40"
              />
            </div>
            <textarea
              value={composer.text}
              onChange={(e) => setComposer(prev => ({ ...prev, text: e.target.value }))}
              placeholder="SOMA's post text..."
              rows={3}
              className="mt-3 w-full resize-none rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-400/40"
            />
            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto]">
              <input
                value={composer.imageAlt}
                onChange={(e) => setComposer(prev => ({ ...prev, imageAlt: e.target.value }))}
                placeholder="Optional image alt text"
                className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-400/40"
              />
              <button
                type="button"
                onClick={submitComposer}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-4 py-2 text-sm font-bold text-cyan-100 hover:bg-cyan-400/20"
              >
                <Send className="h-4 w-4" />
                {composer.mode === 'queue' ? 'Queue Post' : 'Post Now'}
              </button>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
            <section className="rounded-lg border border-white/10 bg-zinc-950/60 p-5">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h3 className="flex items-center text-lg font-bold text-white">
                    <FolderPlus className="mr-2 h-5 w-5 text-cyan-300" />
                    Image Library
                  </h3>
                  <p className="mt-1 text-xs text-zinc-500">
                    Managed images live in SOMA/social-media/images and keep alt/source metadata.
                  </p>
                </div>
                {imageStatus && (
                  <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${imageStatus.ok ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300' : 'border-rose-400/25 bg-rose-400/10 text-rose-300'}`}>
                    {imageStatus.message}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto]">
                <input
                  value={imageForm.path}
                  onChange={(e) => setImageForm(prev => ({ ...prev, path: e.target.value }))}
                  placeholder="Local image path to import"
                  className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-400/40"
                />
                <button
                  type="button"
                  onClick={importImage}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-4 py-2 text-sm font-bold text-cyan-100 hover:bg-cyan-400/20"
                >
                  <FolderPlus className="h-4 w-4" />
                  Import
                </button>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
                <input
                  value={imageForm.alt}
                  onChange={(e) => setImageForm(prev => ({ ...prev, alt: e.target.value }))}
                  placeholder="Alt text"
                  className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-400/40"
                />
                <input
                  value={imageForm.source}
                  onChange={(e) => setImageForm(prev => ({ ...prev, source: e.target.value }))}
                  placeholder="Source / credit"
                  className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-400/40"
                />
                <input
                  value={imageForm.tags}
                  onChange={(e) => setImageForm(prev => ({ ...prev, tags: e.target.value }))}
                  placeholder="Tags, comma separated"
                  className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-400/40"
                />
              </div>
              <div className="mt-4 max-h-48 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                {imageLibrary.images.length ? imageLibrary.images.slice(0, 8).map(image => (
                  <button
                    key={image.id}
                    type="button"
                    onClick={() => useLibraryImage(image)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-left hover:border-cyan-400/25 hover:bg-cyan-400/10"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-zinc-100">{image.filename}</p>
                      <p className="truncate font-mono text-[10px] text-zinc-500">{image.path}</p>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-bold uppercase text-zinc-400">
                      Use
                    </span>
                  </button>
                )) : (
                  <div className="rounded-lg border border-white/10 bg-black/25 p-4 text-sm text-zinc-500">
                    No managed images yet. Import one from a local path, then attach it to Bluesky or X.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-white/10 bg-zinc-950/60 p-5">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h3 className="flex items-center text-lg font-bold text-white">
                    <BookOpen className="mr-2 h-5 w-5 text-fuchsia-300" />
                    Story Workspace
                  </h3>
                  <p className="mt-1 text-xs text-zinc-500">
                    Export SOMA fiction to readable Reflections notes or Wattpad-ready drafts.
                  </p>
                </div>
                {storyActionStatus && (
                  <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${storyActionStatus.ok ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300' : 'border-rose-400/25 bg-rose-400/10 text-rose-300'}`}>
                    {storyActionStatus.message}
                  </span>
                )}
              </div>
              {story ? (
                <div className="rounded-lg border border-white/10 bg-black/25 p-4">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-base font-bold text-white">{story.title || 'Untitled story'}</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {story.genre || 'fiction'} · {story.chapters || 0} chapters · {story.fullChapters || 0} full drafts
                      </p>
                      {writerBoard && (
                        <p className="mt-1 truncate text-[11px] text-fuchsia-200/80">
                          Board: {writerBoard.title || 'Writer storyboard'}
                        </p>
                      )}
                    </div>
                    <span className="rounded-full border border-fuchsia-400/20 bg-fuchsia-400/10 px-2 py-1 text-[10px] font-bold uppercase text-fuchsia-200">
                      Draft
                    </span>
                  </div>
                  {story.arc && <p className="line-clamp-3 text-sm leading-relaxed text-zinc-300">{story.arc}</p>}
                  {writerBoard?.structurePlan && (
                    <div className="mt-3 rounded-lg border border-emerald-400/15 bg-emerald-400/5 p-3">
                      <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-emerald-200">Structure Stack</div>
                      <p className="line-clamp-3 text-xs leading-relaxed text-zinc-300">{writerBoard.structurePlan}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-white/10 bg-black/25 p-4 text-sm text-zinc-500">
                  No Aurora story memory was found yet.
                </div>
              )}
              <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-4">
                <button
                  type="button"
                  onClick={() => runStoryAction('storyboard')}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-4 py-2 text-sm font-bold text-emerald-100 hover:bg-emerald-400/20"
                >
                  <Brain className="h-4 w-4" />
                  Storyboard
                </button>
                <button
                  type="button"
                  onClick={() => runStoryAction('full-chapter')}
                  disabled={!story}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-400/25 bg-amber-400/10 px-4 py-2 text-sm font-bold text-amber-100 hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Sparkles className="h-4 w-4" />
                  Full Chapter
                </button>
                <button
                  type="button"
                  onClick={() => runStoryAction('reflections')}
                  disabled={!story}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-fuchsia-400/25 bg-fuchsia-400/10 px-4 py-2 text-sm font-bold text-fuchsia-100 hover:bg-fuchsia-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <BookOpen className="h-4 w-4" />
                  To Reflections
                </button>
                <button
                  type="button"
                  onClick={() => runStoryAction('wattpad')}
                  disabled={!story}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-4 py-2 text-sm font-bold text-cyan-100 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Send className="h-4 w-4" />
                  Wattpad Draft
                </button>
              </div>
              {storyStatus?.exports?.length > 0 && (
                <div className="mt-4 space-y-2">
                  {storyStatus.exports.slice(0, 3).map((item, index) => (
                    <div key={`${item.exportedAt}-${index}`} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                      <p className="truncate text-xs font-semibold text-zinc-200">{item.title}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-zinc-500">{fmtAge(item.exportedAt)}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            {Object.entries(platforms).map(([name, platform]) => (
              <div
                key={name}
                className={`rounded-lg border bg-gradient-to-br p-5 ${platformAccent[name] || platformAccent.x}`}
              >
                <div className="mb-5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {name === 'bluesky' ? <Sparkles className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
                    <h3 className="text-sm font-bold uppercase tracking-widest">{name}</h3>
                  </div>
                  <span className={`rounded-full border px-2 py-1 text-[10px] font-bold ${statusClass(platform.configured)}`}>
                    {platform.configured ? 'ready' : 'not wired'}
                  </span>
                </div>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <span className="text-zinc-400">Mode</span>
                    <span className="text-right font-mono text-zinc-100">{platform.mode}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-zinc-400">Post</span>
                    <span className={platform.canPost ? 'text-emerald-300' : 'text-zinc-500'}>
                      {platform.canPost ? 'enabled' : 'blocked'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-zinc-400">Images</span>
                    <span className={platform.canPostImages ? 'text-emerald-300' : 'text-zinc-500'}>
                      {platform.canPostImages ? 'enabled' : 'text only'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-zinc-400">Reply</span>
                    <span className={platform.canReply ? 'text-emerald-300' : 'text-zinc-500'}>
                      {platform.canReply ? 'enabled' : 'blocked'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-zinc-400">Like</span>
                    <span className={platform.canLike ? 'text-emerald-300' : 'text-zinc-500'}>
                      {platform.canLike ? 'enabled' : 'blocked'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <section className="rounded-lg border border-indigo-400/20 bg-gradient-to-br from-indigo-500/10 to-zinc-950/70 p-5">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h3 className="flex items-center text-lg font-bold text-white">
                  <MessageSquareReply className="mr-2 h-5 w-5 text-indigo-300" />
                  Discord View
                </h3>
                <p className="mt-1 text-xs text-zinc-500">
                  Discord-style social replies, channel context, and response evidence. Real bot replies appear here once the Discord bridge is connected.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {discordStatus && (
                  <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${discordStatus.ok ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300' : 'border-rose-400/25 bg-rose-400/10 text-rose-300'}`}>
                    {discordStatus.message}
                  </span>
                )}
                <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${discord.connected ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300' : 'border-indigo-400/25 bg-indigo-400/10 text-indigo-200'}`}>
                  {discord.connected ? 'bridge ready' : 'simulation view'}
                </span>
                <button
                  type="button"
                  onClick={simulateDiscordReply}
                  className="rounded-lg border border-indigo-400/25 bg-indigo-400/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-indigo-100 hover:bg-indigo-400/20"
                >
                  Test Reply
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.8fr_1.2fr]">
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {[
                    ['channels', discord.stats?.conversations || 0],
                    ['replies', discord.stats?.replies || 0],
                    ['real', discord.stats?.posted || 0],
                    ['failed', discord.stats?.failed || 0],
                    ['learned', discord.stats?.learned || 0],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-white/10 bg-black/25 p-3 text-center">
                      <div className="font-mono text-lg font-bold text-white">{value}</div>
                      <div className="text-[10px] uppercase tracking-widest text-zinc-500">{label}</div>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border border-white/10 bg-black/25 p-3">
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Channel Threads</div>
                  <div className="max-h-40 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                    {discordConversations.slice(0, 6).map(item => (
                      <div key={item.id} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-semibold text-indigo-100">#{item.channel}</span>
                          <span className="font-mono text-[10px] text-zinc-500">{fmtAge(item.lastSeenAt)}</span>
                        </div>
                        <p className="mt-1 truncate text-[10px] text-zinc-500">@{item.author} · {item.replies || 0} replies</p>
                      </div>
                    ))}
                    {!discordConversations.length && (
                      <div className="rounded-lg border border-white/10 bg-black/25 p-3 text-xs text-zinc-500">
                        No Discord channel activity yet. Use Test Reply to verify the cockpit pipeline.
                      </div>
                    )}
                  </div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/25 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Learning Notes</span>
                    <span className="font-mono text-[10px] text-zinc-600">{discord.stats?.reflected || 0} reflected</span>
                  </div>
                  <div className="max-h-36 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                    {(discord.learning?.lessons || []).slice(0, 4).map(item => (
                      <div key={item.id} className="rounded-lg border border-emerald-400/10 bg-emerald-400/5 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-semibold text-emerald-100">@{item.author}</span>
                          <span className="font-mono text-[10px] text-zinc-500">{fmtAge(item.createdAt)}</span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-zinc-400">{item.summary}</p>
                      </div>
                    ))}
                    {!(discord.learning?.lessons || []).length && (
                      <div className="rounded-lg border border-white/10 bg-black/25 p-3 text-xs text-zinc-500">
                        No distilled Discord lessons yet.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-white/10 bg-black/25 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Recent Discord Replies</span>
                  <span className="font-mono text-[10px] text-zinc-600">{fmtAge(discord.lastCheck)}</span>
                </div>
                <div className="max-h-72 space-y-3 overflow-y-auto pr-1 custom-scrollbar">
                  {discordReplies.slice(0, 8).map(item => (
                    <article key={item.id} className="rounded-lg border border-white/10 bg-white/5 p-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="rounded-full border border-indigo-400/20 bg-indigo-400/10 px-2 py-0.5 text-[10px] font-bold uppercase text-indigo-200">#{item.channel}</span>
                          <span className="truncate text-xs font-semibold text-zinc-200">@{item.author}</span>
                          <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                            item.simulated
                              ? 'border-zinc-500/30 bg-zinc-500/10 text-zinc-400'
                              : item.status === 'failed'
                                ? 'border-rose-400/25 bg-rose-400/10 text-rose-300'
                                : 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300'
                          }`}>
                            {item.simulated ? 'test' : item.status || 'posted'}
                          </span>
                        </div>
                        <span className="font-mono text-[10px] text-zinc-500">{fmtAge(item.createdAt)}</span>
                      </div>
                      <div className="rounded-md border border-white/5 bg-black/25 px-2 py-1.5">
                        <div className="mb-1 text-[9px] font-bold uppercase tracking-widest text-zinc-600">Inbound</div>
                        <p className="line-clamp-2 text-xs leading-relaxed text-zinc-400">{item.inboundText}</p>
                      </div>
                      <div className="mt-2 rounded-md border border-indigo-400/15 bg-indigo-400/5 px-2 py-1.5">
                        <div className="mb-1 text-[9px] font-bold uppercase tracking-widest text-indigo-300">SOMA Reply</div>
                        <p className="line-clamp-3 text-xs leading-relaxed text-zinc-200">{item.responseText}</p>
                      </div>
                    </article>
                  ))}
                  {!discordReplies.length && (
                    <div className="rounded-lg border border-white/10 bg-black/25 p-4 text-sm text-zinc-500">
                      No Discord replies recorded yet.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Discord Bot Setup */}
            <div className="mt-4 rounded-lg border border-indigo-400/20 bg-indigo-400/5 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <span className="text-sm font-bold text-indigo-100">Bot Configuration</span>
                  <p className="mt-0.5 text-[10px] text-zinc-500">Connect a real Discord bot to enable live replies and channel monitoring.</p>
                </div>
                {discordBotStatus?.online && (
                  <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-300">Bot Online</span>
                )}
                {discordBotStatus && !discordBotStatus.online && (
                  <span className="rounded-full border border-zinc-600/50 bg-zinc-800/50 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Bot Offline</span>
                )}
                {!discordBotStatus && (
                  <button type="button" onClick={loadDiscordBotStatus} className="rounded-lg border border-indigo-400/25 bg-indigo-400/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-indigo-100 hover:bg-indigo-400/20">
                    Check Status
                  </button>
                )}
              </div>
              {discordBotStatus?.guilds && (
                <div className="mb-3 flex flex-wrap gap-4 text-[10px] text-zinc-400">
                  <span>Guilds: <strong className="text-white">{discordBotStatus.guilds}</strong></span>
                  <span>Channels: <strong className="text-white">{discordBotStatus.channels?.length || 0}</strong></span>
                  {discordBotStatus.channels?.slice(0, 3).map(ch => (
                    <span key={ch.id || ch} className="font-mono text-indigo-300">#{ch.name || ch}</span>
                  ))}
                </div>
              )}
              {discordBotStatus?.lastError && (
                <div className="mb-3 rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">
                  Discord connection error: {discordBotStatus.lastError}
                </div>
              )}
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                <input
                  type="password"
                  placeholder="Bot token (from Discord Developer Portal)"
                  value={discordBotForm.token}
                  onChange={e => setDiscordBotForm(p => ({ ...p, token: e.target.value }))}
                  className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-indigo-400/40"
                />
                <input
                  type="text"
                  placeholder="Master user ID (your Discord user ID)"
                  value={discordBotForm.masterId}
                  onChange={e => setDiscordBotForm(p => ({ ...p, masterId: e.target.value }))}
                  className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-indigo-400/40"
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" onClick={setupDiscordBot} className="rounded-lg border border-indigo-400/30 bg-indigo-500/20 px-4 py-1.5 text-xs font-bold text-indigo-100 hover:bg-indigo-500/30">
                  Connect Bot
                </button>
                <input
                  type="text"
                  placeholder="Channel ID to monitor"
                  value={discordBotForm.channelId}
                  onChange={e => setDiscordBotForm(p => ({ ...p, channelId: e.target.value }))}
                  className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-indigo-400/40"
                />
                <button type="button" onClick={() => monitorChannel(true)} className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5 text-xs font-bold text-emerald-100 hover:bg-emerald-400/20">Monitor</button>
                <button type="button" onClick={() => monitorChannel(false)} className="rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-1.5 text-xs font-bold text-rose-200 hover:bg-rose-400/20">Remove</button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  value={discordBotForm.mode}
                  onChange={e => setDiscordBotForm(p => ({ ...p, mode: e.target.value }))}
                  className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-indigo-400/40"
                >
                  <option value="general">General</option>
                  <option value="bots-commands">Bots / Commands</option>
                  <option value="creative">Creative</option>
                  <option value="markets">Markets</option>
                  <option value="medical">Medical / Research</option>
                </select>
                <button type="button" onClick={setDiscordChannelMode} className="rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-3 py-1.5 text-xs font-bold text-cyan-100 hover:bg-cyan-400/20">Set Mode</button>
                {discordBotStatus?.channelModes && Object.keys(discordBotStatus.channelModes).length > 0 && (
                  <span className="text-[10px] text-zinc-500">{Object.keys(discordBotStatus.channelModes).length} channel mode{Object.keys(discordBotStatus.channelModes).length === 1 ? '' : 's'} saved</span>
                )}
              </div>
              {discordBotMsg && (
                <p className={`mt-2 text-xs font-semibold ${discordBotMsg.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{discordBotMsg.text}</p>
              )}
            </div>
          </section>

          {/* Twitch Stream Guardian Section */}
          <section className="rounded-lg border border-purple-400/20 bg-zinc-950/60 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="flex items-center text-lg font-bold text-white">
                  <Tv className="mr-2 h-5 w-5 text-purple-400" />
                  Twitch Stream Guardian &amp; Co-Host
                </h3>
                <p className="mt-1 text-xs text-zinc-500">
                  Public-chat co-host with guarded replies, read-only bee telemetry, and multi-channel chat. Not an autonomous moderation or trading controller.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {twitchBotStatus?.connected ? (
                  <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-300">
                    IRC connected · {twitchBotStatus.joinedChannels?.length || 0} channels joined
                  </span>
                ) : twitchBotStatus?.configured ? (
                  <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-300">
                    {twitchBotStatus?.state || 'Offline'} (Token configured)
                  </span>
                ) : (
                  <span className="rounded-full border border-purple-400/25 bg-purple-400/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-purple-200">
                    Standby / Simulation
                  </span>
                )}
                <button
                  type="button"
                  onClick={copyOverlayUrl}
                  className="flex items-center gap-1.5 rounded-lg border border-purple-400/30 bg-purple-500/15 px-3 py-1 text-xs font-semibold text-purple-200 hover:bg-purple-500/25"
                  title="Copy OBS Browser Source URL"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {copiedOverlay ? 'Copied!' : 'Copy OBS Overlay URL'}
                </button>
                <a
                  href="/api/gmn/site/somastreams.gmn"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/10"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  somastreams.gmn
                </a>
              </div>
            </div>

            {/* Quick Channel Connect & Active Stream Channels */}
            <div className="mb-4 rounded-xl border border-purple-500/30 bg-gradient-to-r from-purple-950/40 via-zinc-900/60 to-purple-950/20 p-4 shadow-lg shadow-purple-950/20">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/10">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
                    <h4 className="text-sm font-bold text-white tracking-wide">Quick Channel Join</h4>
                    <span className="rounded-full bg-purple-500/20 border border-purple-400/30 px-2 py-0.5 text-[10px] font-semibold text-purple-200">
                      {(twitchBotStatus?.channels || []).length} / 10 Active
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    Enter any Twitch streamer&apos;s channel name to deploy SOMA directly into their chat room.
                  </p>
                </div>

                {/* Quick Join Input & Button */}
                <form
                  onSubmit={(e) => { e.preventDefault(); joinTwitchChannel(); }}
                  className="flex items-center gap-2 w-full sm:w-auto"
                >
                  <div className="relative flex-1 sm:w-64">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-purple-400 font-mono text-xs">#</span>
                    <input
                      type="text"
                      placeholder="streamer_channel"
                      value={quickChannelInput}
                      onChange={(e) => setQuickChannelInput(e.target.value.replace(/^#/, ''))}
                      disabled={twitchBusy}
                      className="w-full rounded-lg border border-purple-400/30 bg-black/60 pl-7 pr-3 py-2 text-xs font-mono text-zinc-100 placeholder-zinc-500 outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-400 transition-all"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={twitchBusy || !quickChannelInput.trim()}
                    className="flex items-center gap-1.5 rounded-lg border border-purple-400/40 bg-purple-600/80 hover:bg-purple-500 px-4 py-2 text-xs font-bold text-white shadow-md shadow-purple-900/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Connect Channel</span>
                  </button>
                </form>
              </div>

              {/* Status / Feedback banner */}
              {channelActionMsg && (
                <div className={`mt-3 flex items-center justify-between rounded-lg px-3 py-2 text-xs font-medium ${
                  channelActionMsg.ok ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300' : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
                }`}>
                  <div className="flex items-center gap-2">
                    {channelActionMsg.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
                    <span>{channelActionMsg.text}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setChannelActionMsg(null)}
                    className="text-zinc-500 hover:text-zinc-300"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {/* Active Joined Channels List */}
              <div className="mt-3">
                <div className="text-[10px] uppercase font-bold tracking-wider text-zinc-400 mb-2">
                  Active Stream Channels
                </div>
                <div className="flex flex-wrap gap-2">
                  {(twitchBotStatus?.channels || []).map((ch) => {
                    const isJoined = (twitchBotStatus?.joinedChannels || []).includes(ch);
                    const isOwner = (twitchBotStatus?.pilot?.ownerChannels || []).includes(ch);
                    return (
                      <div
                        key={ch}
                        className="flex items-center gap-2 rounded-lg border border-purple-400/20 bg-black/40 px-3 py-1.5 text-xs text-zinc-200 shadow-sm transition hover:border-purple-400/40"
                      >
                        <span className={`h-2 w-2 rounded-full ${isJoined ? 'bg-emerald-400 ring-2 ring-emerald-400/20' : 'bg-amber-400'}`} title={isJoined ? 'IRC Connected' : 'Configured / Connecting'} />
                        <span className="font-mono font-medium text-white">#{ch}</span>
                        {isOwner && (
                          <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-purple-300">
                            Owner
                          </span>
                        )}
                        <a
                          href={`https://twitch.tv/${ch}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-zinc-500 hover:text-purple-300 transition-colors"
                          title={`Open twitch.tv/${ch}`}
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                        <button
                          type="button"
                          onClick={() => partTwitchChannel(ch)}
                          disabled={twitchBusy || (twitchBotStatus?.channels?.length === 1 && !isOwner)}
                          className="ml-1 text-zinc-500 hover:text-rose-400 transition-colors p-0.5 rounded hover:bg-rose-500/10 disabled:opacity-30 disabled:hover:text-zinc-500"
                          title={twitchBotStatus?.channels?.length === 1 ? 'Use Disconnect to leave the last channel' : `Part channel #${ch}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                  {!(twitchBotStatus?.channels || []).length && (
                    <span className="text-xs text-zinc-500 italic py-1">
                      No channels configured. Type a channel name above and click &quot;Connect Channel&quot;.
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Metrics Ticker */}
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg border border-white/5 bg-black/30 p-2.5 text-center">
                <span className="block text-[10px] uppercase font-bold text-zinc-500">Total Summons</span>
                <span className="text-base font-bold text-purple-300">{twitchBotStatus?.stats?.totalSummons || 0}</span>
              </div>
              <div className="rounded-lg border border-white/5 bg-black/30 p-2.5 text-center">
                <span className="block text-[10px] uppercase font-bold text-zinc-500">Roasts Delivered</span>
                <span className="text-base font-bold text-fuchsia-300">{twitchBotStatus?.stats?.roastsDelivered || 0}</span>
              </div>
              <div className="rounded-lg border border-white/5 bg-black/30 p-2.5 text-center">
                <span className="block text-[10px] uppercase font-bold text-zinc-500">Patterns Blocked</span>
                <span className="text-base font-bold text-emerald-300">{twitchBotStatus?.stats?.injectionsBlocked || 0}</span>
              </div>
              <div className="rounded-lg border border-white/5 bg-black/30 p-2.5 text-center">
                <span className="block text-[10px] uppercase font-bold text-zinc-500">🐝 Bee Checks</span>
                <span className="text-base font-bold text-amber-300">{twitchBotStatus?.stats?.beesQueried || 0}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Twitch Bot Setup Form */}
              <div className="rounded-lg border border-white/10 bg-black/25 p-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-purple-300">Bot Connection Setup</h4>
                <p className="mt-0.5 text-[10px] text-zinc-500">Use this computer’s localhost cockpit. Tokens need chat:read + chat:edit for the same username. UI tokens are session-only; use TWITCH_OAUTH_TOKEN in the local environment to survive restart. Channels and disconnect state are saved without credentials.</p>
                <div className="mt-3 space-y-2">
                  <div>
                    <label className="block text-[10px] uppercase text-zinc-400 font-semibold mb-1">Bot Username</label>
                    <input
                      type="text"
                      placeholder="e.g. SomaAI"
                      value={twitchBotForm.botUsername}
                      onChange={e => setTwitchBotForm(p => ({ ...p, botUsername: e.target.value }))}
                      className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-purple-400/40"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase text-zinc-400 font-semibold mb-1">OAuth Token</label>
                    <input
                      type="password"
                      placeholder="User OAuth token (blank keeps current token)"
                      autoComplete="off"
                      value={twitchBotForm.oauthToken}
                      onChange={e => setTwitchBotForm(p => ({ ...p, oauthToken: e.target.value }))}
                      className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-purple-400/40"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase text-zinc-400 font-semibold mb-1">Channels (comma-separated)</label>
                    <input
                      type="text"
                      placeholder="e.g. owner, friend_streamer"
                      value={twitchBotForm.channels}
                      onChange={e => setTwitchBotForm(p => ({ ...p, channels: e.target.value }))}
                      className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-purple-400/40"
                    />
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={setupTwitchBot}
                    disabled={twitchBusy}
                    className="rounded-lg border border-purple-400/30 bg-purple-500/20 px-4 py-1.5 text-xs font-bold text-purple-100 hover:bg-purple-500/30"
                  >
                    Validate &amp; Connect Twitch
                  </button>
                  <button type="button" onClick={disconnectTwitchBot} disabled={twitchBusy} className="px-3 py-1.5 text-xs text-zinc-300">Disconnect</button>
                  {twitchBotMsg && (
                    <span className={`text-xs font-semibold ${twitchBotMsg.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {twitchBotMsg.text}
                    </span>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-amber-400/20 bg-black/25 p-4">
                <h4 className="text-xs font-bold uppercase text-amber-200">Private pilot access · billing disabled</h4>
                <p className="mt-2 text-xs text-zinc-400">Operator-only controls, not a subscriber portal. Seven-day invites allow 100 model attempts per UTC day. Subscriber memory and private trading telemetry are disabled. Do not publish this cockpit or the full SOMA API.</p>
                <p className="mt-2 text-xs text-zinc-500">Owner channels: {(twitchBotStatus?.pilot?.ownerChannels || []).join(', ') || 'unknown'}. Set TWITCH_OWNER_CHANNELS locally if your Twitch channel differs.</p>
                <input aria-label="Pilot Twitch channel" className="mt-3 w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-xs" placeholder="Consenting streamer's channel" value={twitchPilotChannel} onChange={e => setTwitchPilotChannel(e.target.value)} />
                <label className="mt-2 flex items-center gap-2 text-xs text-zinc-400"><input type="checkbox" checked={twitchPilotConsent} onChange={e => setTwitchPilotConsent(e.target.checked)} />The channel owner agreed to this private pilot.</label>
                <button type="button" className="mt-3 rounded border border-amber-400/30 px-3 py-2 text-xs text-amber-200" disabled={twitchBusy || !twitchPilotConsent || !twitchPilotChannel.trim()} onClick={() => updateTwitchPilot()}>Create pilot invite</button>
                <div className="mt-3 space-y-2">
                  {(twitchBotStatus?.pilot?.invites || []).map(invite => <div key={invite.tenantId} className="flex items-center justify-between gap-2 text-xs text-zinc-400">
                    <span>#{invite.channel} · {invite.state} · {invite.attemptsToday}/{invite.dailyLimit} today · expires {new Date(invite.expiresAt).toLocaleString()}</span>
                    <button type="button" disabled={twitchBusy || invite.state === 'revoked'} onClick={() => updateTwitchPilot(invite.channel)} className="text-rose-300">Revoke</button>
                  </div>)}
                </div>
              </div>

              {/* Simulation & Live Feed */}
              <div className="rounded-lg border border-white/10 bg-black/25 p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-purple-300">Live Chat &amp; Roast Feed</h4>
                    <span className="font-mono text-[10px] text-zinc-500">Recent Stream Turns</span>
                  </div>
                  <div className="mt-2 max-h-48 overflow-y-auto space-y-1.5 pr-1">
                    {(twitchBotStatus?.recentInteractions || []).slice(0, 6).map((item) => (
                      <div key={item.id} className="rounded border border-white/5 bg-black/40 p-2 text-xs">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="font-semibold text-purple-300">@{item.username} in #{item.channel}</span>
                          <span className="font-mono text-zinc-500">{item.simulated ? 'PREVIEW' : item.delivery?.status || 'unverified'} · {fmtAge(item.timestamp)}</span>
                        </div>
                        <p className="mt-1 text-zinc-400"><strong className="text-zinc-500">Chat:</strong> {item.prompt}</p>
                        <p className="mt-0.5 text-zinc-200"><strong className="text-purple-400">SOMA:</strong> {item.reply}</p>
                      </div>
                    ))}
                    {!(twitchBotStatus?.recentInteractions || []).length && (
                      <p className="py-6 text-center text-xs text-zinc-600">No Twitch stream interactions yet. Use test summon below.</p>
                    )}
                  </div>
                </div>

                {/* Instant Simulation Bar */}
                <div className="mt-3 pt-3 border-t border-white/5 flex gap-2">
                  <input
                    type="text"
                    placeholder="Test command (e.g. !soma who are you? or !roast or !bees)"
                    value={simulateTwitchText}
                    onChange={e => setSimulateTwitchText(e.target.value)}
                    className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1 text-xs text-zinc-100 outline-none focus:border-purple-400/40"
                  />
                  <button
                    type="button"
                    onClick={simulateTwitchReply}
                    disabled={twitchBusy}
                    className="rounded-lg border border-purple-400/30 bg-purple-500/20 px-3 py-1 text-xs font-bold text-purple-200 hover:bg-purple-500/30 shrink-0"
                  >
                    Simulate
                  </button>
                </div>
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_1fr]">
            <section className="rounded-lg border border-white/10 bg-zinc-950/60 p-5">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <h3 className="flex items-center text-lg font-bold text-white">
                    <Orbit className="mr-2 h-5 w-5 text-cyan-300" />
                    Social Strategy Spine
                  </h3>
                  <p className="mt-1 text-xs text-zinc-500">
                    Missions, taste, profiles, and reputation memory driving autonomous engagement.
                  </p>
                </div>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-zinc-400">
                  {fmtAge(socialMemory.updatedAt)}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {missions.slice(0, 4).map(mission => (
                  <div key={mission.id} className="rounded-lg border border-white/10 bg-black/25 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-bold text-zinc-100">{mission.title}</p>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase ${mission.status === 'active' ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300' : 'border-amber-400/25 bg-amber-400/10 text-amber-300'}`}>
                        {mission.status}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-xs leading-relaxed text-zinc-400">{mission.focus}</p>
                    <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">{mission.cadence}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div>
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Interest Graph</div>
                  <div className="flex flex-wrap gap-1.5">
                    {topTopics.slice(0, 10).map(topic => (
                      <span key={topic.topic} className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[10px] text-cyan-100">
                        {topic.topic} · {Math.round(topic.weight || 0)}
                      </span>
                    ))}
                    {!topTopics.length && <span className="text-xs text-zinc-500">Waiting for likes, replies, and comments.</span>}
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Social Profiles</div>
                  <div className="space-y-2">
                    {topProfiles.slice(0, 4).map(profile => (
                      <div key={profile.handle} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-zinc-100">@{profile.handle}</p>
                          <p className="truncate text-[10px] text-zinc-500">{(profile.topTopics || []).map(item => item.topic).join(', ') || 'learning profile'}</p>
                        </div>
                        <span className="font-mono text-xs text-emerald-300">{profile.trust}</span>
                      </div>
                    ))}
                    {!topProfiles.length && <div className="rounded-lg border border-white/10 bg-black/25 p-3 text-xs text-zinc-500">No recurring social profiles yet.</div>}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-white/10 bg-zinc-950/60 p-5">
              <h3 className="mb-4 flex items-center text-lg font-bold text-white">
                <Sparkles className="mr-2 h-5 w-5 text-fuchsia-300" />
                Media + Story Ideas
              </h3>
              <div className="mb-4 rounded-lg border border-fuchsia-400/15 bg-fuchsia-400/5 p-3">
                <div className="text-[10px] font-bold uppercase tracking-widest text-fuchsia-200">Story cadence</div>
                <p className="mt-1 text-sm text-zinc-200">{socialMemory.storyPlan?.nextSuggested || 'Waiting for Aurora story memory.'}</p>
                <p className="mt-2 text-[10px] uppercase tracking-widest text-zinc-500">{socialMemory.storyPlan?.cadence || 'weekly artifact'}</p>
              </div>
              <div className="max-h-56 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                {imageIdeas.slice(0, 5).map(idea => (
                  <button
                    key={idea.imageId || idea.path}
                    type="button"
                    onClick={() => useImageIdea(idea)}
                    className="w-full rounded-lg border border-white/10 bg-black/25 p-3 text-left hover:border-fuchsia-400/25 hover:bg-fuchsia-400/10"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-zinc-100">{idea.filename || 'image idea'}</p>
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase text-zinc-400">Load</span>
                    </div>
                    <p className="line-clamp-2 text-xs leading-relaxed text-zinc-400">{idea.caption}</p>
                  </button>
                ))}
                {!imageIdeas.length && <div className="rounded-lg border border-white/10 bg-black/25 p-3 text-xs text-zinc-500">Import images to generate caption, alt text, and post angles.</div>}
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.45fr_1fr]">
            <section className="rounded-lg border border-white/10 bg-zinc-950/60 p-5">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <h3 className="flex items-center text-lg font-bold text-white">
                    <Send className="mr-2 h-5 w-5 text-cyan-300" />
                    Thought Queue
                  </h3>
                  <p className="mt-1 text-xs text-zinc-500">
                    Fresh signals are harvested, written by Aurora, scheduled, posted, then scored.
                  </p>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  {[
                    ['pending', cockpit?.queue?.pending || 0],
                    ['ready', cockpit?.queue?.ready || 0],
                    ['posted', cockpit?.queue?.posted || 0],
                    ['failed', cockpit?.queue?.failed || 0],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-md border border-white/10 bg-black/30 px-3 py-2">
                      <div className="font-mono text-lg font-bold text-white">{value}</div>
                      <div className="text-[10px] uppercase tracking-widest text-zinc-500">{label}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mb-4 flex items-center justify-between rounded-lg border border-cyan-400/15 bg-cyan-400/5 px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-cyan-200">
                  <Clock className="h-4 w-4" />
                  Next scheduled public thought
                </div>
                <div className="font-mono text-sm text-white">{fmtTime(cockpit?.queue?.nextPostAt)}</div>
              </div>

              <div className="space-y-3">
                {queueItems.length ? queueItems.map((item) => (
                  <article key={item.id} className="rounded-lg border border-white/10 bg-black/25 p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase ${queueTone(item)}`}>
                          {item.postedAt ? 'posted' : item.failed ? 'failed' : (item.scheduledFor || 0) <= Date.now() ? 'ready' : 'scheduled'}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-bold uppercase text-zinc-400">
                          {item.platform}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-bold uppercase text-zinc-400">
                          {item.type}
                        </span>
                      </div>
                      <span className="font-mono text-xs text-zinc-500">
                        {item.postedAt ? fmtAge(item.postedAt) : fmtTime(item.scheduledFor)}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{item.text}</p>
                    {item.images?.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {item.images.map((image, index) => (
                          <span
                            key={`${image.path}-${index}`}
                            className="rounded-md border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 font-mono text-[10px] text-cyan-200"
                            title={image.alt || image.path}
                          >
                            image {index + 1}: {String(image.path).split(/[\\/]/).pop()}
                          </span>
                        ))}
                      </div>
                    )}
                    {item.error && <p className="mt-3 text-xs text-rose-300">{item.error}</p>}
                  </article>
                )) : (
                  <div className="rounded-lg border border-white/10 bg-black/25 p-6 text-sm text-zinc-500">
                    No social queue items yet. SocialIntel will populate this from live research and internal context.
                  </div>
                )}
              </div>
            </section>

            <aside className="space-y-6">
              <section className="rounded-lg border border-white/10 bg-zinc-950/60 p-5">
                <h3 className="mb-4 flex items-center text-lg font-bold text-white">
                  <TrendingUp className="mr-2 h-5 w-5 text-emerald-300" />
                  Engagement Learning
                </h3>
                {leaderboard.length ? (
                  <div className="space-y-3">
                    {leaderboard.map((row, index) => (
                      <div key={row.type} className="rounded-lg border border-white/10 bg-white/5 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-sm font-semibold text-zinc-100">{index + 1}. {row.type}</span>
                          <span className="font-mono text-sm text-emerald-300">{row.avgScore || 0}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                          <div
                            className="h-full rounded-full bg-emerald-400"
                            style={{ width: `${Math.min(100, Math.max(6, (row.avgScore || 0) * 10))}%` }}
                          />
                        </div>
                        <div className="mt-2 flex justify-between text-[10px] uppercase tracking-widest text-zinc-500">
                          <span>{row.posts || 0} scored</span>
                          <span>best {row.bestScore || 0}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-white/10 bg-black/25 p-4 text-sm text-zinc-500">
                    Waiting for posted Bluesky items to mature before scoring.
                  </div>
                )}
              </section>

              <section className="rounded-lg border border-white/10 bg-zinc-950/60 p-5">
                <h3 className="mb-4 flex items-center text-lg font-bold text-white">
                  <Brain className="mr-2 h-5 w-5 text-cyan-300" />
                  Pattern Learner
                </h3>
                <div className="mb-4 grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                    <div className="font-mono text-lg font-bold text-white">{cockpit?.patterns?.samples || 0}</div>
                    <div className="text-[10px] uppercase tracking-widest text-zinc-500">scored samples</div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                    <div className="font-mono text-lg font-bold text-white">{cockpit?.patterns?.averages?.avgScore || 0}</div>
                    <div className="text-[10px] uppercase tracking-widest text-zinc-500">avg style score</div>
                  </div>
                </div>
                <div className="space-y-3">
                  {patternGuidance.slice(0, 3).map((line, index) => (
                    <div key={index} className="rounded-lg border border-cyan-400/15 bg-cyan-400/5 p-3 text-xs leading-relaxed text-cyan-100">
                      {line}
                    </div>
                  ))}
                  <div>
                    <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Leaning Into</div>
                    <div className="flex flex-wrap gap-1.5">
                      {patternPrefs.slice(0, 6).map(item => (
                        <span key={item.feature} className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[10px] text-emerald-200">
                          {item.feature.replace(/_/g, ' ')} · {item.avgScore}
                        </span>
                      ))}
                      {!patternPrefs.length && <span className="text-xs text-zinc-500">Waiting for scored posts.</span>}
                    </div>
                  </div>
                  {patternAvoids.length > 0 && (
                    <div>
                      <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Using Less</div>
                      <div className="flex flex-wrap gap-1.5">
                        {patternAvoids.slice(0, 5).map(item => (
                          <span key={item.feature} className="rounded-full border border-rose-400/20 bg-rose-400/10 px-2 py-1 text-[10px] text-rose-200">
                            {item.feature.replace(/_/g, ' ')} · {item.avgScore}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </section>

              <section className="rounded-lg border border-white/10 bg-zinc-950/60 p-5">
                <h3 className="mb-4 flex items-center text-lg font-bold text-white">
                  <MessageSquareReply className="mr-2 h-5 w-5 text-fuchsia-300" />
                  Reply Memory
                </h3>
                <div className="space-y-3">
                  {['bluesky', 'x', 'linkedin', 'discord'].map((platform) => (
                    <div key={platform} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3">
                      <span className="text-sm font-semibold capitalize text-zinc-200">{platform}</span>
                      <div className="text-right">
                        <div className="font-mono text-sm text-white">{cockpit?.engagement?.seenCounts?.[platform] || 0}</div>
                        <div className="text-[10px] uppercase tracking-widest text-zinc-500">seen</div>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/25 px-4 py-3">
                    <span className="flex items-center gap-2 text-sm text-zinc-300">
                      <Activity className="h-4 w-4 text-cyan-300" />
                      Last engagement sweep
                    </span>
                    <span className="font-mono text-sm text-zinc-100">{fmtAge(cockpit?.engagement?.lastCheck?.all)}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-lg border border-white/10 bg-black/25 p-3">
                      <div className="font-mono text-lg font-bold text-white">{proactive.dailyCount || 0}</div>
                      <div className="text-[10px] uppercase tracking-widest text-zinc-500">comments today</div>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/25 p-3">
                      <div className="font-mono text-lg font-bold text-white">{proactive.dailyLikes || 0}</div>
                      <div className="text-[10px] uppercase tracking-widest text-zinc-500">likes today</div>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/25 p-3">
                      <div className="font-mono text-lg font-bold text-white">{engagement.pendingScores || 0}</div>
                      <div className="text-[10px] uppercase tracking-widest text-zinc-500">learning soon</div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {interactions.slice(0, 4).map(item => (
                      <div key={item.id} className="rounded-lg border border-white/10 bg-white/5 p-3">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-bold uppercase tracking-widest text-fuchsia-200">
                            {item.type?.replace(/_/g, ' ') || 'reply'}
                          </span>
                          <span className="font-mono text-[10px] text-zinc-500">{fmtAge(item.createdAt)}</span>
                        </div>
                        <p className="line-clamp-2 text-xs leading-relaxed text-zinc-300">{item.responseText || item.inboundText || item.status}</p>
                        {item.score !== undefined && (
                          <p className="mt-1 font-mono text-[10px] text-emerald-300">score {item.score}</p>
                        )}
                      </div>
                    ))}
                    {!interactions.length && (
                      <div className="rounded-lg border border-white/10 bg-black/25 p-3 text-xs text-zinc-500">
                        No autonomous replies or proactive comments recorded yet.
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Conversation Inbox</div>
                    {socialInbox.slice(0, 4).map(item => (
                      <div key={item.id} className="rounded-lg border border-white/10 bg-black/25 p-3">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-semibold text-zinc-200">@{item.author || 'unknown'}</span>
                          <span className="font-mono text-[10px] text-zinc-500">{item.status}</span>
                        </div>
                        <p className="line-clamp-2 text-xs leading-relaxed text-zinc-400">{item.summary || item.type}</p>
                        {item.flags?.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {item.flags.slice(0, 2).map(flag => (
                              <span key={flag} className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-200">
                                {flag.replace(/_/g, ' ')}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                    {!socialInbox.length && <div className="rounded-lg border border-white/10 bg-black/25 p-3 text-xs text-zinc-500">No inbox events yet.</div>}
                  </div>
                </div>
              </section>

              <section className="rounded-lg border border-white/10 bg-gradient-to-br from-fuchsia-500/10 to-cyan-500/5 p-5">
                <h3 className="mb-4 flex items-center text-lg font-bold text-white">
                  <Brain className="mr-2 h-5 w-5 text-fuchsia-300" />
                  Social Persona Loop
                </h3>
                <div className="space-y-3 text-sm text-zinc-300">
                  <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/25 px-4 py-3">
                    <span className="flex items-center gap-2"><Orbit className="h-4 w-4 text-cyan-300" /> Harvest</span>
                    <span className="text-zinc-100">research + trends</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/25 px-4 py-3">
                    <span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-fuchsia-300" /> Voice</span>
                    <span className="text-zinc-100">Aurora</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/25 px-4 py-3">
                    <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-300" /> Adapt</span>
                    <span className="text-zinc-100">score winners</span>
                  </div>
                </div>
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  );
};

export default SocialModule;
