import React, { useRef, useEffect } from 'react';
import { Terminal as TerminalIcon, Send, Loader, Activity } from 'lucide-react';

/**
 * CTTerminal - Terminal UI component for Cognitive Terminal
 * Displays command history and handles user input
 */
const CTTerminal = ({ history, onCommand, inputValue, onInputChange, isConnected, isThinking, onPulseClick }) => {
  const historyEndRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (inputValue.trim() && isConnected) {
        onCommand(inputValue);
      }
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (inputValue.trim() && isConnected) {
      onCommand(inputValue);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Terminal Header */}
      <div className="bg-gray-800 px-4 py-2 border-b border-gray-700 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <TerminalIcon className="w-4 h-4 text-blue-400" />
          <span className="text-sm text-gray-300">Cognitive Terminal</span>
        </div>
        <div className={`flex items-center space-x-3`}>
          {/* Pulse Button */}
          {onPulseClick && (
            <button
              onClick={onPulseClick}
              className="group relative flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/20 hover:bg-cyan-500/20 hover:border-cyan-400/40 transition-all duration-300"
              title="Open Neural Pulse Interface"
            >
              <Activity 
                className="w-3.5 h-3.5 text-cyan-400 group-hover:text-cyan-300 transition-colors" 
                style={{
                  animation: 'heartbeat 2s ease-in-out infinite'
                }}
              />
              <span className="text-[10px] font-semibold text-cyan-400 group-hover:text-cyan-300 uppercase tracking-wide">Pulse</span>
              <style>{`
                @keyframes heartbeat {
                  0%, 100% { transform: scale(1); opacity: 1; }
                  14% { transform: scale(1.15); opacity: 0.9; }
                  28% { transform: scale(1); opacity: 1; }
                  42% { transform: scale(1.1); opacity: 0.95; }
                  56% { transform: scale(1); opacity: 1; }
                }
              `}</style>
            </button>
          )}
          
          {/* Connection Indicator */}
          <div className="flex items-center space-x-2 px-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-xs text-gray-400">{isConnected ? 'Connected' : 'Offline'}</span>
          </div>
        </div>
      </div>

      {/* Terminal Output */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 font-mono text-sm">
        {!history || history.length === 0 ? (
          <div className="text-gray-500 text-center mt-8">
            <TerminalIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>Terminal ready. Type a command to interact with SOMA.</p>
          </div>
        ) : (
          history.map((entry, index) => (
            <div key={index}>
              {entry.type === 'command' && (
                <div className="flex items-start space-x-2">
                  <span className="text-blue-400">❯</span>
                  <div className="flex-1 text-white">{entry.text}</div>
                  <span className="text-gray-600 text-xs">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                </div>
              )}

              {entry.type === 'response' && (
                <div className="ml-4">
                  <div className="text-gray-300 whitespace-pre-wrap">{entry.text}</div>
                  {/* Show confidence if available */}
                  {entry.metadata?.confidence && (
                    <div className="mt-1 flex items-center space-x-2">
                      <div className="flex items-center space-x-1">
                        <div
                          className={`w-1.5 h-1.5 rounded-full ${
                            entry.metadata.confidence > 0.8 ? 'bg-green-500' :
                            entry.metadata.confidence > 0.6 ? 'bg-yellow-500' :
                            'bg-orange-500'
                          }`}
                        />
                        <span className="text-[10px] text-gray-500">
                          Confidence: <span className={`font-mono ${
                            entry.metadata.confidence > 0.8 ? 'text-green-400' :
                            entry.metadata.confidence > 0.6 ? 'text-yellow-400' :
                            'text-orange-400'
                          }`}>{(entry.metadata.confidence * 100).toFixed(0)}%</span>
                        </span>
                      </div>
                      {entry.metadata.brainsUsed && (
                        <span className="text-[10px] text-gray-600">
                          • {entry.metadata.brainsUsed}
                        </span>
                      )}
                      {entry.metadata.latency_ms && (
                        <span className="text-[10px] text-gray-600">
                          • {entry.metadata.latency_ms}ms
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {entry.type === 'thinking' && (
                <div className="ml-4 flex items-center space-x-2 text-amber-400">
                  <Loader className="w-3 h-3 animate-spin" />
                  <span className="text-sm italic">{entry.text || 'Thinking...'}</span>
                </div>
              )}

              {entry.type === 'error' && (
                <div className="ml-4 text-red-400">
                  Error: {entry.text}
                </div>
              )}

              {entry.type === 'system' && (
                <div className="ml-4 text-gray-500 text-xs">
                  {entry.text}
                </div>
              )}
            </div>
          ))
        )}

        {isThinking && (
          <div className="flex items-center space-x-2 text-amber-400">
            <Loader className="w-3 h-3 animate-spin" />
            <span className="text-sm italic">Processing...</span>
          </div>
        )}

        <div ref={historyEndRef} />
      </div>

      {/* Terminal Input */}
      <form onSubmit={handleSubmit} className="bg-gray-800 border-t border-gray-700 p-3">
        <div className="flex items-center space-x-2">
          <span className="text-blue-400">❯</span>
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyPress={handleKeyPress}
            disabled={!isConnected || isThinking}
            placeholder={isConnected ? 'Enter command...' : 'Connecting...'}
            className="flex-1 bg-gray-900 text-white px-3 py-2 rounded border border-gray-700 focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed font-mono text-sm"
          />
          <button
            type="submit"
            disabled={!isConnected || isThinking || !inputValue.trim()}
            className="p-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        {!isConnected && (
          <p className="text-red-400 text-xs mt-2">
            CT Backend offline. Please ensure Cognitive Terminal server is running on port 3001.
          </p>
        )}
      </form>
    </div>
  );
};

export default CTTerminal;
