import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Mic, MicOff, Send, Loader, Brain, Zap, Code, FileText, Play, CheckCircle, AlertCircle, Activity } from 'lucide-react';
import PulseInterface from './components/PulseInterface';

/**
 * SOMA Cognitive Terminal - Beast Mode
 * Full autonomous development terminal with voice, agents, and reasoning
 */

const SomaCT = () => {
  // State
  const [input, setInput] = useState('');
  const [history, setHistory] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [commandHistory, setCommandHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  // Voice
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);
  const synthRef = useRef(window.speechSynthesis);
  
  // Connection
  const [isConnected, setIsConnected] = useState(false);
  const [somaStatus, setSomaStatus] = useState({ brain: 'ready', confidence: 0 });
  
  // Pulse Interface
  const [showPulse, setShowPulse] = useState(false);
  
  // Refs
  const terminalEndRef = useRef(null);
  const inputRef = useRef(null);
  const historyIdCounter = useRef(0);

  // Auto-scroll
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  // Check SOMA backend connection
  useEffect(() => {
    const checkConnection = async () => {
      try {
        const response = await fetch('/api/terminal/status');
        const data = await response.json();
        setIsConnected(data.success);
        if (data.status) setSomaStatus(data.status);
      } catch {
        setIsConnected(false);
      }
    };
    
    checkConnection();
    const interval = setInterval(checkConnection, 5000);
    return () => clearInterval(interval);
  }, []);

  // Initialize voice recognition
  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        
        if (event.results[event.results.length - 1].isFinal) {
          setInput(transcript);
          // Auto-execute voice commands
          handleCommand(transcript);
        } else {
          setInput(transcript); // Show interim results
        }
      };

      recognitionRef.current.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        if (isVoiceActive) {
          try {
            recognitionRef.current.start();
          } catch (e) {
            console.error('Failed to restart recognition:', e);
          }
        } else {
          setIsListening(false);
        }
      };
    }

    return () => {
      if (recognitionRef.current) recognitionRef.current.stop();
      if (synthRef.current) synthRef.current.cancel();
    };
  }, [isVoiceActive]);

  // Toggle voice
  const toggleVoice = () => {
    if (!recognitionRef.current) {
      addToHistory('error', '❌ Voice recognition not supported in this browser');
      return;
    }

    if (isVoiceActive) {
      recognitionRef.current.stop();
      setIsVoiceActive(false);
      setIsListening(false);
      addToHistory('info', '🎤 Voice deactivated');
    } else {
      try {
        recognitionRef.current.start();
        setIsVoiceActive(true);
        setIsListening(true);
        addToHistory('success', '🎤 Voice activated - speak your command');
      } catch (error) {
        addToHistory('error', `❌ Failed to start voice: ${error.message}`);
      }
    }
  };

  // Speak response
  const speakResponse = (text) => {
    if (!synthRef.current || !isVoiceActive) return;
    
    synthRef.current.cancel(); // Cancel any ongoing speech
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    
    synthRef.current.speak(utterance);
  };

  // Add to history
  const addToHistory = (type, content, metadata = {}) => {
    const id = historyIdCounter.current++;
    setHistory(prev => [...prev, { id, type, content, metadata, timestamp: Date.now() }]);
  };

  // Handle command execution
  const handleCommand = async (cmd) => {
    if (!cmd.trim()) return;

    const command = cmd.trim();
    
    // Add to command history
    if (!commandHistory.includes(command)) {
      setCommandHistory(prev => [command, ...prev].slice(0, 50));
    }
    setHistoryIndex(-1);
    
    // Clear input
    setInput('');
    
    // Show command in history
    addToHistory('command', command);
    
    // Handle special commands
    if (command.toLowerCase() === 'clear') {
      setHistory([]);
      return;
    }
    
    if (command.toLowerCase() === 'help') {
      showHelp();
      return;
    }

    // Process through SOMA
    setIsProcessing(true);

    try {
      const response = await fetch('/api/terminal/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, context: { voice: isVoiceActive } })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.success) {
        // Show reasoning if available
        if (data.reasoning) {
          addToHistory('reasoning', data.reasoning, { brain: data.brain, confidence: data.confidence });
        }

        // Show plan if available
        if (data.plan && data.plan.length > 0) {
          addToHistory('plan', data.plan);
        }

        // Show output
        if (data.output) {
          addToHistory('output', data.output, { type: data.outputType });
        }

        // Show artifacts (code, files, etc.)
        if (data.artifacts && data.artifacts.length > 0) {
          data.artifacts.forEach(artifact => {
            addToHistory('artifact', artifact);
          });
        }

        // Show result
        if (data.result) {
          addToHistory('success', data.result);
          
          // Speak result if voice is active
          if (isVoiceActive) {
            speakResponse(data.result);
          }
        }

      } else {
        addToHistory('error', data.error || 'Command failed');
        if (isVoiceActive) {
          speakResponse('Command failed');
        }
      }

    } catch (error) {
      addToHistory('error', `❌ Error: ${error.message}`);
      if (isVoiceActive) {
        speakResponse('An error occurred');
      }
    }

    setIsProcessing(false);
  };

  // Show help
  const showHelp = () => {
    addToHistory('help', `
╔════════════════════════════════════════════════════════════╗
║                 SOMA COGNITIVE TERMINAL                    ║
╚════════════════════════════════════════════════════════════╝

🧠 NATURAL LANGUAGE COMMANDS:
  "Create a React component for a todo list"
  "Analyze this codebase and suggest improvements"
  "Debug the error in server.js"
  "Refactor the authentication module"
  "Run tests and show me the failures"
  "Deploy to production"
  
⚡ AGENT COMMANDS:
  agent list              - Show all available agents
  agent create <type>     - Create new agent
  agent deploy <name>     - Deploy agent to production
  
💻 TERMINAL COMMANDS:
  ls, dir                 - List files
  cat <file>              - Show file contents
  pwd                     - Current directory
  cd <path>               - Change directory
  
🎤 VOICE:
  Click microphone icon to activate voice mode
  Speak naturally - SOMA understands context
  
⌨️  KEYBOARD:
  Enter                   - Execute command
  ↑/↓                     - Navigate command history
  Tab                     - Autocomplete (coming soon)
  Ctrl+C                  - Cancel current operation
  
🛠️  SPECIAL:
  clear                   - Clear terminal
  help                    - Show this help
  status                  - Show SOMA status
  
💡 TIP: SOMA uses TriBrain reasoning:
  - Analytical: Logic and planning
  - Creative: Novel solutions
  - Intuitive: Pattern recognition
    `);
  };

  // Handle keyboard input
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleCommand(input);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (historyIndex < commandHistory.length - 1) {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        setInput(commandHistory[newIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(commandHistory[newIndex]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInput('');
      }
    }
  };

  // Render history item
  const renderHistoryItem = (item) => {
    const typeStyles = {
      command: 'text-cyan-400',
      output: 'text-gray-200',
      success: 'text-green-400',
      error: 'text-red-400',
      info: 'text-blue-400',
      reasoning: 'text-purple-400',
      plan: 'text-yellow-400',
      artifact: 'text-orange-400',
      help: 'text-gray-300 text-sm'
    };

    const style = typeStyles[item.type] || 'text-gray-400';

    if (item.type === 'command') {
      return (
        <div className={`flex items-start ${style} font-bold`}>
          <Terminal className="w-4 h-4 mr-2 mt-1 flex-shrink-0" />
          <span>$ {item.content}</span>
        </div>
      );
    }

    if (item.type === 'reasoning') {
      return (
        <div className={`${style} border-l-2 border-purple-500 pl-3 my-2`}>
          <div className="flex items-center mb-1">
            <Brain className="w-4 h-4 mr-2" />
            <span className="font-semibold">
              {item.metadata.brain} Brain ({Math.round(item.metadata.confidence * 100)}% confidence)
            </span>
          </div>
          <p className="text-sm opacity-80">{item.content}</p>
        </div>
      );
    }

    if (item.type === 'plan') {
      return (
        <div className={`${style} border-l-2 border-yellow-500 pl-3 my-2`}>
          <div className="flex items-center mb-1">
            <Zap className="w-4 h-4 mr-2" />
            <span className="font-semibold">Execution Plan</span>
          </div>
          <ol className="text-sm space-y-1 list-decimal list-inside">
            {item.content.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
      );
    }

    if (item.type === 'artifact') {
      return (
        <div className="border border-gray-700 rounded-lg p-3 my-2 bg-gray-900">
          <div className="flex items-center mb-2">
            {item.content.type === 'code' ? <Code className="w-4 h-4 mr-2" /> : <FileText className="w-4 h-4 mr-2" />}
            <span className="font-semibold text-orange-400">{item.content.name}</span>
          </div>
          <pre className="text-sm bg-black p-3 rounded overflow-x-auto">
            <code className={`language-${item.content.language}`}>
              {item.content.content}
            </code>
          </pre>
        </div>
      );
    }

    if (item.type === 'help') {
      return <pre className={`${style} whitespace-pre-wrap font-mono`}>{item.content}</pre>;
    }

    return <div className={style}>{item.content}</div>;
  };

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 p-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Terminal className="w-6 h-6 text-cyan-400" />
          <h1 className="text-xl font-bold">SOMA Cognitive Terminal</h1>
        </div>
        
        <div className="flex items-center space-x-4">
          {/* Pulse Button */}
          <button
            onClick={() => setShowPulse(true)}
            className="flex items-center space-x-2 px-3 py-1.5 rounded-full border transition-all duration-500 bg-cyan-500/10 border-cyan-500/20 hover:bg-cyan-500/20 hover:border-cyan-400/40"
            title="Open Neural Pulse Interface"
          >
            <div className="h-1.5 w-1.5 rounded-full bg-cyan-400" style={{ animation: 'heartbeat 2s ease-in-out infinite' }}></div>
            <span className="text-[10px] font-medium tracking-wide uppercase text-cyan-400">Pulse</span>
          </button>

          {/* Connection Status */}
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
            <span className="text-sm text-gray-400">
              {isConnected ? 'SOMA Connected' : 'SOMA Offline'}
            </span>
          </div>
          
          {/* Brain Status */}
          {isConnected && (
            <div className="flex items-center space-x-2 text-sm">
              <Brain className="w-4 h-4 text-purple-400" />
              <span className="text-gray-400">{somaStatus.brain}</span>
            </div>
          )}
        </div>
      </div>

      {/* Terminal Area */}
      <div className="flex-1 overflow-y-auto p-4 font-mono text-sm space-y-2">
        {/* Welcome Message */}
        {history.length === 0 && (
          <div className="text-center text-gray-500 mt-10">
            <Brain className="w-16 h-16 mx-auto mb-4 text-purple-500" />
            <p className="text-lg mb-2">Welcome to SOMA Cognitive Terminal</p>
            <p className="text-sm">Type <span className="text-cyan-400">help</span> to see available commands</p>
            <p className="text-sm">Or just speak naturally - SOMA understands</p>
          </div>
        )}
        
        {/* History */}
        {history.map(item => (
          <div key={item.id} className="py-1">
            {renderHistoryItem(item)}
          </div>
        ))}
        
        {/* Processing Indicator */}
        {isProcessing && (
          <div className="flex items-center space-x-2 text-gray-400 animate-pulse">
            <Loader className="w-4 h-4 animate-spin" />
            <span>SOMA is thinking...</span>
          </div>
        )}
        
        <div ref={terminalEndRef} />
      </div>

      {/* Input Area */}
      <div className="bg-gray-900 border-t border-gray-800 p-4">
        <div className="flex items-center space-x-2">
          {/* Voice Button */}
          <button
            onClick={toggleVoice}
            className={`p-2 rounded-lg transition-colors ${
              isVoiceActive 
                ? 'bg-red-500 hover:bg-red-600 text-white' 
                : 'bg-gray-800 hover:bg-gray-700 text-gray-400'
            }`}
            title={isVoiceActive ? 'Stop Voice' : 'Start Voice'}
          >
            {isVoiceActive ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>

          {/* Input */}
          <div className="flex-1 relative">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isListening ? "Listening..." : "Type a command or speak naturally..."}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-gray-100 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
              disabled={isProcessing}
            />
          </div>

          {/* Send Button */}
          <button
            onClick={() => handleCommand(input)}
            disabled={isProcessing || !input.trim()}
            className="p-2 bg-cyan-500 hover:bg-cyan-600 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg transition-colors"
            title="Execute Command"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Pulse Interface Modal */}
      {showPulse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="w-full h-full">
            <button
              onClick={() => setShowPulse(false)}
              className="absolute top-4 right-4 z-50 px-4 py-2 bg-red-500/20 hover:bg-red-500/40 border border-red-500/50 rounded-lg text-red-400 transition-colors"
            >
              Close Pulse
            </button>
            <PulseInterface />
          </div>
        </div>
      )}

      <style>{`
        @keyframes heartbeat {
          0%, 100% { transform: scale(1); opacity: 1; }
          25% { transform: scale(1.3); opacity: 0.8; }
          50% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default SomaCT;
