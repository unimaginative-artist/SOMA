import * as React from 'react';
import { WidgetData } from '../../types';
import { Eye, ArrowUpRight } from 'lucide-react';

interface Props {
    data: WidgetData;
}

const MetricsWidget: React.FC<Props> = ({ data }) => {
  return (
    <div className="w-full h-full flex flex-col justify-between p-8 bg-[#0A0A0A] rounded-3xl border border-white/5 group relative overflow-hidden">
        
         {/* Decorative Gradient Blob */}
         <div className="absolute -top-20 -right-20 w-40 h-40 bg-pink-500/20 rounded-full blur-[50px] group-hover:bg-pink-500/30 transition-colors duration-500" />

         <div className="flex justify-between items-start z-10">
             <div className="flex flex-col">
                 <h3 className="text-sm font-bold text-white/40 uppercase tracking-widest mb-2 flex items-center gap-2">
                    <Eye size={14} /> Total Reach
                 </h3>
                 <div className="text-5xl font-sans font-bold text-white tracking-tighter">
                    842.9k
                 </div>
             </div>
             
             <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center border border-white/10 group-hover:bg-white group-hover:text-black transition-all duration-300">
                <ArrowUpRight size={20} />
             </div>
         </div>

         <div className="z-10 mt-4">
             <div className="flex items-end gap-2 mb-1">
                <span className="text-green-400 text-lg font-bold">+24.5%</span>
                <span className="text-white/30 text-xs font-medium mb-1">past 30 days</span>
             </div>
             <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden mt-4">
                <div className="h-full bg-gradient-to-r from-pink-500 to-purple-500 w-[85%] rounded-full" />
             </div>
         </div>
    </div>
  );
};

export default MetricsWidget;