import { useState, useRef, useEffect, useCallback } from 'react';
import { initElevenLabs, textToSpeech, isElevenLabsEnabled } from '../utils/elevenLabsTTS';
import { reasonWithSoma, formatResponseForSpeech } from '../utils/somaClient';
import { getSharedSessionId } from '../utils/sharedSession';
import somaBackend from '../somaBackend';

// Audio configuration constants
const OUTPUT_SAMPLE_RATE = 24000;

// Helper for smooth value transitions
const lerp = (start, end, factor) => {
  return start + (end - start) * factor;
};

// Helper to calculate volume from an analyser node
const calculateVolume = (analyser, frequencyData) => {
  analyser.getByteFrequencyData(frequencyData);
  
  const voiceBins = frequencyData.slice(1, 32); 
  let max = 0;
  for (let i = 0; i < voiceBins.length; i++) {
    if (voiceBins[i] > max) {
        max = voiceBins[i];
    }
  }
  
  const normalized = Math.min(1, max / 200); 
  return normalized;
};

// Validate transcription quality to filter noise/gibberish
const isValidTranscription = (text) => {
  if (text.length < 5) return false;

  const lowerText = text.toLowerCase().trim();
  const words = lowerText.split(/\s+/).filter(w => w.length > 0);
  
  // Require at least 2 words or a longer single word
  if (words.length < 2 && lowerText.length < 8) {
    return false;
  }

  // Check for common Whisper hallucination artifacts
  const commonArtifacts = [
    'thank you', 'thank you.', 'thank you so much', 'thanks for watching',
    'thanks for listening', 'subscribe', 'like and subscribe', 'please subscribe',
    'see you next time', 'see you in the next video', 'bye bye', 'goodbye',
    'good night', 'good morning', 'you', 'bye', 'thank', 'oh', 'hello',
    'okay', 'ok', 'yeah', 'yes', 'no', 'um', 'uh', 'hmm', 'huh', 'ah', 'so',
    'and', 'the', 'i\'m sorry', 'sorry', '[blank_audio]', '[silence]',
    '(upbeat music)', '(gentle music)', '(music)', '(music playing)',
    '(soft music)', '(laughing)', '(applause)', '(silence)', '(no audio)',
    '...', 'you know', 'i mean', 'all right', 'alright',
  ];

  if (commonArtifacts.includes(lowerText)) {
    return false;
  }

  // Filter exact matches of common artifacts
  const hallucPrefixes = ['thank you', 'thanks for', 'please subscribe', 'like and', 'see you'];
  if (hallucPrefixes.some(p => lowerText.startsWith(p))) {
    return false;
  }

  // Filter text in parentheses/brackets (Whisper annotations)
  if (/^\s*[\(\[].*[\)\]]\s*$/.test(text)) {
    return false;
  }
  
  return true;
};

// Voice Activity Detection - distinguish speech from background noise
const detectVoiceActivity = (analyser, frequencyData) => {
  analyser.getByteFrequencyData(frequencyData);
  
  const fftSize = analyser.fftSize;
  const sampleRate = analyser.context.sampleRate;
  const binWidth = sampleRate / fftSize;
  
  const voiceFundamentalStart = Math.floor(85 / binWidth);
  const voiceFundamentalEnd = Math.floor(255 / binWidth);
  const voiceFormantStart = Math.floor(300 / binWidth);
  const voiceFormantEnd = Math.floor(3400 / binWidth);
  const noiseBandEnd = Math.floor(80 / binWidth);
  
  let fundamentalEnergy = 0;
  let formantEnergy = 0;
  let noiseEnergy = 0;
  let totalEnergy = 0;
  
  for (let i = 0; i < frequencyData.length; i++) {
    const energy = frequencyData[i];
    totalEnergy += energy;
    
    if (i >= voiceFundamentalStart && i <= voiceFundamentalEnd) {
      fundamentalEnergy += energy;
    }
    if (i >= voiceFormantStart && i <= voiceFormantEnd) {
      formantEnergy += energy;
    }
    if (i <= noiseBandEnd) {
      noiseEnergy += energy;
    }
  }
  
  const avgTotal = totalEnergy / frequencyData.length;
  const avgFundamental = fundamentalEnergy / (voiceFundamentalEnd - voiceFundamentalStart + 1);
  const avgFormant = formantEnergy / (voiceFormantEnd - voiceFormantStart + 1);
  const avgNoise = noiseEnergy / (noiseBandEnd + 1);
  
  const hasEnoughEnergy = avgTotal > 5;
  const voiceStrongerThanNoise = (avgFundamental + avgFormant) / 2 > avgNoise * 1.2;
  const hasVoiceCharacteristics = avgFundamental > 8 && avgFormant > 5;
  
  return hasEnoughEnergy && voiceStrongerThanNoise && hasVoiceCharacteristics;
};

