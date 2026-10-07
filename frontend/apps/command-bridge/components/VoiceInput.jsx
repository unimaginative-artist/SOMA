/**
 * Voice Input Component
 * AUTOGEN Integration: Whisper Audio Processing
 *
 * Allows users to record voice input, transcribe it using Whisper,
 * and use the text for queries or commands
 */

import React, { useState, useRef, useEffect } from 'react';

export const VoiceInput = ({ onTranscription, disabled = false }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [recordingTime, setRecordingTime] = useState(0);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  const startRecording = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await transcribeAudio(audioBlob);

        // Stop all tracks to release microphone
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (err) {
      console.error('Microphone access error:', err);
      setError('Failed to access microphone. Please check permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  const transcribeAudio = async (audioBlob) => {
    setIsProcessing(true);
    setError(null);

    try {
      // Convert blob to base64
      const reader = new FileReader();
      const base64Promise = new Promise((resolve, reject) => {
        reader.onloadend = () => {
          const base64 = reader.result.split(',')[1]; // Remove data:audio/webm;base64, prefix
          resolve(base64);
        };
        reader.onerror = reject;
      });

      reader.readAsDataURL(audioBlob);
      const audioData = await base64Promise;

      // Send to Whisper API
      const response = await fetch('/api/audio/transcribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          audioData,
          language: 'en', // or auto-detect
          options: {
            format: 'json'
          }
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.success && result.text) {
        onTranscription(result.text);
      } else {
        throw new Error('Transcription failed');
      }

    } catch (err) {
      console.error('Transcription error:', err);
      setError(`Transcription failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="voice-input-container">
      <style>{`
        .voice-input-container {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .voice-button {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          border: 2px solid;
          background: transparent;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          transition: all 0.2s;
          position: relative;
        }

        .voice-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .voice-button.recording {
          border-color: #ef4444;
          background: rgba(239, 68, 68, 0.1);
          animation: pulse 1.5s ease-in-out infinite;
        }

        .voice-button:not(.recording):not(:disabled):hover {
          border-color: #3b82f6;
          background: rgba(59, 130, 246, 0.1);
        }

        .voice-button.processing {
          border-color: #f59e0b;
          background: rgba(245, 158, 11, 0.1);
        }

        @keyframes pulse {
          0%, 100% {
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7);
          }
          50% {
            box-shadow: 0 0 0 10px rgba(239, 68, 68, 0);
          }
        }

        .voice-status {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .voice-timer {
          font-family: monospace;
          font-size: 14px;
          color: #ef4444;
          font-weight: 600;
        }

        .voice-hint {
          font-size: 12px;
          color: #6b7280;
        }

        .voice-error {
          font-size: 12px;
          color: #ef4444;
          max-width: 250px;
        }

        .processing-spinner {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>

      {/* Voice Input Button */}
      <button
        className={`voice-button ${isRecording ? 'recording' : ''} ${isProcessing ? 'processing' : ''}`}
        onClick={isRecording ? stopRecording : startRecording}
        disabled={disabled || isProcessing}
        title={isRecording ? 'Stop recording' : 'Start voice input'}
      >
        {isProcessing ? (
          <span className="processing-spinner">⏳</span>
        ) : isRecording ? (
          <span>⏹️</span>
        ) : (
          <span>🎤</span>
        )}
      </button>

      {/* Status Display */}
      <div className="voice-status">
        {isRecording && (
          <>
            <div className="voice-timer">
              {formatTime(recordingTime)}
            </div>
            <div className="voice-hint">
              Click to stop recording
            </div>
          </>
        )}

        {isProcessing && (
          <div className="voice-hint">
            Transcribing audio...
          </div>
        )}

        {!isRecording && !isProcessing && !error && (
          <div className="voice-hint">
            Click microphone to start
          </div>
        )}

        {error && (
          <div className="voice-error">
            {error}
          </div>
        )}
      </div>
    </div>
  );
};

export default VoiceInput;
