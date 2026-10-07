import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Brain, Sparkles, CheckCircle, AlertCircle } from 'lucide-react';

/**
 * ReasoningTree - Interactive visualization of multi-arbiter reasoning process
 * 
 * Features:
 * - Expandable/collapsible nodes
 * - Confidence-based color coding
 * - Arbiter badges
 * - Smooth animations
 */

const TreeNode = ({ node, level = 0 }) => {
  const [isExpanded, setIsExpanded] = useState(level < 2); // Auto-expand first 2 levels

  const hasChildren = node.children && node.children.length > 0;
  const indent = level * 24; // 24px per level

  // Confidence color coding
  const getConfidenceColor = (confidence) => {
    if (confidence >= 0.8) return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
    if (confidence >= 0.6) return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
    if (confidence >= 0.4) return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
    return 'text-rose-400 bg-rose-500/10 border-rose-500/20';
  };

  // Arbiter icon
  const getArbiterIcon = (arbiterName) => {
    if (arbiterName?.includes('Conductor')) return Brain;
    if (arbiterName?.includes('Analyst')) return Sparkles;
    return CheckCircle;
  };

  const confidenceColor = getConfidenceColor(node.confidence || 0);
  const Icon = getArbiterIcon(node.arbiter);

  return (
    <div className="relative">
      {/* Node */}
      <div 
        className="flex items-start space-x-3 py-2 px-3 rounded-lg hover:bg-white/5 transition-all cursor-pointer group"
        style={{ paddingLeft: `${indent}px` }}
        onClick={() => hasChildren && setIsExpanded(!isExpanded)}
      >
        {/* Expand/Collapse Icon */}
        {hasChildren && (
          <div className="mt-1 text-zinc-500 group-hover:text-zinc-300 transition-colors">
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </div>
        )}

        {/* Connector Line */}
        {level > 0 && (
          <div className="absolute left-0 top-0 h-full w-px bg-gradient-to-b from-white/10 to-transparent" 
               style={{ left: `${indent - 12}px` }} />
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Arbiter Badge & Action */}
          <div className="flex items-center space-x-2 mb-1">
            {node.arbiter && (
              <div className={`flex items-center space-x-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${confidenceColor}`}>
                <Icon className="w-3 h-3" />
                <span>{node.arbiter}</span>
              </div>
            )}
            {node.action && (
              <span className="text-xs text-zinc-400 font-medium">{node.action}</span>
            )}
            {node.confidence !== undefined && (
              <span className={`text-[10px] font-mono ${confidenceColor.split(' ')[0]}`}>
                {(node.confidence * 100).toFixed(0)}%
              </span>
            )}
          </div>

          {/* Result */}
          {node.result && (
            <div className="text-sm text-zinc-300 leading-relaxed mt-1 line-clamp-2 group-hover:line-clamp-none transition-all">
              {node.result}
            </div>
          )}

          {/* Query (for root node) */}
          {node.query && node.type === 'root' && (
            <div className="text-sm text-zinc-200 font-medium mt-1">
              {node.query}
            </div>
          )}
        </div>
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div className="mt-1">
          {node.children.map((child, index) => (
            <TreeNode key={child.id || index} node={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

const ReasoningTree = ({ tree, onClose }) => {
  if (!tree) return null;

  return (
    <div className="mt-4 bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-4 shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/5">
        <div className="flex items-center space-x-2">
          <Brain className="w-5 h-5 text-purple-400" />
          <h3 className="text-sm font-semibold text-zinc-100 uppercase tracking-wider">
            Reasoning Process
          </h3>
        </div>
        
        {tree.aggregateConfidence !== undefined && (
          <div className="flex items-center space-x-2">
            <span className="text-xs text-zinc-400">Overall Confidence:</span>
            <span className={`text-sm font-bold ${
              tree.aggregateConfidence >= 0.8 ? 'text-emerald-400' :
              tree.aggregateConfidence >= 0.6 ? 'text-blue-400' :
              tree.aggregateConfidence >= 0.4 ? 'text-amber-400' : 'text-rose-400'
            }`}>
              {(tree.aggregateConfidence * 100).toFixed(0)}%
            </span>
          </div>
        )}
      </div>

      {/* Tree */}
      <div className="space-y-1 max-h-96 overflow-y-auto custom-scrollbar pr-2">
        <TreeNode node={tree} level={0} />
      </div>

      {/* Final Result */}
      {tree.finalResult && (
        <div className="mt-4 pt-4 border-t border-white/5">
          <div className="flex items-start space-x-2">
            <Sparkles className="w-4 h-4 mt-0.5 text-purple-400" />
            <div>
              <div className="text-xs text-zinc-400 uppercase tracking-wider font-semibold mb-1">
                Final Result
              </div>
              <div className="text-sm text-zinc-200 leading-relaxed">
                {tree.finalResult}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReasoningTree;
