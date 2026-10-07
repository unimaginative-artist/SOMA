import * as React from 'react';
import { useState } from 'react';
import { WidgetData } from '../../types';
import { Play, Pause, SkipForward, SkipBack, Disc } from 'lucide-react';

interface Props {
    data: WidgetData;
}

const MediaWidget: React.FC<Props> = ({ data }) => {
  const [playing, setPlaying] = useState(false);

  return (
    <div className="w-full h-full flex flex-col justify-between p-6 bg-gradient-to-br from-white/5 to-transparent relative">
        <div className="flex gap-4 items-center">
            <div className={`w-12 h-12 rounded-full bg-neutral-800 flex items-center justify-center border border-white/10 ${playing ? 'animate-spin-slow' : ''}`}>
                <Disc size={24} className="text-white/40" />
            </div>
            <div>
                <h3 className="text-sm font-bold font-display text-white">Ambient Works 85-92</h3>
                <p className="text-xs text-white/50">Aphex Twin</p>
            </div>
        </div>

        <div className="space-y-4">
            {/* Scrubber */}
            <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-white/60 w-1/3 rounded-full" />
            </div>

            {/* Controls */}
            <div className="flex items-center justify-center gap-6">
                <button className="text-white/50 hover:text-white transition-colors"><SkipBack size={20} /></button>
                <button 
                    onClick={() => setPlaying(!playing)}
                    className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition-transform"
                >
                    {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-1" />}
                </button>
                <button className="text-white/50 hover:text-white transition-colors"><SkipForward size={20} /></button>
            </div>
        </div>
    </div>
  );
};

export default MediaWidget;