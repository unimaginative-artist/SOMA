import React, { useState, useEffect } from 'react';
import '../styles/ApprovalQueue.css';

export const ApprovalQueue = ({ socket }) => {
  const [queue, setQueue] = useState([]);
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [expandedItems, setExpandedItems] = useState(new Set());
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!socket) return;

    // Listen for new approval requests
    socket.on('approval_required', (request) => {
      setQueue(prev => [...prev, request]);
      
      // Auto-remove after timeout
      setTimeout(() => {
        setQueue(prev => prev.filter(r => r.id !== request.id));
      }, 60000);
    });

    return () => {
      socket.off('approval_required');
    };
  }, [socket]);

  const getRiskLevel = (score) => {
    if (score < 0.3) return { color: 'green', icon: '🟢', label: 'Safe' };
    if (score < 0.6) return { color: 'yellow', icon: '🟡', label: 'Caution' };
    return { color: 'red', icon: '🔴', label: 'Danger' };
  };

  const getTrustLevel = (score) => {
    if (score > 0.8) return { icon: '⭐⭐⭐', label: 'Highly Trusted' };
    if (score > 0.5) return { icon: '⭐⭐', label: 'Trusted' };
    if (score > 0.2) return { icon: '⭐', label: 'Some Trust' };
    return { icon: '❓', label: 'Unknown' };
  };

  const handleApprove = (id, remember = false) => {
    socket.emit('approval_response', {
      approvalId: id,
      response: {
        approved: true,
        rememberPattern: remember,
        reason: 'user_approved'
      }
    });
    setQueue(prev => prev.filter(r => r.id !== id));
    setSelectedItems(prev => {
      const newSet = new Set(prev);
      newSet.delete(id);
      return newSet;
    });
  };

  const handleDeny = (id, remember = false) => {
    socket.emit('approval_response', {
      approvalId: id,
      response: {
        approved: false,
        rememberPattern: remember,
        reason: 'user_denied'
      }
    });
    setQueue(prev => prev.filter(r => r.id !== id));
    setSelectedItems(prev => {
      const newSet = new Set(prev);
      newSet.delete(id);
      return newSet;
    });
  };

  const handleBatchApprove = () => {
    selectedItems.forEach(id => handleApprove(id, false));
    setSelectedItems(new Set());
  };

  const handleBatchDeny = () => {
    selectedItems.forEach(id => handleDeny(id, false));
    setSelectedItems(new Set());
  };

  const toggleSelection = (id) => {
    setSelectedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const toggleExpand = (id) => {
    setExpandedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const getTimeRemaining = (expiresAt) => {
    const remaining = Math.max(0, expiresAt - now);
    const seconds = Math.floor(remaining / 1000);
    return `${seconds}s`;
  };

  if (queue.length === 0) {
    return null; // Don't show if no approvals pending
  }

  return (
    <div className="approval-queue-container" role="region" aria-label="SOMA approval requests" aria-live="polite">
      <div className="approval-queue-header">
        <h3>🛡️ SOMA Needs Approval ({queue.length})</h3>
        {selectedItems.size > 0 && (
          <div className="batch-actions">
            <button 
              className="batch-approve-btn" 
              onClick={handleBatchApprove}
              title="Approve selected items"
            >
              ✅ Approve {selectedItems.size}
            </button>
            <button 
              className="batch-deny-btn" 
              onClick={handleBatchDeny}
              title="Deny selected items"
            >
              ❌ Deny {selectedItems.size}
            </button>
          </div>
        )}
      </div>

      <div className="approval-queue-list">
        {queue.map(request => {
          const risk = getRiskLevel(request.riskScore);
          const trust = getTrustLevel(request.trustScore);
          const isExpanded = expandedItems.has(request.id);
          const isSelected = selectedItems.has(request.id);

          return (
            <div 
              key={request.id} 
              className={`approval-item ${risk.color} ${isSelected ? 'selected' : ''}`}
            >
              {/* Header */}
              <div className="approval-item-header">
                  <input
                  type="checkbox" 
                  checked={isSelected}
                  onChange={() => toggleSelection(request.id)}
                    className="approval-checkbox"
                    aria-label={`Select approval for ${request.action}`}
                />
                
                <div className="approval-info" onClick={() => toggleExpand(request.id)}>
                  <div className="approval-action">
                    <span className="risk-icon">{risk.icon}</span>
                    <strong>{request.action}</strong>
                  </div>
                  <div className="approval-meta">
                    <span className="risk-label">{risk.label}</span>
                    <span className="trust-label">{trust.icon} {trust.label}</span>
                    <span className="type-badge">{request.type}</span>
                  </div>
                </div>

                <div className="approval-timer">
                  ⏱️ {getTimeRemaining(request.expiresAt)}
                </div>
              </div>

              {/* Expanded Details */}
              {isExpanded && (
                <div className="approval-details">
                  <div className="details-section">
                    <h4>Details:</h4>
                    <pre className="details-code">
                      {JSON.stringify(request.details, null, 2)}
                    </pre>
                  </div>

                  <div className="risk-breakdown">
                    <div className="risk-bar-container">
                      <label>Risk Score:</label>
                      <div className="risk-bar">
                        <div 
                          className={`risk-bar-fill ${risk.color}`}
                          style={{ width: `${request.riskScore * 100}%` }}
                        />
                      </div>
                      <span>{(request.riskScore * 100).toFixed(0)}%</span>
                    </div>

                    <div className="trust-bar-container">
                      <label>Trust Score:</label>
                      <div className="trust-bar">
                        <div 
                          className="trust-bar-fill"
                          style={{ width: `${request.trustScore * 100}%` }}
                        />
                      </div>
                      <span>{(request.trustScore * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="approval-actions">
                <button 
                  className="approve-btn"
                  onClick={() => handleApprove(request.id, false)}
                  title="Approve this operation"
                >
                  ✅ Approve
                </button>
                
                <button 
                  className="approve-remember-btn"
                  onClick={() => handleApprove(request.id, true)}
                  title="Approve and remember this pattern"
                >
                  ✅ Always Allow
                </button>

                <button 
                  className="deny-btn"
                  onClick={() => handleDeny(request.id, false)}
                  title="Deny this operation"
                >
                  ❌ Deny
                </button>

                <button 
                  className="deny-remember-btn"
                  onClick={() => handleDeny(request.id, true)}
                  title="Deny and remember this pattern"
                >
                  ❌ Never Allow
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
