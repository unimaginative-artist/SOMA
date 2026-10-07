import React, { useState, useEffect } from 'react';
import { Lightbulb, Sparkles, X } from 'lucide-react';

/**
 * SmartSuggestions - Powered by CuriosityEngine
 * Shows intelligent follow-up suggestions based on conversation
 */
const SmartSuggestions = ({ lastCommand, lastResponse, onSelectSuggestion }) => {
  const [suggestions, setSuggestions] = useState([]);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (lastCommand && lastResponse) {
      generateSuggestions(lastCommand, lastResponse);
    }
  }, [lastCommand, lastResponse]);

  const generateSuggestions = async (command, response) => {
    try {
      // Call real CuriosityEngine backend endpoint
      const backendResponse = await fetch('/api/curiosity/suggestions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          lastCommand: command,
          lastResponse: response
        })
      });

      if (!backendResponse.ok) {
        throw new Error(`HTTP ${backendResponse.status}`);
      }

      const data = await backendResponse.json();

      if (data.success && data.suggestions) {
        setSuggestions(data.suggestions);
        setIsVisible(true);
      }
    } catch (err) {
      console.warn('[SmartSuggestions] Failed to fetch from backend, using fallback:', err.message);

      // Fallback to client-side logic if backend fails
      const contextualSuggestions = [];

      // Coding-related follow-ups
      if (response.includes('```') || command.toLowerCase().includes('code')) {
        contextualSuggestions.push({
          id: 'test',
          icon: '🧪',
          text: 'Write unit tests for this code',
          type: 'code'
        });
        contextualSuggestions.push({
          id: 'optimize',
          icon: '⚡',
          text: 'Optimize for performance',
          type: 'code'
        });
      }

      // Explanation follow-ups
      if (command.toLowerCase().includes('what') || command.toLowerCase().includes('explain')) {
        contextualSuggestions.push({
          id: 'example',
          icon: '🔍',
          text: 'Can you provide an example?',
          type: 'clarify'
        });
      }

      // General curiosity fallback
      contextualSuggestions.push({
        id: 'general',
        icon: '💡',
        text: 'What else should I know about this?',
        type: 'curiosity'
      });

      setSuggestions(contextualSuggestions.slice(0, 4));
      setIsVisible(true);
    }
  };

  if (!isVisible || suggestions.length === 0) {
    return null;
  }

  return (
    <div className="bg-gradient-to-br from-purple-900/20 to-blue-900/20 border border-purple-500/20 rounded-lg p-4 mb-4 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <Sparkles className="w-4 h-4 text-purple-400" />
          <span className="text-sm font-medium text-purple-300">Smart Suggestions</span>
        </div>
        <button
          onClick={() => setIsVisible(false)}
          className="text-gray-500 hover:text-gray-300 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.id}
            onClick={() => {
              onSelectSuggestion(suggestion.text);
              setIsVisible(false);
            }}
            className="flex items-center space-x-2 p-2 bg-gray-800/50 hover:bg-gray-700/50 border border-purple-500/10 hover:border-purple-500/30 rounded-lg transition-all text-left group"
          >
            <span className="text-lg group-hover:scale-110 transition-transform">{suggestion.icon}</span>
            <span className="text-xs text-gray-300 group-hover:text-white transition-colors flex-1">
              {suggestion.text}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-2 pt-2 border-t border-purple-500/10">
        <p className="text-[10px] text-gray-500 flex items-center space-x-1">
          <Lightbulb className="w-3 h-3" />
          <span>Powered by SOMA's Curiosity Engine</span>
        </p>
      </div>
    </div>
  );
};

export default SmartSuggestions;
