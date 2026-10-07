import React, { useState } from 'react';

export const TodoArtifact = ({ initialItems }) => {
  const [items, setItems] = useState(initialItems);

  const toggleComplete = (id) => {
    setItems(prev => prev.map(item => 
      item.id === id ? { ...item, completed: !item.completed } : item
    ));
  };

  const getPriorityBadge = (priority) => {
    switch (priority) {
      case 'high':
        return (
          <div className="flex items-center space-x-1 text-rose-400">
            <span className="text-[10px] font-bold tracking-wider uppercase">!!!</span>
          </div>
        );
      case 'medium':
        return (
          <div className="flex items-center space-x-1 text-amber-400">
            <span className="text-[10px] font-bold tracking-wider uppercase">!!</span>
          </div>
        );
      case 'low':
      default:
        return null;
    }
  };

  if (items.length === 0) {
    return (
        <div className="bg-zinc-900/50 backdrop-blur-md rounded-2xl my-4 border border-white/5 shadow-lg p-6 text-zinc-500 text-center font-medium">
            No active tasks.
        </div>
    );
  }

  const sortedItems = [...items].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      const pMap = { high: 0, medium: 1, low: 2 };
      return pMap[a.priority] - pMap[b.priority];
  });

  return (
    <div className="bg-[#1c1c1e]/90 backdrop-blur-xl rounded-2xl my-4 border border-white/5 shadow-2xl w-full overflow-hidden max-w-md ring-1 ring-black/20">
      <div className="px-5 py-4 bg-white/[0.02] border-b border-white/5 flex justify-between items-center">
        <h3 className="text-sm font-semibold text-zinc-100">
            Tasks
        </h3>
        <span className="text-xs text-zinc-500 font-medium">{items.filter(i => !i.completed).length} Pending</span>
      </div>
      <div className="p-2">
        {sortedItems.map((item) => (
          <div 
            key={item.id} 
            className={`group flex items-start p-3 rounded-xl transition-all duration-200 cursor-pointer select-none ${item.completed ? 'opacity-40 hover:opacity-60' : 'hover:bg-white/5'}`}
            onClick={() => toggleComplete(item.id)}
          >
            <div className={`mt-0.5 w-5 h-5 rounded-full border-[1.5px] flex-shrink-0 flex items-center justify-center mr-3 transition-all duration-200 ${item.completed ? 'bg-zinc-500 border-zinc-500' : 'border-zinc-600 group-hover:border-zinc-400'}`}>
                {item.completed && <div className="w-2.5 h-2.5 bg-black rounded-full" />}
            </div>
            <div className="flex-grow min-w-0 flex flex-col">
                <div className="flex items-baseline justify-between">
                     <span className={`text-sm font-medium leading-snug ${item.completed ? 'text-zinc-500 line-through decoration-zinc-600' : 'text-zinc-200'}`}>
                        {item.text}
                    </span>
                    {getPriorityBadge(item.priority)}
                </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
