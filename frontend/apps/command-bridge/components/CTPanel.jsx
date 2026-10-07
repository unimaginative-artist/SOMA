import React, { useState, useEffect } from 'react';
import { Terminal, ChevronLeft, ChevronRight } from 'lucide-react';
import CTTerminal from './CTTerminal';
import ctService from './CTService';
import SmartSuggestions from './SmartSuggestions';

/**
 * CTPanel - Left Side Panel for Cognitive Terminal
 * Provides collapsible terminal interface with Socket.IO connection to CT backend
 */
const CTPanel = ({ collapsed, onToggle }) => {
  const [ctHistory, setCtHistory] = useState([]);
  const [ctConnected, setCtConnected] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [lastCommand, setLastCommand] = useState('');
  const [lastResponse, setLastResponse] = useState('');

  useEffect(() => {
    // Setup event listeners
    ctService.on('connect', handleConnect);
    ctService.on('disconnect', handleDisconnect);
    ctService.on('response', handleResponse);
    ctService.on('thinking', handleThinking);
    ctService.on('error', handleError);
    ctService.on('stream', handleStream);

    // Connect to CT backend
    ctService.connect();

    // Cleanup on unmount
    return () => {
      ctService.off('connect', handleConnect);
      ctService.off('disconnect', handleDisconnect);
      ctService.off('response', handleResponse);
      ctService.off('thinking', handleThinking);
      ctService.off('error', handleError);
      ctService.off('stream', handleStream);
      ctService.disconnect();
    };
  }, []);

  const handleConnect = () => {
    setCtConnected(true);
    addToHistory({
      type: 'system',
      text: 'Connected to Cognitive Terminal backend',
      timestamp: Date.now()
    });
  };

  const handleDisconnect = () => {
    setCtConnected(false);
    setIsThinking(false);
    addToHistory({
      type: 'system',
      text: 'Disconnected from CT backend',
      timestamp: Date.now()
    });
  };

  const handleResponse = (data) => {
    setIsThinking(false);
    const responseText = data.text || data.response || JSON.stringify(data);
    addToHistory({
      type: 'response',
      text: responseText,
      timestamp: Date.now(),
      metadata: data.metadata || data.meta || {} // Include confidence & other metadata
    });
    setLastResponse(responseText);
  };

  const handleThinking = (data) => {
    setIsThinking(true);
    addToHistory({
      type: 'thinking',
      text: data.message || 'Processing your request...',
      timestamp: Date.now()
    });
  };

  const handleError = (error) => {
    setIsThinking(false);
    addToHistory({
      type: 'error',
      text: error.message || error.toString(),
      timestamp: Date.now()
    });
  };

  const handleStream = (data) => {
    // Handle streaming response chunks
    if (data.chunk) {
      // Append to last response or create new one
      setCtHistory(prev => {
        const lastEntry = prev[prev.length - 1];
        if (lastEntry && lastEntry.type === 'response' && lastEntry.streaming) {
          return [
            ...prev.slice(0, -1),
            { ...lastEntry, text: lastEntry.text + data.chunk }
          ];
        } else {
          return [
            ...prev,
            {
              type: 'response',
              text: data.chunk,
              timestamp: Date.now(),
              streaming: true
            }
          ];
        }
      });
    }

    if (data.done) {
      setIsThinking(false);
      // Mark last response as complete
      setCtHistory(prev => {
        const lastEntry = prev[prev.length - 1];
        if (lastEntry && lastEntry.streaming) {
          return [
            ...prev.slice(0, -1),
            { ...lastEntry, streaming: false }
          ];
        }
        return prev;
      });
    }
  };

  const addToHistory = (entry) => {
    setCtHistory(prev => [...prev, entry]);
  };

  const handleCommand = (command) => {
    // Add command to history
    addToHistory({
      type: 'command',
      text: command,
      timestamp: Date.now()
    });

    // Track for suggestions
    setLastCommand(command);

    // Send to CT backend
    const sent = ctService.sendCommand(command);

    if (!sent) {
      addToHistory({
        type: 'error',
        text: 'Failed to send command. Not connected to CT backend.',
        timestamp: Date.now()
      });
    } else {
      setIsThinking(true);
    }

    // Clear input
    setInputValue('');
  };

  const handleSuggestionSelect = (suggestion) => {
    setInputValue(suggestion);
  };

  return (
    <div
      className="fixed left-0 top-0 h-screen bg-gray-800 border-r border-gray-700 transition-all duration-300 z-40"
      style={{ width: collapsed ? '64px' : '384px' }}
    >
      {/* Header */}
      <div className="p-4 border-b border-gray-700 flex items-center justify-between">
        {!collapsed && (
          <div className="flex items-center space-x-2">
            <Terminal className="w-5 h-5 text-blue-400" />
            <div>
              <h3 className="text-white font-semibold">CT</h3>
              <p className="text-gray-400 text-xs">Cognitive Terminal</p>
            </div>
          </div>
        )}
        <button
          onClick={onToggle}
          className="text-gray-400 hover:text-white transition-colors"
          title={collapsed ? 'Expand CT Panel' : 'Collapse CT Panel'}
        >
          {collapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
        </button>
      </div>

      {/* Content */}
      {!collapsed && (
        <div className="h-[calc(100%-73px)] flex flex-col">
          <div className="flex-1 overflow-hidden">
            <CTTerminal
              history={ctHistory}
              onCommand={handleCommand}
              inputValue={inputValue}
              onInputChange={setInputValue}
              isConnected={ctConnected}
              isThinking={isThinking}
            />
          </div>

          {/* Smart Suggestions Bar */}
          {!isThinking && lastCommand && lastResponse && (
            <div className="p-3 bg-gray-900 border-t border-gray-700">
              <SmartSuggestions
                lastCommand={lastCommand}
                lastResponse={lastResponse}
                onSelectSuggestion={handleSuggestionSelect}
              />
            </div>
          )}
        </div>
      )}

      {/* Collapsed State */}
      {collapsed && (
        <div className="flex flex-col items-center pt-6 space-y-4">
          <Terminal className="w-6 h-6 text-blue-400" />
          <div className={`w-3 h-3 rounded-full ${ctConnected ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`} />
          {ctHistory.length > 0 && (
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
              {ctHistory.filter(h => h.type === 'response').length}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CTPanel;
