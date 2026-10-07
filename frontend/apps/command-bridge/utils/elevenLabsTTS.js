let elevenLabsApiKey = null;
let useElevenLabs = true; // Flag to track if we should try ElevenLabs

/**
 * Initialize ElevenLabs client with API key
 */
export function initElevenLabs(apiKey) {
  if (!apiKey) {
    console.log('No ElevenLabs API key provided, will use browser voice');
    useElevenLabs = false;
    return false;
  }
  
  elevenLabsApiKey = apiKey;
  useElevenLabs = true;
  console.log('✅ ElevenLabs initialized with API key');
  return true;
}

/**
 * Convert text to speech using ElevenLabs
 * Falls back gracefully if credits are exhausted or service fails
 */
export async function textToSpeech(
  text,
  audioContext,
  voiceId,
  emotion
) {
  // If ElevenLabs is disabled or not initialized, return failure immediately
  if (!useElevenLabs || !elevenLabsApiKey) {
    return { 
      success: false, 
      error: 'ElevenLabs not available',
      usedFallback: true 
    };
  }

  try {
    console.log('Attempting ElevenLabs TTS for:', text.substring(0, 50) + '...');
    
    // Calculate dynamic voice settings based on emotion
    let stability = 0.5;
    let similarity_boost = 0.75;
    let style = 0.0;

    if (emotion) {
        // High energy = Lower stability (more expressive/varied)
        if (emotion.energy && emotion.energy > 0.7) {
            stability = 0.35;
            style = 0.5;
        } else if (emotion.energy && emotion.energy < 0.4) {
            stability = 0.8;
            style = 0.0;
        }
        // Direct overrides take precedence
        if (emotion.stability !== undefined) stability = emotion.stability;
        if (emotion.similarity_boost !== undefined) similarity_boost = emotion.similarity_boost;
        if (emotion.style !== undefined) style = emotion.style;
    }

    console.log(`🎙️ Voice Settings: Stability=${stability}, Style=${style}`);
    
    // Use provided voice ID or default to env/hardcoded
    const selectedVoiceId = voiceId || 
                           import.meta.env.VITE_ELEVENLABS_VOICE_ID || 
                           '21m00Tcm4TlvDq8ikWAM'; // Rachel
                           
    console.log('Using ElevenLabs voice:', selectedVoiceId);
    console.log('Using API Key:', elevenLabsApiKey ? '***' + elevenLabsApiKey.slice(-4) : 'MISSING');
    
    // Call ElevenLabs REST API directly
    // optimize_streaming_latency: 0 (default) to 4 (max speed)
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoiceId}?optimize_streaming_latency=3&output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': elevenLabsApiKey,
        },
        body: JSON.stringify({
          text: text,
          model_id: 'eleven_turbo_v2_5', // Newer model available on free tier
          voice_settings: {
            stability,
            similarity_boost,
            style,
            use_speaker_boost: true
          },
        }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('ElevenLabs API Error Details:', errorBody);
      throw new Error(`ElevenLabs API error: ${response.status} - ${errorBody}`);
    }

    // Get audio data as array buffer
    const arrayBuffer = await response.arrayBuffer();
    
    // Decode audio data to AudioBuffer
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    console.log('✅ ElevenLabs TTS successful');
    return { success: true, audioBuffer, usedFallback: false };
    
  } catch (error) {
    console.error('ElevenLabs TTS failed:', error);
    
    // Check if it's a quota/credit issue
    if (error.status === 401 || error.status === 429 || 
        (error.message && (error.message.includes('quota') || error.message.includes('credit')))) {
      console.warn('ElevenLabs credits exhausted, switching to Gemini voice permanently');
      useElevenLabs = false; // Disable for the rest of the session
    }
    
    return { 
      success: false, 
      error: error.message || 'ElevenLabs TTS failed',
      usedFallback: true 
    };
  }
}

/**
 * Get whether ElevenLabs is currently enabled
 */
export function isElevenLabsEnabled() {
  return useElevenLabs && elevenLabsApiKey !== null;
}

/**
 * Manually disable ElevenLabs (e.g., after repeated failures)
 */
export function disableElevenLabs() {
  useElevenLabs = false;
  console.log('ElevenLabs disabled');
}

/**
 * Re-enable ElevenLabs (e.g., on reconnection or user request)
 */
export function enableElevenLabs() {
  if (elevenLabsApiKey) {
    useElevenLabs = true;
    console.log('ElevenLabs re-enabled');
  }
}