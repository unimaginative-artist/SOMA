/**
 * Society of Mind Debate UI
 * AUTOGEN Integration: Visualizes internal debates between brain hemispheres
 *
 * Shows how THALAMUS, LOGOS, AURORA, and PROMETHEUS debate internally
 * before reaching a final decision
 */

import React, { useState } from 'react';

export const SocietyOfMindDebate = ({ onDebate }) => {
  const [query, setQuery] = useState('');
  const [isDebating, setIsDebating] = useState(false);
  const [debateResult, setDebateResult] = useState(null);
  const [error, setError] = useState(null);

  const startDebate = async () => {
    if (!query.trim()) {
      setError('Please enter a question or decision to debate');
      return;
    }

    setIsDebating(true);
    setError(null);
    setDebateResult(null);

    try {
      const response = await fetch('/api/soma/debate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: query.trim(),
          context: {}
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.success) {
        setDebateResult(result);
        if (onDebate) {
          onDebate(result);
        }
      } else {
        throw new Error('Debate failed');
      }

    } catch (err) {
      console.error('Debate error:', err);
      setError(`Debate failed: ${err.message}`);
    } finally {
      setIsDebating(false);
    }
  };

  const getBrainColor = (speaker) => {
    if (speaker.includes('THALAMUS')) return '#ef4444'; // Red - Security
    if (speaker.includes('LOGOS')) return '#3b82f6'; // Blue - Analytical
    if (speaker.includes('AURORA')) return '#a78bfa'; // Purple - Creative
    if (speaker.includes('PROMETHEUS')) return '#f59e0b'; // Orange - Strategic
    return '#6b7280'; // Gray - Default
  };

  const getBrainIcon = (speaker) => {
    if (speaker.includes('THALAMUS')) return '🛡️';
    if (speaker.includes('LOGOS')) return '🧮';
    if (speaker.includes('AURORA')) return '✨';
    if (speaker.includes('PROMETHEUS')) return '🎯';
    return '🧠';
  };

  return (
    <div className="society-of-mind-container">
      <style>{`
        .society-of-mind-container {
          display: flex;
          flex-direction: column;
          gap: 20px;
          padding: 20px;
          background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .debate-header {
          text-align: center;
        }

        .debate-title {
          font-size: 24px;
          font-weight: 700;
          background: linear-gradient(135deg, #3b82f6, #8b5cf6);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          margin-bottom: 8px;
        }

        .debate-subtitle {
          font-size: 14px;
          color: #94a3b8;
        }

        .debate-input-section {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .debate-input {
          width: 100%;
          padding: 12px 16px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          color: #e2e8f0;
          font-size: 14px;
          resize: vertical;
          min-height: 80px;
        }

        .debate-input:focus {
          outline: none;
          border-color: #3b82f6;
        }

        .debate-button {
          padding: 12px 24px;
          background: linear-gradient(135deg, #3b82f6, #8b5cf6);
          border: none;
          border-radius: 8px;
          color: white;
          font-weight: 600;
          cursor: pointer;
          transition: transform 0.2s, opacity 0.2s;
        }

        .debate-button:hover:not(:disabled) {
          transform: translateY(-2px);
        }

        .debate-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .debate-results {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .debate-perspectives {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .perspective-card {
          padding: 16px;
          background: rgba(255, 255, 255, 0.03);
          border-left: 4px solid;
          border-radius: 8px;
          animation: fadeIn 0.3s ease-out;
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .perspective-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
        }

        .perspective-icon {
          font-size: 20px;
        }

        .perspective-speaker {
          font-weight: 600;
          font-size: 14px;
        }

        .perspective-confidence {
          margin-left: auto;
          padding: 4px 8px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 4px;
          font-size: 12px;
          font-weight: 600;
        }

        .perspective-text {
          font-size: 14px;
          line-height: 1.6;
          color: #cbd5e1;
        }

        .final-decision {
          padding: 20px;
          background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(139, 92, 246, 0.1));
          border: 2px solid rgba(59, 130, 246, 0.3);
          border-radius: 12px;
          animation: fadeIn 0.5s ease-out;
        }

        .decision-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
        }

        .decision-title {
          font-size: 18px;
          font-weight: 700;
          color: #3b82f6;
        }

        .decision-meta {
          display: flex;
          gap: 12px;
          font-size: 12px;
          color: #94a3b8;
        }

        .decision-text {
          font-size: 14px;
          line-height: 1.7;
          color: #e2e8f0;
        }

        .error-message {
          padding: 12px;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.3);
          border-radius: 8px;
          color: #f87171;
          font-size: 14px;
        }

        .loading-indicator {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 20px;
          color: #94a3b8;
        }

        .loading-spinner {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div className="debate-header">
        <div className="debate-title">🧠 Society of Mind</div>
        <div className="debate-subtitle">
          Internal debate between all 4 brain hemispheres
        </div>
      </div>

      <div className="debate-input-section">
        <textarea
          className="debate-input"
          placeholder="Enter a decision or question to debate internally...&#10;&#10;Example: Should we use React or Vue for our new dashboard?"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={isDebating}
        />

        <button
          className="debate-button"
          onClick={startDebate}
          disabled={isDebating || !query.trim()}
        >
          {isDebating ? '⏳ Debating...' : '🎭 Start Internal Debate'}
        </button>
      </div>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {isDebating && (
        <div className="loading-indicator">
          <span className="loading-spinner">⚙️</span>
          <span>Brains are debating internally...</span>
        </div>
      )}

      {debateResult && (
        <div className="debate-results">
          <div className="debate-perspectives">
            {debateResult.debate.map((perspective, index) => (
              <div
                key={index}
                className="perspective-card"
                style={{ borderLeftColor: getBrainColor(perspective.speaker) }}
              >
                <div className="perspective-header">
                  <span className="perspective-icon">{getBrainIcon(perspective.speaker)}</span>
                  <span
                    className="perspective-speaker"
                    style={{ color: getBrainColor(perspective.speaker) }}
                  >
                    {perspective.speaker}
                  </span>
                  <span className="perspective-confidence">
                    {Math.round(perspective.confidence * 100)}% confident
                  </span>
                </div>
                <div className="perspective-text">
                  {perspective.perspective}
                </div>
              </div>
            ))}
          </div>

          <div className="final-decision">
            <div className="decision-header">
              <div className="decision-title">📋 Final Decision</div>
              <div className="decision-meta">
                <span>{Math.round(debateResult.duration / 1000)}s</span>
                <span>•</span>
                <span>{Math.round(debateResult.confidence * 100)}% confidence</span>
              </div>
            </div>
            <div className="decision-text">
              {debateResult.decision}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SocietyOfMindDebate;
