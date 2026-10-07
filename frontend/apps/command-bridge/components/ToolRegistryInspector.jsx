/**
 * Tool Registry Inspector
 * AUTOGEN Integration: View and manage dynamically registered tools
 *
 * Shows all tools Steve can create and use on-the-fly
 */

import React, { useState, useEffect } from 'react';

export const ToolRegistryInspector = () => {
  const [tools, setTools] = useState([]);
  const [selectedTool, setSelectedTool] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchTools();
  }, []);

  const fetchTools = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/tools/list');

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      // For now, show placeholder data since integration is pending
      if (result.message && result.message.includes('pending')) {
        setTools([
          {
            name: 'http_request',
            description: 'Make HTTP requests to external APIs',
            category: 'network',
            usageCount: 42,
            createdBy: 'system'
          },
          {
            name: 'read_file',
            description: 'Read contents of a file',
            category: 'filesystem',
            usageCount: 138,
            createdBy: 'system'
          },
          {
            name: 'execute_command',
            description: 'Execute a shell command (use with caution)',
            category: 'system',
            usageCount: 7,
            createdBy: 'system'
          },
          {
            name: 'calculator',
            description: 'Perform mathematical calculations safely',
            category: 'utility',
            usageCount: 23,
            createdBy: 'system'
          }
        ]);
      } else {
        setTools(result.tools || []);
      }

    } catch (err) {
      console.error('Failed to fetch tools:', err);
      setError(`Failed to load tools: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const getCategoryColor = (category) => {
    const colors = {
      network: '#3b82f6',
      filesystem: '#10b981',
      system: '#ef4444',
      utility: '#f59e0b',
      analysis: '#8b5cf6',
      custom: '#6b7280'
    };
    return colors[category] || colors.custom;
  };

  const getCategoryIcon = (category) => {
    const icons = {
      network: '🌐',
      filesystem: '📁',
      system: '⚙️',
      utility: '🔧',
      analysis: '📊',
      custom: '🎨'
    };
    return icons[category] || icons.custom;
  };

  const toolsByCategory = tools.reduce((acc, tool) => {
    const category = tool.category || 'custom';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(tool);
    return acc;
  }, {});

  return (
    <div className="tool-registry-container">
      <style>{`
        .tool-registry-container {
          display: flex;
          flex-direction: column;
          gap: 20px;
          padding: 20px;
          background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          max-height: 700px;
          overflow-y: auto;
        }

        .registry-header {
          text-align: center;
        }

        .registry-title {
          font-size: 24px;
          font-weight: 700;
          background: linear-gradient(135deg, #f59e0b, #ef4444);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          margin-bottom: 8px;
        }

        .registry-subtitle {
          font-size: 14px;
          color: #94a3b8;
        }

        .registry-stats {
          display: flex;
          justify-content: center;
          gap: 24px;
          padding: 16px;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 8px;
        }

        .stat-item {
          text-align: center;
        }

        .stat-value {
          font-size: 24px;
          font-weight: 700;
          color: #f59e0b;
        }

        .stat-label {
          font-size: 12px;
          color: #94a3b8;
          margin-top: 4px;
        }

        .category-section {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .category-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          font-weight: 600;
          font-size: 14px;
        }

        .category-icon {
          font-size: 18px;
        }

        .category-name {
          text-transform: capitalize;
        }

        .category-count {
          margin-left: auto;
          padding: 2px 8px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          font-size: 12px;
        }

        .tools-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
          gap: 12px;
        }

        .tool-card {
          padding: 16px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-left: 4px solid;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .tool-card:hover {
          background: rgba(255, 255, 255, 0.05);
          transform: translateY(-2px);
        }

        .tool-card.selected {
          background: rgba(255, 255, 255, 0.08);
          border-color: #3b82f6;
        }

        .tool-name {
          font-weight: 600;
          font-size: 14px;
          color: #e2e8f0;
          margin-bottom: 8px;
          font-family: monospace;
        }

        .tool-description {
          font-size: 12px;
          color: #94a3b8;
          line-height: 1.5;
          margin-bottom: 12px;
        }

        .tool-meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .tool-usage {
          font-size: 12px;
          color: #64748b;
        }

        .tool-creator {
          font-size: 11px;
          padding: 2px 8px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
          color: #94a3b8;
        }

        .loading-indicator,
        .error-message,
        .empty-state {
          padding: 40px;
          text-align: center;
          color: #94a3b8;
        }

        .error-message {
          color: #f87171;
        }

        .refresh-button {
          padding: 8px 16px;
          background: rgba(59, 130, 246, 0.1);
          border: 1px solid rgba(59, 130, 246, 0.3);
          border-radius: 6px;
          color: #3b82f6;
          cursor: pointer;
          transition: all 0.2s;
          margin-top: 12px;
        }

        .refresh-button:hover {
          background: rgba(59, 130, 246, 0.2);
        }
      `}</style>

      <div className="registry-header">
        <div className="registry-title">🔧 Tool Registry</div>
        <div className="registry-subtitle">
          Dynamically registered tools available to SOMA agents
        </div>
      </div>

      {!isLoading && !error && tools.length > 0 && (
        <div className="registry-stats">
          <div className="stat-item">
            <div className="stat-value">{tools.length}</div>
            <div className="stat-label">Total Tools</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{Object.keys(toolsByCategory).length}</div>
            <div className="stat-label">Categories</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{tools.reduce((sum, t) => sum + (t.usageCount || 0), 0)}</div>
            <div className="stat-label">Total Uses</div>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="loading-indicator">
          ⏳ Loading tool registry...
        </div>
      )}

      {error && (
        <div className="error-message">
          {error}
          <button className="refresh-button" onClick={fetchTools}>
            🔄 Retry
          </button>
        </div>
      )}

      {!isLoading && !error && tools.length === 0 && (
        <div className="empty-state">
          📭 No tools registered yet
        </div>
      )}

      {!isLoading && !error && tools.length > 0 && (
        <>
          {Object.entries(toolsByCategory).map(([category, categoryTools]) => (
            <div key={category} className="category-section">
              <div
                className="category-header"
                style={{ borderLeft: `4px solid ${getCategoryColor(category)}` }}
              >
                <span className="category-icon">{getCategoryIcon(category)}</span>
                <span className="category-name">{category}</span>
                <span className="category-count">{categoryTools.length}</span>
              </div>

              <div className="tools-grid">
                {categoryTools.map((tool) => (
                  <div
                    key={tool.name}
                    className={`tool-card ${selectedTool?.name === tool.name ? 'selected' : ''}`}
                    style={{ borderLeftColor: getCategoryColor(category) }}
                    onClick={() => setSelectedTool(tool)}
                  >
                    <div className="tool-name">{tool.name}</div>
                    <div className="tool-description">{tool.description}</div>
                    <div className="tool-meta">
                      <div className="tool-usage">
                        {tool.usageCount || 0} uses
                      </div>
                      <div className="tool-creator">
                        {tool.createdBy || 'unknown'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
};

export default ToolRegistryInspector;
