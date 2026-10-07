import React, { useState, useEffect } from 'react';
import { Folder, File, Search, RefreshCw, Sparkles, AlertTriangle, FileText, ArrowRight, ArrowLeft, ChevronRight, Copy, Check } from 'lucide-react';
import somaBackend from '../../../somaBackend';
import { registerPilotHandler } from '../kernel/PilotRuntime';

export default function FileManager({ policy = {}, windowId }) {
  const [currentPath, setCurrentPath] = useState('.');
  const [history, setHistory] = useState(['.']);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [files, setFiles] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState('');
  const [aiSummary, setAiSummary] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fileTags, setFileTags] = useState({});
  const [paneTab, setPaneTab] = useState('preview');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchDirectory(currentPath);
  }, [currentPath]);

  const fetchDirectory = async (dirPath, signal) => {
    if (policy.fileRead === false) { setError('File reading is disabled in Aperture Settings.'); return { success: false, error: 'File reading is disabled' }; }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/pulse/fs/list', {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dirPath })
      });
      const data = await response.json();
      if (signal?.aborted) return { success: false, error: 'Pilot stopped' };
      if (data.success) {
        setFiles(data.files || []);
      } else {
        setError(data.error || 'Failed to list directory');
      }
      return data;
    } catch (err) {
      setError(err.message || 'Error fetching files');
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => registerPilotHandler(window, { windowId, action: 'file_browse', execute: async ({ path }, signal) => {
    if (policy.fileRead === false || signal?.aborted) throw new Error('File reading is disabled or pilot stopped');
    const result = await fetchDirectory(path, signal);
    if (!result?.success) throw new Error(result?.error || 'Directory listing failed');
    if (signal?.aborted) throw new Error('Pilot stopped');
    setCurrentPath(path);
    setSelectedFile(null);
    setFileContent('');
    return { status: 'completed', verified: true, summary: `Listed ${path}.`, evidence: { path, entries: result.files?.length || 0, source: 'workspace-filesystem-api' } };
  } }), [windowId, policy.fileRead]);

  const handleNavigate = (path, isDirectory) => {
    if (!isDirectory) {
      handleOpenFile(path);
      return;
    }
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(path);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setCurrentPath(path);
    setSelectedFile(null);
    setFileContent('');
    setAiSummary('');
  };

  const handleBack = () => {
    if (historyIndex > 0) {
      const idx = historyIndex - 1;
      setHistoryIndex(idx);
      setCurrentPath(history[idx]);
      setSelectedFile(null);
      setFileContent('');
      setAiSummary('');
    }
  };

  const handleForward = () => {
    if (historyIndex < history.length - 1) {
      const idx = historyIndex + 1;
      setHistoryIndex(idx);
      setCurrentPath(history[idx]);
      setSelectedFile(null);
      setFileContent('');
      setAiSummary('');
    }
  };

  const handleOpenFile = async (filePath) => {
    if (policy.fileRead === false) {
      setError('File reading is disabled in Aperture Settings.');
      return;
    }
    setLoading(true);
    setAiSummary('');
    try {
      const response = await fetch('/api/soma/fs/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath })
      });
      const data = await response.json();
      if (data.success) {
        setSelectedFile({ name: filePath.split(/[/\\]/).pop(), path: filePath, size: data.size });
        setFileContent(data.content || '[Empty file]');
      } else {
        setError(data.error || 'Failed to read file');
      }
    } catch (err) {
      setError(err.message || 'Error reading file');
    } finally {
      setLoading(false);
    }
  };

  const handleAddTag = (filePath, tag) => {
    setFileTags(prev => {
      const currentTags = prev[filePath] || [];
      if (currentTags.includes(tag)) return prev;
      return { ...prev, [filePath]: [...currentTags, tag] };
    });
  };

  const handleSummarize = async () => {
    if (!selectedFile) return;
    if (policy.somaReasoning === false) {
      setAiSummary('SOMA reasoning is disabled in Aperture Settings.');
      return;
    }
    setLoading(true);
    setAiSummary('Analyzing file contents...');
    try {
      const prompt = `Summarize this file briefly and identify any critical properties or settings. File: ${selectedFile.name}\n\nContent:\n${fileContent.substring(0, 5000)}`;
      const result = await somaBackend.sendChat(prompt);
      if (result && result.message) {
        setAiSummary(result.message);
      } else {
        setAiSummary('Failed to generate summary.');
      }
    } catch (err) {
      setAiSummary('Summary generation error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const filteredFiles = files.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="flex h-full w-full bg-neutral-900/40 text-xs font-sans">
      
      {/* Sidebar - Navigation shortcuts */}
      <div className="w-40 border-r border-white/5 flex flex-col p-3 space-y-1 bg-neutral-950/20">
        <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest px-2 mb-2">Workspace Directories</div>
        {[
          { name: 'Root', path: '.' },
          { name: 'SOMA Core', path: './SOMA' },
          { name: 'Backend', path: './server' },
          { name: 'Frontend', path: './frontend' },
          { name: 'Agents', path: './agents' }
        ].map(item => (
          <button
            key={item.name}
            onClick={() => handleNavigate(item.path, true)}
            className={`w-full text-left px-2 py-1.5 rounded-lg transition-all ${currentPath === item.path ? 'bg-white/10 text-white font-medium' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'}`}
          >
            {item.name}
          </button>
        ))}
      </div>

      {/* Main File Browser */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Navigation & Search Bar */}
        <div className="h-10 border-b border-white/5 px-4 flex items-center justify-between space-x-3 bg-neutral-950/40">
          <div className="flex items-center space-x-1 min-w-0">
            <button 
              onClick={handleBack}
              disabled={historyIndex === 0}
              className={`p-1.5 rounded-md hover:bg-white/5 ${historyIndex === 0 ? 'opacity-40 cursor-not-allowed' : 'text-zinc-300'}`}
              title="Back"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
            <button 
              onClick={handleForward}
              disabled={historyIndex === history.length - 1}
              className={`p-1.5 rounded-md hover:bg-white/5 ${historyIndex === history.length - 1 ? 'opacity-40 cursor-not-allowed' : 'text-zinc-300'}`}
              title="Forward"
            >
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            
            {/* Clickable Breadcrumbs */}
            <div className="flex items-center space-x-1 bg-neutral-900 border border-white/5 px-2 py-1 rounded text-[10px] font-mono overflow-x-auto max-w-xs">
              <button
                onClick={() => handleNavigate('.', true)}
                className={`hover:text-teal-300 transition ${currentPath === '.' ? 'text-teal-400 font-bold' : 'text-zinc-400'}`}
              >
                root
              </button>
              {currentPath !== '.' && currentPath.split(/[/\\]/).filter(p => p && p !== '.').map((part, idx, arr) => {
                const subPath = './' + arr.slice(0, idx + 1).join('/');
                const isLast = idx === arr.length - 1;
                return (
                  <React.Fragment key={idx}>
                    <ChevronRight className="w-2.5 h-2.5 text-zinc-600 flex-shrink-0" />
                    <button
                      onClick={() => handleNavigate(subPath, true)}
                      className={`hover:text-teal-300 transition truncate max-w-[90px] ${isLast ? 'text-teal-400 font-bold' : 'text-zinc-400'}`}
                      title={part}
                    >
                      {part}
                    </button>
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          <div className="flex items-center space-x-2 bg-neutral-950/60 rounded-lg px-2 py-1 border border-white/5 w-60">
            <Search className="w-3.5 h-3.5 text-zinc-500" />
            <input
              type="text"
              placeholder="Search files..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent border-none outline-none text-[11px] text-zinc-300 placeholder-zinc-500 w-full"
            />
          </div>
        </div>

        {/* Directory Listing / Preview Grid */}
        <div className="flex-1 flex overflow-hidden">
          {/* File List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-0.5 custom-scrollbar">
            {loading && files.length === 0 ? (
              <div className="flex items-center justify-center h-full text-zinc-500 space-x-2">
                <RefreshCw className="w-4 h-4 animate-spin text-teal-400" />
                <span>Loading files...</span>
              </div>
            ) : error ? (
              <div className="flex items-center justify-center h-full text-red-400 space-x-2 p-4 text-center">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            ) : filteredFiles.length === 0 ? (
              <div className="flex items-center justify-center h-full text-zinc-600 italic">
                Empty directory or no search matches
              </div>
            ) : (
              filteredFiles.map(file => {
                const tags = fileTags[file.path] || [];
                return (
                  <button
                    key={file.path}
                    onClick={() => handleNavigate(file.path, file.isDirectory)}
                    className="flex items-center justify-between w-full p-2 rounded-xl hover:bg-white/5 transition-all text-left text-zinc-300 group cursor-pointer"
                    data-aperture-action={`file-open-${file.name.toLowerCase()}`}
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      {file.isDirectory ? (
                        <Folder className="w-4 h-4 text-blue-400" />
                      ) : (
                        <File className="w-4 h-4 text-teal-400" />
                      )}
                      <span className="font-medium truncate">{file.name}</span>
                    </div>

                    <div className="flex items-center space-x-2 opacity-60 group-hover:opacity-100 transition-all">
                      {tags.map(t => (
                        <span key={t} className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[8px] uppercase tracking-wide">
                          {t}
                        </span>
                      ))}
                      <span className="text-[10px] text-zinc-500">
                        {file.isDirectory ? 'Folder' : 'File'}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Details & File Content Viewer */}
          {selectedFile && (
            <div className="w-96 border-l border-white/5 flex flex-col bg-neutral-950/20 overflow-hidden">
              <div className="p-3 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center space-x-2.5 min-w-0">
                  <div className="p-2 bg-neutral-900 border border-white/5 rounded-xl text-teal-400 flex-shrink-0">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-zinc-200 truncate text-[11px]">{selectedFile.name}</div>
                    <div className="text-[10px] text-zinc-500 uppercase font-mono">
                      {(selectedFile.size / 1024).toFixed(1)} KB · {fileContent ? `${fileContent.split('\n').length} lines` : '0 lines'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-1 bg-neutral-900 p-0.5 rounded-lg border border-white/5">
                  <button
                    onClick={() => setPaneTab('preview')}
                    className={`px-2 py-1 rounded-md text-[10px] font-medium transition ${paneTab === 'preview' ? 'bg-teal-500/20 text-teal-300' : 'text-zinc-500 hover:text-zinc-300'}`}
                  >
                    View
                  </button>
                  <button
                    onClick={() => setPaneTab('summary')}
                    className={`px-2 py-1 rounded-md text-[10px] font-medium transition ${paneTab === 'summary' ? 'bg-teal-500/20 text-teal-300' : 'text-zinc-500 hover:text-zinc-300'}`}
                  >
                    AI / Tags
                  </button>
                </div>
              </div>

              {paneTab === 'preview' ? (
                <div className="flex-1 flex flex-col p-3 min-h-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] text-zinc-500 font-mono uppercase">Raw File Content</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(fileContent);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      className="flex items-center space-x-1 px-2 py-0.5 rounded bg-neutral-900 hover:bg-white/10 text-zinc-400 hover:text-zinc-200 text-[10px] border border-white/5 transition"
                    >
                      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copied ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                  <div className="flex-1 bg-neutral-900/90 border border-white/5 rounded-xl p-3 overflow-y-auto font-mono text-[10px] text-zinc-300 leading-relaxed custom-scrollbar whitespace-pre-wrap select-text">
                    {fileContent || '[Empty file or content unavailable]'}
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col p-4 space-y-4 overflow-y-auto custom-scrollbar">
                  {/* Tags Editor */}
                  <div className="space-y-1.5">
                    <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Metadata Tags</div>
                    <div className="flex flex-wrap gap-1">
                      {(fileTags[selectedFile.path] || []).map(t => (
                        <span key={t} className="px-2 py-0.5 rounded-md bg-teal-500/10 border border-teal-500/25 text-teal-400 font-mono">
                          {t}
                        </span>
                      ))}
                      <button 
                        onClick={() => handleAddTag(selectedFile.path, 'project-focus')}
                        className="px-2 py-0.5 rounded-md bg-neutral-900 hover:bg-white/5 text-zinc-500 transition border border-white/5 hover:text-zinc-300 font-bold"
                      >
                        + TAG
                      </button>
                    </div>
                  </div>

                  {/* AI Summarizer */}
                  <div className="flex-1 flex flex-col space-y-2">
                    <button
                      onClick={handleSummarize}
                      disabled={loading}
                      className="w-full flex items-center justify-center space-x-1.5 py-2 rounded-xl bg-teal-500 hover:bg-teal-400 text-zinc-950 text-xs font-bold transition duration-200 shadow-lg shadow-teal-500/10 disabled:opacity-50 cursor-pointer"
                      data-aperture-action="summarize-file"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>AI SUMMARIZE</span>
                    </button>

                    {aiSummary && (
                      <div className="flex-1 p-3 rounded-xl bg-neutral-900 border border-white/5 overflow-y-auto text-zinc-400 leading-relaxed font-mono whitespace-pre-line max-h-48 text-[10px] custom-scrollbar">
                        {aiSummary}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