const extractSelfIntroduction = (text = '') => {
  const cleaned = String(text).trim();
  const match = cleaned.match(/\b(?:my name is|i am|i'm|this is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
  if (!match) return null;
  const name = match[1]
    .replace(/[^\p{L}\s'-]/gu, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(' ');
  if (name.length < 2 || /^(here|there|fine|good|okay|ok|sorry|calling)$/i.test(name)) return null;
  return name.replace(/\b\w/g, c => c.toUpperCase());
};

export function useSomaAudio(onResponse, visionContextRef = null, communicationCallbacks = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const [volume, setVolume] = useState(0);
  const [inputVolume, setInputVolume] = useState(0);
  const [isTalking, setIsTalking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [lastTranscript, setLastTranscript] = useState('');
  const [somaHealthy, setSomaHealthy] = useState(false);
  const [systemStatus, setSystemStatus] = useState({
    somaBackend: 'disconnected',
    whisperServer: 'disconnected',
    elevenLabs: 'disabled',
  });
  
  // Refs
  const onResponseRef = useRef(onResponse);
  useEffect(() => { onResponseRef.current = onResponse; }, [onResponse]);
  const communicationCallbacksRef = useRef(communicationCallbacks);
  useEffect(() => { communicationCallbacksRef.current = communicationCallbacks || {}; }, [communicationCallbacks]);
  
  const audioContextRef = useRef(null);
  const inputContextRef = useRef(null);
  const analyserRef = useRef(null);
  const inputAnalyserRef = useRef(null);
  const streamRef = useRef(null);
  const sourcesRef = useRef(new Set());
  const animationFrameRef = useRef(null);
  const currentVolumeRef = useRef(0);
  const currentInputVolumeRef = useRef(0);
  const conversationIdRef = useRef(getSharedSessionId());
  const cognitiveStreamRef = useRef(null);
  const elevenLabsVoiceIdRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const isSpeaking = useRef(false);
  const isUserInterrupting = useRef(false);
  const speakQueueRef = useRef(Promise.resolve());
  const voiceHistoryRef = useRef([]);           // conversation memory across turns
  const wakeWordRecRef = useRef(null);          // Web Speech rec for wake word mode
  const isInWakeWordModeRef = useRef(false);    // true = listening for "hey soma"
  const isConnectedRef = useRef(false);         // closure-safe mirror of isConnected state
  const [wakeWordActive, setWakeWordActive] = useState(false);

  // Keep isConnectedRef in sync so wake word handler always sees current state
  useEffect(() => { isConnectedRef.current = isConnected; }, [isConnected]);

  const acknowledgmentCacheRef = useRef(new Map());
  const useWebSpeechRef = useRef(false);       // true when Whisper is down
  const webSpeechRecRef = useRef(null);        // SpeechRecognition instance

  // Transcribe audio using local Whisper
  const transcribeAudio = async (audioBlob) => {
    try {
      console.log('🎤 Transcribing with Whisper...');

      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');

      const host = window.location.hostname || 'localhost';
      const response = await fetch(`http://${host}:5002/transcribe`, {
          method: 'POST',
          body: formData,
          signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
          throw new Error(`Whisper API Error: ${response.statusText}`);
      }

      const result = await response.json();

      if (!result.success || !result.text) {
        throw new Error('Invalid transcription response');
      }

      const transcript = result.text.trim();

      if (!transcript || !isValidTranscription(transcript)) {
          console.log('⚠️ Skipping transcription:', transcript);
          return;
      }
      
      console.log('📝 Heard:', transcript);
      await processWithSoma(transcript);

    } catch (e) {
      console.error('🎤 Transcription error:', e.message || e);
    }
  };

  const checkWhisperHealth = async () => {
    try {
      const host = window.location.hostname || 'localhost';
      const response = await fetch(`http://${host}:5002/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  };

  const checkSomaHealthLocal = async () => {
    try {
      // Use the project-standard /health endpoint — 8s timeout to survive heavy boot load
      const response = await fetch('/health', {
        method: 'GET',
        signal: AbortSignal.timeout(8000),
      });
      return response.ok;
    } catch {
      return false;
    }
  };

  const waitForSomaBackend = async () => {
    const maxAttempts = 30;
    const delayMs = 5000;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      setSystemStatus(prev => ({ ...prev, somaBackend: 'initializing' }));
      const healthy = await checkSomaHealthLocal();
      
      if (healthy) {
        setSystemStatus(prev => ({ ...prev, somaBackend: 'connected' }));
        setSomaHealthy(true);
        return true;
      }
      
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    setSystemStatus(prev => ({ ...prev, somaBackend: 'error' }));
    return false;
  };

  const connect = useCallback(async () => {
    try {
      console.log('🔌 Connecting to SOMA...');
      
      const backendReady = await waitForSomaBackend();
      if (!backendReady) throw new Error('SOMA backend failed to initialize.');
      
      let elevenLabsKey = null;
      let elevenLabsVoiceId = null;
      
      if (window.electronAPI) {
        elevenLabsKey = await window.electronAPI.getElevenLabsApiKey();
        elevenLabsVoiceId = await window.electronAPI.getElevenLabsVoiceId();
      } else {
        elevenLabsKey = import.meta.env.VITE_ELEVENLABS_API_KEY;
        elevenLabsVoiceId = import.meta.env.VITE_ELEVENLABS_VOICE_ID;
      }
      
      const elevenLabsInitialized = initElevenLabs(elevenLabsKey);
      elevenLabsVoiceIdRef.current = elevenLabsVoiceId;
      setSystemStatus(prev => ({ ...prev, elevenLabs: elevenLabsInitialized ? 'enabled' : 'fallback' }));
      
      const whisperHealthy = await checkWhisperHealth();
      const hasSpeechRecognition = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
      useWebSpeechRef.current = !whisperHealthy && hasSpeechRecognition;
      setSystemStatus(prev => ({
        ...prev,
        whisperServer: whisperHealthy ? 'ready' : (hasSpeechRecognition ? 'fallback' : 'error')
      }));
      
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: OUTPUT_SAMPLE_RATE });
      inputContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });

      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      analyser.connect(audioContextRef.current.destination);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const inputAnalyser = inputContextRef.current.createAnalyser();
      inputAnalyser.fftSize = 256;
      inputAnalyserRef.current = inputAnalyser;
      const source = inputContextRef.current.createMediaStreamSource(stream);
      source.connect(inputAnalyser);
      
      setIsConnected(true);
      
      const updateVolume = () => {
        if (analyserRef.current) {
          const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
          const rawVol = calculateVolume(analyserRef.current, dataArray);
          currentVolumeRef.current = lerp(currentVolumeRef.current, rawVol, 0.5);
          setVolume(currentVolumeRef.current);
        }

        if (inputAnalyserRef.current) {
          const dataArray = new Uint8Array(inputAnalyserRef.current.frequencyBinCount);
          const rawInputVol = calculateVolume(inputAnalyserRef.current, dataArray);
          const isVoice = detectVoiceActivity(inputAnalyserRef.current, dataArray);
          const filteredVol = isVoice ? rawInputVol : 0;
          currentInputVolumeRef.current = lerp(currentInputVolumeRef.current, filteredVol, 0.2);
          setInputVolume(currentInputVolumeRef.current);
        }

        animationFrameRef.current = requestAnimationFrame(updateVolume);
      };
      updateVolume();
      
    } catch (error) {
      console.error('Connection failed:', error);
      setIsConnected(false);
    }
  }, []);

  // Recording loop effect — uses Whisper if available, falls back to browser SpeechRecognition
  useEffect(() => {
    let recordingTimeout;
    let isActive = true;

    // ── Branch A: Web Speech API fallback (no Whisper) ──────────────────
    if (isConnected && useWebSpeechRef.current) {
      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRec) return;

      const rec = new SpeechRec();
      rec.continuous = true;
      rec.interimResults = false;
      rec.lang = 'en-US';
      webSpeechRecRef.current = rec;

      rec.onresult = (event) => {
        if (!isActive || !isConnected || isTalking) return;
        const transcript = event.results[event.results.length - 1][0].transcript.trim();
        if (isValidTranscription(transcript)) {
          console.log('📝 Web Speech heard:', transcript);
          processWithSoma(transcript);
        }
      };
      rec.onstart  = () => { if (isActive) setIsListening(true);  };
      rec.onend    = () => {
        setIsListening(false);
        // Auto-restart unless we stopped intentionally
        if (isActive && isConnected && !isTalking) {
          try { rec.start(); } catch (e) {}
        }
      };
      rec.onerror  = (e) => { if (e.error !== 'no-speech') console.warn('SpeechRec error:', e.error); };

      try { rec.start(); } catch (e) {}

      return () => {
        isActive = false;
        try { rec.stop(); } catch (e) {}
        webSpeechRecRef.current = null;
        setIsListening(false);
      };
    }

    // ── Branch B: Whisper (MediaRecorder → POST to localhost:5002) ───────
    const runRecordingLoop = async () => {
      if (!isActive || !isConnected || !streamRef.current) return;

      // Interruption check
      if (isTalking && inputAnalyserRef.current) {
        const dataArray = new Uint8Array(inputAnalyserRef.current.frequencyBinCount);
        const rawInputVol = calculateVolume(inputAnalyserRef.current, dataArray);
        if (rawInputVol > 0.3) {
          stopSpeaking();
          await new Promise(r => setTimeout(r, 800));
        } else {
          setTimeout(() => runRecordingLoop(), 500);
          return;
        }
      }

      // VAD Trigger
      if (inputAnalyserRef.current) {
        const dataArray = new Uint8Array(inputAnalyserRef.current.frequencyBinCount);
        if (!detectVoiceActivity(inputAnalyserRef.current, dataArray)) {
          if (isActive && isConnected && !isTalking) setTimeout(() => runRecordingLoop(), 200);
          return;
        }
      }

      try {
        audioChunksRef.current = [];
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
        const mediaRecorder = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : {});
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) audioChunksRef.current.push(event.data);
        };

        mediaRecorder.onstop = async () => {
          setIsListening(false);
          if (audioChunksRef.current.length > 0) {
            const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm;codecs=opus' });
            if (audioBlob.size > 500 && isActive && isConnected && !isTalking) {
              await transcribeAudio(audioBlob);
            }
          }
          if (isActive && isConnected && !isTalking) setTimeout(() => runRecordingLoop(), 500);
        };

        mediaRecorder.start(200);
        setIsListening(true);

        // Silence-based end-of-speech detection: stop after 1.5s of silence, max 10s
        let lastVoiceAt = Date.now();
        const SILENCE_THRESHOLD_MS = 1500;
        const MAX_RECORDING_MS = 10000;

        const silenceWatcher = setInterval(() => {
          if (!inputAnalyserRef.current || mediaRecorder.state !== 'recording') {
            clearInterval(silenceWatcher);
            return;
          }
          const dataArray = new Uint8Array(inputAnalyserRef.current.frequencyBinCount);
          if (detectVoiceActivity(inputAnalyserRef.current, dataArray)) {
            lastVoiceAt = Date.now();
          } else if (Date.now() - lastVoiceAt > SILENCE_THRESHOLD_MS) {
            clearInterval(silenceWatcher);
            clearTimeout(recordingTimeout);
            if (isActive && mediaRecorder.state === 'recording') mediaRecorder.stop();
          }
        }, 100);

        recordingTimeout = setTimeout(() => {
          clearInterval(silenceWatcher);
          if (isActive && mediaRecorder.state === 'recording') mediaRecorder.stop();
        }, MAX_RECORDING_MS);

      } catch (e) {
        if (isActive && isConnected && !isTalking) setTimeout(() => runRecordingLoop(), 2000);
      }
    };

    if (isConnected && !isTalking) {
      setTimeout(() => { if (isActive && isConnected) runRecordingLoop(); }, 1000);
    }

    return () => {
      isActive = false;
      clearTimeout(recordingTimeout);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try { mediaRecorderRef.current.stop(); } catch (e) {}
      }
    };
  }, [isConnected, isTalking]);

  const generateAcknowledgment = (query) => {
    const lower = query.toLowerCase();
    if (lower.includes('?') || lower.startsWith('how') || lower.startsWith('what') || lower.startsWith('why') || lower.startsWith('when') || lower.startsWith('where') || lower.startsWith('who')) {
      return ['Hmm.', 'Let me think on that.', 'One sec.', 'Yeah...', 'Interesting.'][Math.floor(Math.random() * 5)];
    }
    return ['Yeah.', 'Right.', 'On it.', 'Okay.', 'Got it.'][Math.floor(Math.random() * 5)];
  };

  const processWithSoma = async (query) => {
    let activeReceiptId = null;
    let activeRoute = null;
    let activeTrust = null;
    try {
      setLastTranscript(query);

      const introducedName = extractSelfIntroduction(query);
      if (introducedName) {
        somaBackend.send('presence_identity', {
          name: introducedName,
          source: 'voice_self_introduction',
          confidence: 0.86,
          timestamp: Date.now()
        });
      }

      try {
        const receiptRes = await fetch('/api/soma/communication/receipt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `Orb transmission: ${query.slice(0, 64)}`,
            text: query,
            channel: 'orb',
            context: {
              source: 'soma-orb',
              backendConnected: somaHealthy,
              voiceMode: true,
              visionActive: !!visionContextRef?.current?.lastPerception
            }
          })
        });
        const receiptData = await receiptRes.json();
        if (receiptData?.receipt) {
          activeReceiptId = receiptData.receipt.id;
          activeRoute = receiptData.receipt.route;
          activeTrust = receiptData.receipt.trust;
          communicationCallbacksRef.current?.onReceipt?.(receiptData);
        }
      } catch {
        /* communication receipts are non-blocking */
      }

      if (onResponseRef.current) {
        onResponseRef.current({ role: 'user', text: query, timestamp: Date.now(), route: activeRoute, trust: activeTrust, receiptId: activeReceiptId });
      }

      // Build vision-enriched query — inject what SOMA currently sees
      // The backend also injects vision context from system.visionContext,
      // but we add it here too so it's part of the user message for context tracking.
      let enrichedQuery = query;
      if (introducedName) {
        enrichedQuery = `[PRESENCE: The person speaking just introduced themselves as ${introducedName}. Treat them as a newly known person, speak normally, and invite conversation with one natural question about their day or what they have going on.]\n\n${enrichedQuery}`;
      }
      const remotePerson = window.somaRemotePersonContext;
      if (!introducedName && remotePerson?.recipient && Date.now() - Number(remotePerson.startedAt || 0) < 2 * 60 * 1000) {
        enrichedQuery = `[PRESENCE: This reply is probably from ${remotePerson.recipient}, who is responding locally after Owner asked SOMA through Discord to speak at home. Speak naturally to ${remotePerson.recipient}. Do not store private details unless explicitly asked to remember them.]\n\n${enrichedQuery}`;
      }
      const vc = visionContextRef?.current;
      if (vc?.lastPerception?.objects?.length) {
        const perception = vc.lastPerception;
        const channel = vc.channel || perception.channel || 'desktop';
        const channelDesc = channel === 'webcam' ? 'webcam (physical room)' : 'desktop (screen)';

        // Natural-language object list — avoid raw CLIP label recitation
        const topObjects = perception.objects
          .slice(0, 4)
          .map(o => o.label)
          .join(', ');

        let visionNote = `[VISION via ${channelDesc}: ${topObjects}`;
        if (perception.ocrText) {
          visionNote += ` — screen text: "${perception.ocrText.substring(0, 200)}"`;
        }
        visionNote += ']';
        enrichedQuery = `${visionNote}\n\n${query}`;
      }

      // Play acknowledgment immediately while stream starts
      const acknowledgment = generateAcknowledgment(query);
      speakText(acknowledgment); // intentionally not awaited — overlap with stream startup

      setIsThinking(true);
      if (activeReceiptId) {
        fetch(`/api/soma/communication/receipt/${activeReceiptId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'running' })
        }).catch(() => {});
      }
      let fullResponse = '';
      let firstSentenceReceived = false;

      try {
        const response = await fetch('/api/soma/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: enrichedQuery,
            history: voiceHistoryRef.current,
            sessionId: conversationIdRef.current
          })
        });

        if (!response.ok) throw new Error(`Stream error: ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let streamBuffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          streamBuffer += decoder.decode(value, { stream: true });
          const lines = streamBuffer.split('\n');
          streamBuffer = lines.pop(); // keep incomplete last line

          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const raw = line.slice(5).trim();
            if (!raw) continue;
            try {
              const event = JSON.parse(raw);
              if (event.sentence) {
                const clean = formatResponseForSpeech(event.sentence);
                if (clean) {
                  fullResponse += clean + ' ';
                  if (!firstSentenceReceived) {
                    firstSentenceReceived = true;
                    setIsThinking(false);
                  }
                  speakWithNaturalPacing(clean); // queue each sentence as it arrives
                }
              }
            } catch { /* malformed event */ }
          }
        }
      } catch (streamErr) {
        // Stream failed — fall back to regular chat
        console.warn('[Voice] Stream failed, falling back:', streamErr.message);
        const result = await reasonWithSoma(enrichedQuery, conversationIdRef.current, { voiceMode: true });
        setIsThinking(false);
        if (result.success && result.response) {
          fullResponse = result.response;
          await speakWithNaturalPacing(formatResponseForSpeech(fullResponse));
        } else {
          await speakText('I lost my train of thought. Can you say that again?');
          return;
        }
      }

      setIsThinking(false);

      const trimmedResponse = fullResponse.trim();
      if (onResponseRef.current && trimmedResponse) {
        onResponseRef.current({ role: 'soma', text: trimmedResponse, timestamp: Date.now(), route: activeRoute, trust: activeTrust, receiptId: activeReceiptId });
      }

      if (activeReceiptId) {
        try {
          const doneRes = await fetch(`/api/soma/communication/receipt/${activeReceiptId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'completed', response: trimmedResponse })
          });
          const doneData = await doneRes.json();
          if (doneData?.receipt) communicationCallbacksRef.current?.onReceipt?.(doneData);
        } catch {
          /* non-blocking */
        }
      }

      // Update conversation memory (keep last 10 turns = 20 messages)
      voiceHistoryRef.current = [
        ...voiceHistoryRef.current,
        { role: 'user', content: query },
        { role: 'assistant', content: trimmedResponse }
      ].slice(-20);

    } catch (error) {
      setIsThinking(false);
      if (activeReceiptId) {
        fetch(`/api/soma/communication/receipt/${activeReceiptId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'failed', error: error.message || 'Orb processing failed' })
        }).catch(() => {});
      }
      await speakText('Something went wrong on my end.');
    }
  };

  const speakWithNaturalPacing = (text) => {
    const run = async () => {
      isSpeaking.current = true;
      try {
        const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
        for (let i = 0; i < sentences.length; i++) {
          const sentence = sentences[i].trim();
          if (isUserInterrupting.current) {
            isUserInterrupting.current = false;
            return;
          }
          await speakText(sentence);
          if (i < sentences.length - 1) {
            await new Promise(r => setTimeout(r, sentence.includes('?') ? 400 : 250));
          }
        }
      } finally {
        isSpeaking.current = false;
      }
    };
    // Queue: each call waits for the previous to finish — no two voices at once
    speakQueueRef.current = speakQueueRef.current.then(run, run);
    return speakQueueRef.current;
  };

  const stopSpeaking = useCallback(() => {
    sourcesRef.current.forEach(source => {
      try { source.stop(); source.disconnect(); } catch (e) {}
    });
    sourcesRef.current.clear();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    setIsTalking(false);
    isUserInterrupting.current = true;
  }, []);

  const speakText = async (text) => {
    if (!audioContextRef.current || !analyserRef.current) return;

    setIsTalking(true);
    const ctx = audioContextRef.current;
    let audioBuffer = null;

    // ── 🔱 Tier 1: Project Siren (Paula Proxy - Port 8081) ─────────────────
    try {
        const host = window.location.hostname || 'localhost';
        const sirenRes = await fetch(`http://${host}:8081/v1/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, voice: 'paula' }),
            signal: AbortSignal.timeout(45000)
        });
        if (sirenRes.ok) {
            const arrayBuffer = await sirenRes.arrayBuffer();
            audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        }
    } catch (e) {
        console.warn('[Vocal] Project Siren offline, trying fallbacks...');
    }

    // ── Tier 2: ElevenLabs ──────────────────────────────────────────
    if (!audioBuffer && isElevenLabsEnabled()) {
      try {
        const result = await textToSpeech(text, ctx, elevenLabsVoiceIdRef.current);
        if (result.success) audioBuffer = result.audioBuffer;
      } catch (e) { /* fall through to browser TTS */ }
    }

    // ── Tier 3: Browser Fallback (Strict Female Persona Lock) ─────────
    if (!audioBuffer) {
      await new Promise((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text);
        
        // Mandatory Voice Load Wait
        const setVoice = () => {
            const voices = window.speechSynthesis.getVoices();
            // Filter for Samantha (Mac), Aria/Zira (Win), or any high-quality US Female
            const femaleVoice = voices.find(v => 
                (v.name.includes('Samantha') || v.name.includes('Aria') || v.name.includes('Zira') || v.name.toLowerCase().includes('female') || v.name.includes('Natural')) && 
                v.lang.includes('en-US') && 
                !v.name.includes('en-GB') && 
                !v.name.toLowerCase().includes('george') &&
                !v.name.toLowerCase().includes('male')
            );
            if (femaleVoice) {
                utterance.voice = femaleVoice;
                console.log(`[Vocal] Persona Lock: ${femaleVoice.name}`);
            } else {
                console.warn('[Vocal] Stricter persona lock failed, using first available female-tuned voice.');
                const backupFemale = voices.find(v => v.name.toLowerCase().includes('female') || v.lang.includes('en-US'));
                if (backupFemale) utterance.voice = backupFemale;
            }
            
            utterance.pitch = 1.18; // Keep her characteristic slight high pitch
            utterance.rate = 1.05;
            utterance.volume = 1.0;
        };

        if (window.speechSynthesis.getVoices().length === 0) {
            window.speechSynthesis.onvoiceschanged = () => {
                setVoice();
                window.speechSynthesis.speak(utterance);
            };
        } else {
            setVoice();
            window.speechSynthesis.speak(utterance);
        }

        utterance.onend  = () => { setIsTalking(false); resolve(); };
        utterance.onerror = () => { setIsTalking(false); resolve(); };
      });
      return;
    }

    await new Promise((resolve) => {
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(analyserRef.current);
      source.onended = () => {
        sourcesRef.current.delete(source);
        if (sourcesRef.current.size === 0) setIsTalking(false);
        resolve();
      };
      source.start(0);
      sourcesRef.current.add(source);
    });
  };

  // ── Wake word: require "hey soma" — "soma" alone false-positives constantly ─
  const WAKE_PATTERNS = /\b(hey\s*soma|hay\s*soma|hey\s*sofa)\b/i;

  const startWakeWordListening = useCallback(() => {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec || isInWakeWordModeRef.current) return;

    isInWakeWordModeRef.current = true;
    setWakeWordActive(true);

    const rec = new SpeechRec();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    wakeWordRecRef.current = rec;

    rec.onresult = async (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (WAKE_PATTERNS.test(transcript)) {
          stopWakeWordListening();
          console.log('[WakeWord] Activated — transcript:', transcript);

          // Connect mic + audio pipeline if not already active
          if (!isConnectedRef.current) {
            try { await connect(); } catch { /* mic may already be connecting */ }
          }

          // Ask SOMA to generate a natural greeting via the streaming endpoint
          try {
            const greetRes = await fetch('/api/soma/chat/stream', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message: '[WAKE_WORD] Owner just said your name to get your attention. Respond with a natural, genuine greeting — 1-2 spoken sentences, be yourself. No preamble, no "Certainly", just speak naturally.',
                history: voiceHistoryRef.current.slice(-4),
                sessionId: conversationIdRef.current
              }),
              signal: AbortSignal.timeout(8000)
            });

            if (greetRes.ok) {
              const reader = greetRes.body.getReader();
              const decoder = new TextDecoder();
              let buf = '';
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });
                const lines = buf.split('\n');
                buf = lines.pop();
                for (const line of lines) {
                  if (!line.startsWith('data:')) continue;
                  const raw = line.slice(5).trim();
                  if (!raw) continue;
                  try {
                    const ev = JSON.parse(raw);
                    if (ev.sentence) speakWithNaturalPacing(ev.sentence);
                  } catch {}
                }
              }
            } else {
              speakText('Yeah?').catch(() => {});
            }
          } catch {
            speakText('Yeah?').catch(() => {});
          }
          return;
        }
      }
    };

    rec.onend = () => {
      // Auto-restart unless we intentionally stopped
      if (isInWakeWordModeRef.current) {
        setTimeout(() => {
          if (isInWakeWordModeRef.current && wakeWordRecRef.current === rec) {
            try { rec.start(); } catch { /* already started */ }
          }
        }, 300);
      }
    };

    rec.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        console.warn('[WakeWord] Error:', e.error);
      }
    };

    try { rec.start(); } catch { /* browser may need gesture first */ }
  }, []);

  const stopWakeWordListening = useCallback(() => {
    isInWakeWordModeRef.current = false;
    setWakeWordActive(false);
    if (wakeWordRecRef.current) {
      try { wakeWordRecRef.current.stop(); } catch {}
      wakeWordRecRef.current = null;
    }
  }, []);

  const disconnect = useCallback(() => {
    stopWakeWordListening();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') mediaRecorderRef.current.stop();
    if (webSpeechRecRef.current) { try { webSpeechRecRef.current.stop(); } catch (e) {} webSpeechRecRef.current = null; }
    if (cognitiveStreamRef.current) { cognitiveStreamRef.current.disconnect(); cognitiveStreamRef.current = null; }
    if (audioContextRef.current) { audioContextRef.current.close(); audioContextRef.current = null; }
    if (inputContextRef.current) { inputContextRef.current.close(); inputContextRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    sourcesRef.current.forEach(s => { try { s.stop(); } catch (e) {} });
    sourcesRef.current.clear();
    window.speechSynthesis.cancel();
    speakQueueRef.current = Promise.resolve();
    isSpeaking.current = false;
    isUserInterrupting.current = false;
    voiceHistoryRef.current = [];
    setIsConnected(false);
    setIsTalking(false);
    setIsListening(false);
    setVolume(0);
    setInputVolume(0);
    setWakeWordActive(false);
    setSystemStatus({ somaBackend: 'disconnected', whisperServer: 'disconnected', elevenLabs: 'disabled' });
  }, [stopWakeWordListening]);

  const sendTextQuery = useCallback((text) => processWithSoma(text), []);

  // Unmount cleanup — stop mic, close audio contexts, cancel rAF loop
  useEffect(() => () => disconnect(), [disconnect]);

  // Periodic Whisper re-check (every 60s) — auto-upgrade from browser STT if Whisper comes online
  useEffect(() => {
    if (!isConnected || !useWebSpeechRef.current) return; // only run when on fallback
    const timer = setInterval(async () => {
      const healthy = await checkWhisperHealth();
      if (healthy) {
        console.log('[Voice] Whisper came online — switching from browser STT');
        useWebSpeechRef.current = false;
        setSystemStatus(prev => ({ ...prev, whisperServer: 'ready' }));
        // Stop browser STT so the recording loop effect re-evaluates on next reconnect
        if (webSpeechRecRef.current) {
          try { webSpeechRecRef.current.stop(); } catch (e) {}
          webSpeechRecRef.current = null;
        }
        clearInterval(timer);
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [isConnected]);

  return {
    isConnected, connect, disconnect, volume, inputVolume,
    isTalking, isListening, isThinking, lastTranscript, systemStatus,
    sendTextQuery, somaHealthy, speakText,
    wakeWordActive, startWakeWordListening, stopWakeWordListening
  };
}
