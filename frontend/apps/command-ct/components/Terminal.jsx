import React, { useState, useRef, useEffect } from 'react';
import { Paperclip, X, Camera, Aperture, Activity, Brain, Square } from 'lucide-react';
import '../styles/orb.css';
import { OutputLine } from './OutputLine';
import { SuggestionButtons } from './SuggestionButtons';
import FloatingChat from './FloatingChat';
import { BlinkingDots } from './BlinkingDots';

const Terminal = ({ history, isLoading, onCommand, onCancel, inputValue, onInputChange, currentPath, isAgentConnected, awaitingConfirmation, suggestions, onSuggestionClick, somaService, onAutocompleteResult, somaResponseText, activeDirective, onPulseClick, onEditMessage, onRetryMessage, onBranchMessage, onPinMessage }) => {
    const terminalRef = useRef(null);
    const inputRef = useRef(null);
    const fileInputRef = useRef(null);
    const messagesEndRef = useRef(null); // Anchor for scrolling
    const [commandHistory, setCommandHistory] = useState([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [isBackendConnected, setIsBackendConnected] = useState(false);
    const [selectedFile, setSelectedFile] = useState(null);
    const [isDeepThinking, setIsDeepThinking] = useState(false);

    const [hasInteracted, setHasInteracted] = useState(false);

    // Camera State
    const [isCameraOpen, setIsCameraOpen] = useState(false);
    const videoRef = useRef(null);
    const canvasRef = useRef(null);

    // Silent Capture for Active Vision
    const performSilentCapture = async (query) => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });

            // Create invisible video element
            const video = document.createElement('video');
            video.srcObject = stream;
            video.play();

            // Wait for stream to be ready
            await new Promise(resolve => video.onloadedmetadata = resolve);

            // Capture frame
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            canvas.getContext('2d').drawImage(video, 0, 0);

            const dataUrl = canvas.toDataURL('image/jpeg');

            // Cleanup
            stream.getTracks().forEach(track => track.stop());

            // Send back to system
            onCommand({
                type: 'vision',
                query: query,
                file: {
                    name: `active_vision_${Date.now()}.jpg`,
                    type: 'image/jpeg',
                    data: dataUrl
                }
            });

        } catch (err) {
            console.error("Silent Capture Failed:", err);
            // Fallback: Notify user
            onInputChange("[System] Camera access denied or unavailable.");
        }
    };

    useEffect(() => {
        if (activeDirective) {
            if (activeDirective.type === 'request_camera_capture') {
                performSilentCapture(activeDirective.query);
            } else if (activeDirective.type === 'request_pulse_confirmation') {
                // Pulse confirmation handled inline in OutputLine with button
            }
        }
    }, [activeDirective]);

    useEffect(() => {
        setHasInteracted(history.length > 0);
    }, [history.length]);

    // Camera Logic
    const startCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            setIsCameraOpen(true);
            // Wait for modal to render
            setTimeout(() => {
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    videoRef.current.play();
                }
            }, 100);
        } catch (err) {
            console.error("Camera Error:", err);
            // Fallback handled by UI not showing
        }
    };

    const stopCamera = () => {
        if (videoRef.current && videoRef.current.srcObject) {
            const tracks = videoRef.current.srcObject.getTracks();
            tracks.forEach(track => track.stop());
        }
        setIsCameraOpen(false);
    };

    const captureImage = () => {
        if (videoRef.current && canvasRef.current) {
            const context = canvasRef.current.getContext('2d');
            const width = videoRef.current.videoWidth;
            const height = videoRef.current.videoHeight;
            canvasRef.current.width = width;
            canvasRef.current.height = height;
            context.drawImage(videoRef.current, 0, 0, width, height);

            const dataUrl = canvasRef.current.toDataURL('image/jpeg');

            // Create a file-like object for the existing logic
            const file = {
                name: `capture_${Date.now()}.jpg`,
                type: 'image/jpeg',
                dataUrl: dataUrl // Store directly
            };

            // We need to slightly modify how we store this because normal file input gives a File object, 
            // but here we already have the base64.
            // We'll wrap it to look like the state expects, but flag it as pre-read.
            setSelectedFile({ ...file, isCaptured: true });
            onInputChange(`[Camera Capture] ${inputValue}`);

            stopCamera();
            focusInput();
        }
    };

    useEffect(() => {
        const checkBackend = async () => {
            try {
                const response = await fetch('/api/health');
                setIsBackendConnected(response.ok);
            } catch (err) {
                setIsBackendConnected(false);
            }
        };
        checkBackend();
        const interval = setInterval(checkBackend, 3000);
        return () => clearInterval(interval);
    }, []);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [history, awaitingConfirmation, suggestions, isLoading]);

    useEffect(() => {
        if (!terminalRef.current) return;
        const resizeObserver = new ResizeObserver(() => {
            if (terminalRef.current) {
                const { scrollHeight, scrollTop, clientHeight } = terminalRef.current;
                const isNearBottom = scrollHeight - scrollTop - clientHeight < 150;
                if (isNearBottom || isLoading) {
                    scrollToBottom();
                }
            }
        });
        Array.from(terminalRef.current.children).forEach(child => {
            resizeObserver.observe(child);
        });
        return () => resizeObserver.disconnect();
    }, [history, isLoading]);


    const focusInput = () => {
        setTimeout(() => {
            inputRef.current?.focus();
        }, 10);
    };

    useEffect(focusInput, []);

    useEffect(() => {
        if (!isLoading) {
            focusInput();
        }
    }, [isLoading]);

    const handleInputChange = (e) => {
        onInputChange(e.target.value);
    };

    const handleInteractionStart = () => {
        setHasInteracted(true);
    };

    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        if (file) {
            if (file.size > 20 * 1024 * 1024) {
                onInputChange('[System] Attachment exceeds the 20 MB limit.');
                return;
            }
            setSelectedFile(file);
            onInputChange(`[Attachment: ${file.name}] ${inputValue}`);
            focusInput();
        }
    };

    const handleDrop = event => {
        event.preventDefault();
        const file = event.dataTransfer?.files?.[0];
        if (!file) return;
        if (file.size > 20 * 1024 * 1024) {
            onInputChange('[System] Attachment exceeds the 20 MB limit.');
            return;
        }
        setSelectedFile(file);
        onInputChange(`[Attachment: ${file.name}] ${inputValue}`);
        focusInput();
    };

    const handleSend = () => {
        if (isLoading) return;
        if (!inputValue.trim() && !awaitingConfirmation && !selectedFile) return;

        handleInteractionStart();
        const command = inputValue.trim();

        if (awaitingConfirmation) {
            onCommand(command || 'y');
            onInputChange('');
            return;
        }

        if (selectedFile) {
            if (selectedFile.isCaptured) {
                // Already base64 from camera
                onCommand({
                    type: 'vision',
                    query: command || `Analyze this camera capture`,
                    file: {
                        name: selectedFile.name,
                        type: selectedFile.type,
                        data: selectedFile.dataUrl
                    },
                    deepThinking: isDeepThinking
                });
                setSelectedFile(null);
                onInputChange('');
            } else {
                // REAL EXECUTION: Read file and send data
                const reader = new FileReader();
                reader.onload = (e) => {
                    const base64Data = e.target.result;
                    const isImage = selectedFile.type?.startsWith('image/');
                    onCommand({
                        type: isImage ? 'vision' : 'document',
                        query: command || `Analyze ${selectedFile.name}`,
                        file: {
                            name: selectedFile.name,
                            type: selectedFile.type,
                            data: base64Data
                        },
                        deepThinking: isDeepThinking
                    });
                    setSelectedFile(null);
                    onInputChange('');
                };
                reader.readAsDataURL(selectedFile);
            }
        } else {
            onCommand({ type: 'text', query: command, deepThinking: isDeepThinking });
        }

        if (command && !selectedFile) {
            setCommandHistory(prev => {
                if (prev.length > 0 && prev[0] === command) return prev;
                return [command, ...prev];
            });
            setHistoryIndex(-1);
        }
        focusInput();
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            if (isLoading || !somaService || !inputValue.trim()) return;

            const { completions, textToReplace } = somaService.autocomplete(inputValue);

            if (completions.length === 1) {
                const completedValue = inputValue.substring(0, inputValue.length - textToReplace.length) + completions[0];
                onInputChange(completedValue);
            } else if (completions.length > 1) {
                onAutocompleteResult(completions);
            }
            return;
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        } else if (e.key === 'ArrowUp' && !awaitingConfirmation) {
            e.preventDefault();
            if (commandHistory.length > 0) {
                const newIndex = Math.min(historyIndex + 1, commandHistory.length - 1);
                setHistoryIndex(newIndex);
                onInputChange(commandHistory[newIndex]);
            }
        } else if (e.key === 'ArrowDown' && !awaitingConfirmation) {
            e.preventDefault();
            if (historyIndex > 0) {
                const newIndex = historyIndex - 1;
                setHistoryIndex(newIndex);
                onInputChange(commandHistory[newIndex]);
            } else if (historyIndex === 0) {
                setHistoryIndex(-1);
                onInputChange('');
            }
        }
    };

    // State Logic for Placeholders
    let placeholderText = hasInteracted ? "Ready..." : "Initialize SOMA...";

    if (awaitingConfirmation) placeholderText = '';
    else if (inputValue.length > 0) placeholderText = '';

    return (
        <>
            {/* Floating Chat Window - Removed duplicate */}
            {/* {somaService && <FloatingChat somaService={somaService} />} */}

            <main className="flex-1 flex flex-col min-h-0 h-full">
                {/* Glass Pane */}
                <div className="flex-grow bg-[#151518]/80 backdrop-blur-2xl rounded-3xl border border-white/5 shadow-2xl flex flex-col overflow-hidden relative mx-4 ring-1 ring-white/5 group">


                    {/* Big SOMA Logo Overlay */}
                    <div className={`absolute inset-0 flex flex-col items-center justify-center z-20 transition-all duration-1000 ease-[cubic-bezier(0.25,1,0.5,1)] ${hasInteracted ? 'opacity-0 pointer-events-none scale-95 blur-sm' : 'opacity-100 scale-100 blur-0'}`}>
                        <div className="relative">
                            {/* Subtle Glow behind logo */}
                            <div className="absolute -inset-10 bg-white/5 rounded-full blur-3xl opacity-50"></div>
                            <h1 className="relative text-7xl md:text-9xl font-bold tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-white/20 select-none drop-shadow-2xl">
                                SOMA
                            </h1>
                        </div>
                        <div className="mt-6 flex items-center space-x-3 opacity-60">
                            <div className="h-[1px] w-8 bg-zinc-500"></div>
                            <p className="text-zinc-400 tracking-[0.3em] text-xs font-medium uppercase">Cognitive Terminal</p>
                            <div className="h-[1px] w-8 bg-zinc-500"></div>
                        </div>
                    </div>

                    {/* Content Area */}
                    <div
                        ref={terminalRef}
                        className={`flex-1 p-8 overflow-y-auto custom-scrollbar transition-all duration-1000 delay-200 ${hasInteracted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
                        onClick={focusInput}
                        onDragOver={event => event.preventDefault()}
                        onDrop={handleDrop}
                    >
                        {history.map((item, idx) => <OutputLine key={`${item.id}-${idx}`} item={item} currentPath={currentPath} isAgentConnected={isAgentConnected} onEdit={content => onEditMessage?.(item.id, content)} onRetry={() => onRetryMessage?.(idx)} onBranch={() => onBranchMessage?.(idx)} onPin={() => onPinMessage?.(item.id)} />)}

                        {awaitingConfirmation && (
                            <div className="text-amber-300 mt-4 font-medium animate-pulse">{awaitingConfirmation}</div>
                        )}

                        {/* Only show BlinkingDots if loading AND there's no thinking indicator already in history */}
                        {isLoading && !awaitingConfirmation && !history.some(item => item.type === 'think' || item.type === 'thinking' || item.type === 'working') && (
                            <div className="mt-4 ml-1 opacity-80">
                                <BlinkingDots />
                            </div>
                        )}

                        <SuggestionButtons
                            suggestions={suggestions}
                            onSuggestionClick={onSuggestionClick}
                            isLoading={isLoading}
                        />

                        {/* Scroll Anchor */}
                        <div ref={messagesEndRef} />

                        <div className="h-4" />
                    </div>
                </div>

                {/* Neural Link Input Bar */}
                <div className="group relative mt-5 mx-4 z-30 mb-6">
                    {/* Animated Gradient Glow (The "Neural" Effect) */}
                    <div className="absolute -inset-0.5 bg-gradient-to-r from-cyan-500 via-purple-500 to-fuchsia-500 rounded-2xl opacity-20 group-hover:opacity-60 blur-md transition duration-1000 group-focus-within:opacity-100 group-focus-within:duration-200 group-focus-within:blur-lg"></div>
                    
                    {/* Main Container */}
                    <div className="relative flex items-center bg-[#09090b] rounded-2xl px-4 py-3 ring-1 ring-white/10 shadow-2xl">

                        {/* Left Action Buttons */}
                        <div className="flex items-center space-x-1 mr-3 border-r border-white/10 pr-3">
                            <button
                                className="text-zinc-500 hover:text-cyan-400 transition-colors p-1.5 rounded-lg hover:bg-white/5"
                                onClick={startCamera}
                                title="Use Camera"
                                aria-label="Use camera"
                            >
                                <Camera className="w-5 h-5" />
                            </button>
                            <button
                                className="text-zinc-500 hover:text-fuchsia-400 transition-colors p-1.5 rounded-lg hover:bg-white/5"
                                onClick={() => fileInputRef.current?.click()}
                                title="Upload Image/File"
                                aria-label="Attach file"
                            >
                                <Paperclip className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Brain Mode Toggle */}
                        <button
                            className={`mr-3 transition-all duration-300 p-1.5 rounded-lg hover:bg-white/5 ${isDeepThinking ? 'text-fuchsia-400 scale-110 drop-shadow-[0_0_8px_rgba(217,70,239,0.5)]' : 'text-zinc-600 hover:text-zinc-300'}`}
                            onClick={() => setIsDeepThinking(!isDeepThinking)}
                            title={isDeepThinking ? 'Deep Reasoning ON' : 'Enable Deep Reasoning'}
                            aria-label="Deep reasoning"
                            aria-pressed={isDeepThinking}
                        >
                            <Brain className={`w-5 h-5 ${isDeepThinking ? 'fill-current' : ''}`} />
                        </button>

                        <input
                            type="file"
                            ref={fileInputRef}
                            className="hidden"
                            onChange={handleFileSelect}
                accept="image/*,.pdf,.docx,.txt,.md,.json,.csv,.js,.ts,.jsx,.tsx,.py"
                        />

                        {/* File Preview Chip */}
                        {selectedFile && (
                            <div className="flex items-center bg-white/10 rounded-full px-3 py-1 mr-2 text-xs text-zinc-200 border border-white/10 animate-in fade-in slide-in-from-bottom-2">
                                <span className="truncate max-w-[100px]">{selectedFile.name}</span>
                                <button onClick={() => setSelectedFile(null)} className="ml-2 text-zinc-400 hover:text-white">
                                    <X className="w-3 h-3" />
                                </button>
                            </div>
                        )}

                        {/* Main Input Field */}
                        <textarea
                            ref={inputRef}
                            rows={1}
                            aria-label="Message SOMA"
                            className="max-h-40 flex-1 resize-none bg-transparent border-none focus:outline-none text-zinc-100 placeholder-zinc-600 font-medium text-base h-full py-1"
                            value={inputValue}
                            onChange={handleInputChange}
                            onKeyDown={handleKeyDown}
                            disabled={isLoading}
                            autoFocus
                            spellCheck="false"
                            autoComplete="off"
                            placeholder={placeholderText}
                        />

                        {/* Send / Stop Button */}
                        <button
                            onClick={isLoading ? onCancel : handleSend}
                            disabled={!isLoading && (!inputValue.trim() && !awaitingConfirmation && !selectedFile)}
                            className={`Btn ml-2 transition-all duration-300 ${
                                isLoading || inputValue.trim() || selectedFile
                                    ? 'opacity-100 scale-100'
                                    : 'opacity-40 grayscale cursor-not-allowed scale-95'
                            }`}
                            aria-label={isLoading ? 'Stop response' : 'Send'}
                        >
                            <div className="sign">
                                {isLoading ? <Square className="h-4 w-4 fill-current" /> : (
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                                        <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                                    </svg>
                                )}
                            </div>
                            <div className="text">{isLoading ? 'Stop' : 'Send'}</div>
                        </button>
                    </div>
                </div>

                {/* Camera Modal */}
                {isCameraOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Camera capture">
                        <div className="bg-[#1c1c1e] border border-white/10 rounded-2xl p-2 shadow-2xl relative">
                            <button
                                onClick={stopCamera}
                                aria-label="Close camera"
                                className="absolute top-4 right-4 z-10 p-2 bg-black/50 rounded-full text-white hover:bg-red-500/50 transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>

                            <div className="rounded-xl overflow-hidden relative border border-white/5">
                                <video ref={videoRef} autoPlay playsInline className="max-w-[80vw] max-h-[70vh]" />
                                <canvas ref={canvasRef} className="hidden" />
                            </div>

                            <div className="flex justify-center p-4">
                                <button
                                    onClick={captureImage}
                                    aria-label="Capture image"
                                    className="w-16 h-16 rounded-full border-4 border-white/20 flex items-center justify-center hover:scale-105 transition-transform bg-white/10 hover:bg-white/20 hover:border-white/50"
                                >
                                    <div className="w-12 h-12 bg-white rounded-full"></div>
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </>
    );
};

export default Terminal;
