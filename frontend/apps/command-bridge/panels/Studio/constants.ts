import { WidgetData, DashboardTheme, GalleryItem, UserProfile, Community, PortfolioItem } from './types';

export const INITIAL_PROFILE: UserProfile = {
  name: 'Owner',
  role: 'Builder / Operator',
  bio: 'Building SOMA as an AI-first command bridge, trading lab, creative engine, and personal operating layer.',
  manifesto: 'Build useful systems. Help people. Make the work real.',
  avatar: '',
  location: '',
  timezone: 'America/New_York',
  coverImage: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=1000&auto=format&fit=crop'
};

export const MOCK_GALLERY: GalleryItem[] = [];

export const MOCK_PORTFOLIO: PortfolioItem[] = [
  {
    id: 'soma-command-bridge',
    title: 'SOMA Command Bridge',
    category: 'Engineering',
    description: 'AI-first autonomous operating system. Upload your own work to replace this.',
    year: '2025',
    image: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=1000&q=80',
    tags: ['AI', 'Systems', 'SOMA'],
    stats: { views: 0, likes: 0 }
  }
];

export const THEMES: DashboardTheme[] = [
  { name: 'Void', accent: 'white', bgStyle: 'bg-[#050505]' },
  { name: 'Midnight', accent: 'indigo', bgStyle: 'bg-neutral-950' },
  { name: 'Nebula', accent: 'purple', bgStyle: 'bg-slate-900' },
  { name: 'Carbon', accent: 'emerald', bgStyle: 'bg-zinc-950' },
];

export const MOCK_COMMUNITIES: Community[] = [];

export const INITIAL_WIDGETS: WidgetData[] = [
  {
    id: 'w-profile',
    type: 'PROFILE',
    title: 'User',
    colSpan: 1,
    rowSpan: 2,
    content: {}
  },
  {
    id: 'w-art',
    type: 'ART_DISPLAY',
    title: 'Featured',
    colSpan: 2,
    rowSpan: 1,
  },
  {
    id: 'w-stats',
    type: 'STATS',
    title: 'Elite 8',
    colSpan: 1,
    rowSpan: 2,
  },
  {
    id: 'w-ecosystem',
    type: 'ECOSYSTEM',
    title: 'Apps',
    colSpan: 1,
    rowSpan: 1,
  },
  {
    id: 'w-social-activity',
    type: 'SOCIAL_ACTIVITY',
    title: 'SOMA Social',
    colSpan: 1,
    rowSpan: 1,
  },
  {
    id: 'w-signal',
    type: 'SIGNAL',
    title: 'Status',
    colSpan: 1,
    rowSpan: 1,
  },
  {
    id: 'w-hub',
    type: 'HUB_FEED',
    title: 'Activity',
    colSpan: 1,
    rowSpan: 2,
    content: {}
  },
  {
    id: 'w-gallery',
    type: 'GALLERY',
    title: 'Directs',
    colSpan: 2,
    rowSpan: 2,
    content: {}
  },
];
