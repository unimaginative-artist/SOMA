import React, { useState, useEffect } from 'react';
import { 
  Folder, File, ChevronRight, HardDrive, 
  ArrowUp, Home, Download, Search, RefreshCw,
  FileText, Image, Music, Video, Code
} from 'lucide-react';
import { toast } from 'react-toastify';

const FileIcon = ({ name, isDir }) => {
  if (isDir) return <Folder className="w-5 h-5 text-amber-400" />;
  
  const ext = name.split('.').pop().toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'png':
    case 'gif':
    case 'svg':
      return <Image className="w-5 h-5 text-purple-400" />;
    case 'mp3':
    case 'wav':
    case 'ogg':
      return <Music className="w-5 h-5 text-pink-400" />;
    case 'mp4':
    case 'webm':
      return <Video className="w-5 h-5 text-red-400" />;
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
    case 'json':
    case 'html':
    case 'css':
      return <Code className="w-5 h-5 text-blue-400" />;
    case 'md':
    case 'txt':
      return <FileText className="w-5 h-5 text-zinc-400" />;
    default:
      return <File className="w-5 h-5 text-zinc-500" />;
  }
};

const FileBrowser = () => {
  const [currentPath, setCurrentPath] = useState('./'); // Start at root
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [history, setHistory] = useState(['./']);

  const fetchFiles = async (path) => {
    setLoading(true);
    try {
      // In a real scenario this hits /api/fs/list
      // We will fallback to mock data if backend isn't ready or returns error
      const res = await fetch(`/api/fs/list?path=${encodeURIComponent(path)}`);
      
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
            setItems(data.files);
            return;
        }
      }
      
      // Fallback/Simulated Data for "Soma Memory"
      if (path === './') {
          setItems([
              { name: '.soma', isDirectory: true, size: 0 },
              { name: 'arbiters', isDirectory: true, size: 0 },
              { name: 'cognitive-memory', isDirectory: true, size: 0 },
              { name: 'logs', isDirectory: true, size: 0 },
              { name: 'soma.log', isDirectory: false, size: 10240 },
              { name: 'config.json', isDirectory: false, size: 2048 },
          ]);
      } else if (path.includes('.soma')) {
          setItems([
              { name: 'knowledge_graph.json', isDirectory: false, size: 5048 },
              { name: 'embeddings', isDirectory: true, size: 0 },
              { name: 'checkpoints', isDirectory: true, size: 0 },
          ]);
      } else {
          setItems([]);
      }

    } catch (e) {
      console.error(e);
      toast.error("Failed to read memory banks.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles(currentPath);
  }, [currentPath]);

  const handleNavigate = (name) => {
    const newPath = currentPath.endsWith('/') ? `${currentPath}${name}` : `${currentPath}/${name}`;
    setHistory([...history, newPath]);
    setCurrentPath(newPath);
  };

  const handleUp = () => {
    if (currentPath === './') return;
    const parts = currentPath.split('/');
    parts.pop(); // remove last
    // if it was empty due to trailing slash
    if (parts.length === 0 || (parts.length === 1 && parts[0] === '.')) {
        setCurrentPath('./');
    } else {
        setCurrentPath(parts.join('/'));
    }
  };

  const filteredItems = items.filter(i => i.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="h-full flex flex-col bg-[#09090b]">
      {/* Header */}
      <div className="p-4 border-b border-white/5 flex items-center justify-between bg-[#151518]/50">
        <div className="flex items-center space-x-4 flex-1">
            <div className="flex items-center space-x-2 text-zinc-400">
                <HardDrive className="w-5 h-5" />
                <span className="font-bold text-sm">SOMA_MEM</span>
            </div>
            
            {/* Breadcrumbs */}
            <div className="flex items-center space-x-1 bg-black/30 px-3 py-1.5 rounded-lg border border-white/5 text-xs font-mono text-zinc-300 flex-1 overflow-hidden">
                <span className="text-zinc-500">$</span>
                <span className="truncate">{currentPath}</span>
            </div>
        </div>

        <div className="flex items-center space-x-2 ml-4">
            <div className="relative">
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input 
                    type="text" 
                    placeholder="Filter..." 
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="bg-black/30 border border-white/10 rounded-lg pl-9 pr-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-amber-500/50 w-48"
                />
            </div>
            <button onClick={() => fetchFiles(currentPath)} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
                <RefreshCw className={`w-4 h-4 text-zinc-400 ${loading ? 'animate-spin' : ''}`} />
            </button>
        </div>
      </div>

      {/* File List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        {currentPath !== './' && (
            <div 
                onClick={handleUp}
                className="flex items-center p-2 hover:bg-white/5 rounded-lg cursor-pointer group mb-1"
            >
                <div className="w-8 flex justify-center"><ArrowUp className="w-4 h-4 text-zinc-500 group-hover:text-zinc-300" /></div>
                <span className="text-sm text-zinc-500 font-mono group-hover:text-zinc-300">..</span>
            </div>
        )}

        {filteredItems.map((item, idx) => (
            <div 
                key={idx}
                onClick={() => item.isDirectory ? handleNavigate(item.name) : null}
                className={`flex items-center justify-between p-2 rounded-lg cursor-pointer group transition-colors ${
                    item.isDirectory ? 'hover:bg-amber-500/5 hover:border-amber-500/20 border border-transparent' : 'hover:bg-white/5 border border-transparent'
                }`}
            >
                <div className="flex items-center space-x-3 overflow-hidden">
                    <div className="w-8 flex justify-center">
                        <FileIcon name={item.name} isDir={item.isDirectory} />
                    </div>
                    <span className={`text-sm font-medium truncate ${item.isDirectory ? 'text-amber-100' : 'text-zinc-300'}`}>
                        {item.name}
                    </span>
                </div>
                
                <div className="flex items-center space-x-4 text-xs text-zinc-500 font-mono">
                    <span>{item.isDirectory ? '-' : (item.size > 1024 ? `${(item.size/1024).toFixed(1)} KB` : `${item.size} B`)}</span>
                    <span className="w-24 text-right opacity-0 group-hover:opacity-100 transition-opacity">
                        {new Date().toLocaleDateString()}
                    </span>
                    {!item.isDirectory && (
                        <button className="p-1 hover:bg-white/10 rounded text-zinc-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity">
                            <Download className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            </div>
        ))}
        
        {filteredItems.length === 0 && !loading && (
            <div className="text-center py-12 text-zinc-600 text-xs italic">
                No artifacts found in this memory sector.
            </div>
        )}
      </div>
      
      {/* Footer Status */}
      <div className="px-4 py-2 border-t border-white/5 bg-[#151518] text-[10px] text-zinc-500 flex justify-between">
          <span>Total Objects: {items.length}</span>
          <span>SOMA File System v4.5</span>
      </div>
    </div>
  );
};

export default FileBrowser;
