import { useState, useRef, useEffect, useCallback } from 'react';
import { initElevenLabs, textToSpeech, isElevenLabsEnabled } from '../utils/elevenLabsTTS';
import { reasonWithSoma, checkSomaHealth, formatResponseForSpeech, SomaCognitiveStream } from '../utils/somaClient';

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

export function useSomaAudio(onResponse) {
  const [isConnected, setIsConnected] = useState(false);
  const [volume, setVolume] = useState(0); 
  const [inputVolume, setInputVolume] = useState(0); 
  const [isTalking, setIsTalking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [somaHealthy, setSomaHealthy] = useState(false);
  const [systemStatus, setSystemStatus] = useState({
    somaBackend: 'disconnected',
    whisperServer: 'disconnected',
    elevenLabs: 'disabled',
  });
  
  // Refs
  const onResponseRef = useRef(onResponse);
  useEffect(() => { onResponseRef.current = onResponse; }, [onResponse]);
  
  const audioContextRef = useRef(null);
  const inputContextRef = useRef(null);
  const analyserRef = useRef(null);
  const inputAnalyserRef = useRef(null);
  const streamRef = useRef(null);
  const sourcesRef = useRef(new Set());
  const animationFrameRef = useRef(null);
  const currentVolumeRef = useRef(0);
  const currentInputVolumeRef = useRef(0);
  const conversationIdRef = useRef(`conv_${Date.now()}`);
  const cognitiveStreamRef = useRef(null);
  const elevenLabsVoiceIdRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const isSpeaking = useRef(false);
  const isUserInterrupting = useRef(false);
  
  const acknowledgmentCacheRef = useRef(new Map());
  const useWebSpeechRef = useRef(false);       // true when Whisper is down
  const webSpeechRecRef = useRef(null);        // SpeechRecognition instance

  // Transcribe audio using local Whisper
  const transcribeAudio = async (audioBlob) => {
    try {
      console.log('🎤 Transcribing with Whisper...');

      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');

      const response = await fetch('http://localhost:5002/transcribe', {
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
      const response = await fetch('http://localhost:5002/health', {
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
      // Use the project-standard /health endpoint
      const response = await fetch('/health', {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch (error) {
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
      
      try {
        const cogStream = new SomaCognitiveStream();
        await cogStream.connect();
        cognitiveStreamRef.current = cogStream;
      } catch (error) {
        console.warn('Cognitive stream connection failed');
      }
      
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
        const mediaRecorder = new MediaRecorder(streamRef.current, { mimeType: 'audio/webm;codecs=opus' });
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

        mediaRecorder.start(500);
        setIsListening(true);

        recordingTimeout = setTimeout(() => {
          if (isActive && mediaRecorder.state === 'recording') mediaRecorder.stop();
        }, 4000);

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
    if (lower.includes('?') || lower.startsWith('how') || lower.startsWith('what')) {
      return ['Good question.', 'Let me think.', 'Hmm.', 'Let me see.'][Math.floor(Math.random() * 4)];
    }
    return ['Sure.', 'Okay.', 'Got it.', 'Right.'][Math.floor(Math.random() * 4)];
  };

  const processWithSoma = async (query) => {
    try {
      if (onResponseRef.current) {
        onResponseRef.current({ role: 'user', text: query, timestamp: Date.now() });
      }

      const acknowledgment = generateAcknowledgment(query);
      speakText(acknowledgment);

      setIsThinking(true);
      const result = await reasonWithSoma(query, conversationIdRef.current);
      setIsThinking(false);

      if (!result.success || !result.response) {
        const errorMsg = 'I lost my train of thought. Can you say that again?';
        if (onResponseRef.current) {
          onResponseRef.current({ role: 'soma', text: errorMsg, timestamp: Date.now() });
        }
        await speakText(errorMsg);
        return;
      }

      if (onResponseRef.current) {
        onResponseRef.current({ 
          role: 'soma', 
          text: result.response, 
          timestamp: Date.now(),
          reasoningTree: result.reasoningTree || null
        });
      }

      const textToSpeak = formatResponseForSpeech(result.response);
      await speakWithNaturalPacing(textToSpeak);

    } catch (error) {
      setIsThinking(false);
      await speakText('Something went wrong on my end.');
    }
  };

  const speakWithNaturalPacing = async (text) => {
    while (isSpeaking.current) await new Promise(r => setTimeout(r, 100));
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
    return new Promise(async (resolve) => {
      if (!audioContextRef.current || !analyserRef.current) return resolve();
      
      setIsTalking(true);
      const ctx = audioContextRef.current;
      let audioBuffer = null;

      if (isElevenLabsEnabled()) {
        const result = await textToSpeech(text, ctx, elevenLabsVoiceIdRef.current);
        if (result.success) audioBuffer = result.audioBuffer;
      }

      if (!audioBuffer) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.1;
        utterance.onend = () => { setIsTalking(false); resolve(); };
        utterance.onerror = () => { setIsTalking(false); resolve(); };
        window.speechSynthesis.speak(utterance);
        return;
      }

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

  const disconnect = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') mediaRecorderRef.current.stop();
    if (cognitiveStreamRef.current) cognitiveStreamRef.current.disconnect();
    if (audioContextRef.current) audioContextRef.current.close();
    if (inputContextRef.current) inputContextRef.current.close();
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    sourcesRef.current.forEach(s => { try { s.stop(); } catch (e) {} });
    sourcesRef.current.clear();
    window.speechSynthesis.cancel();
    setIsConnected(false);
    setIsTalking(false);
    setIsListening(false);
    setVolume(0);
    setInputVolume(0);
  }, []);

  const sendTextQuery = useCallback((text) => processWithSoma(text), []);

  return {
    isConnected, connect, disconnect, volume, inputVolume,
    isTalking, isListening, isThinking, systemStatus,
    sendTextQuery, somaHealthy
  };
}
