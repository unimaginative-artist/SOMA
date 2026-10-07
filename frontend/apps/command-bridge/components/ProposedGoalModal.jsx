import React from 'react';
import { CheckCircle, XCircle, Target, ArrowRight, FlaskConical, AlertTriangle, ShieldCheck } from 'lucide-react';

// Simple inline DiffViewer component for now
const DiffViewer = ({ original, modified }) => {
  const renderLine = (line, index, type) => {
    let className = 'font-mono text-xs py-0.5 px-1';
    if (type === 'removed') className += ' bg-red-800/30 text-red-300';
    if (type === 'added') className += ' bg-green-800/30 text-green-300';
    return (
      <div key={index} className={className}>
        {line.length > 0 ? line : ' '} {/* Ensure empty lines are rendered */}
      </div>
    );
  };

  const originalLines = original ? original.split('\n') : [];
  const modifiedLines = modified ? modified.split('\n') : [];

  // This is a very basic diff; a real diff algorithm would be more complex.
  // For simplicity, we'll just show original and modified blocks.
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-2 mt-2 text-zinc-200">
      <p className="font-semibold text-sm mb-1">Proposed Changes:</p>
      {original && (
        <>
          <p className="text-sm text-zinc-400 mt-2">Original:</p>
          <pre className="whitespace-pre-wrap bg-red-800/20 rounded-md p-2 max-h-48 overflow-y-auto custom-scrollbar">
            {originalLines.map((line, idx) => renderLine(line, idx, 'removed'))}
          </pre>
        </>
      )}
      {modified && (
        <>
          <p className="text-sm text-zinc-400 mt-2">Modified:</p>
          <pre className="whitespace-pre-wrap bg-green-800/20 rounded-md p-2 max-h-48 overflow-y-auto custom-scrollbar">
            {modifiedLines.map((line, idx) => renderLine(line, idx, 'added'))}
          </pre>
        </>
      )}
      {!original && !modified && <p className="text-zinc-500">No specific code changes provided.</p>}
    </div>
  );
};

const ProposedGoalModal = ({ proposedGoals, onApprove, onReject, onClose }) => {
  if (proposedGoals.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <div className="bg-[#151518] border border-white/10 rounded-2xl w-full max-w-2xl shadow-2xl p-6" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-6 border-b border-white/5 pb-4">
          <h3 className="text-xl font-bold text-white flex items-center">
            <Target className="w-5 h-5 mr-2 text-blue-400" /> Proposed Goals
          </h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
          {proposedGoals.map(goal => {
            const isFixProposal = goal.metadata?.source === 'fix_proposal_system';
            const fixProposal = isFixProposal ? goal.metadata.fixProposal : null;
            const hasDiff = fixProposal && fixProposal.proposal?.fix?.beforeAfter;

            return (
              <div key={goal.id} className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col">
                <div className="flex items-center mb-2">
                  {isFixProposal ? <FlaskConical className="w-4 h-4 mr-2 text-fuchsia-300" /> : <Target className="w-4 h-4 mr-2 text-blue-300" />}
                  <h4 className="text-lg font-semibold text-white">{goal.title}</h4>
                </div>
                <p className="text-zinc-400 text-sm mb-3">{goal.description || 'No description provided.'}</p>

                {isFixProposal && fixProposal && (
                  <div className="mt-2 text-zinc-400 text-sm space-y-2">
                    <p><span className="font-semibold">Opportunity:</span> {fixProposal.opportunity?.description || 'N/A'}</p>
                    <p><span className="font-semibold">Rationale:</span> {fixProposal.reasoning?.logos || 'N/A'}</p>
                    <div className="flex items-center space-x-4">
                      <p className="flex items-center"><span className="font-semibold mr-1">Confidence:</span> <span className="text-emerald-400">{(fixProposal.proposal?.confidence * 100).toFixed(0)}%</span></p>
                      <p className="flex items-center"><span className="font-semibold mr-1">Risk:</span> {fixProposal.proposal?.risk < 0.3 ? <span className="text-emerald-400">Low</span> : fixProposal.proposal?.risk < 0.7 ? <span className="text-amber-400">Medium</span> : <span className="text-rose-400">High</span>}</p>
                      <p className="flex items-center">
                        <span className="font-semibold mr-1">Safety:</span>
                        {fixProposal.proposal?.safetyApproved ? <ShieldCheck className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-rose-400" />}
                      </p>
                    </div>

                    {hasDiff && (
                      <DiffViewer
                        original={fixProposal.proposal.fix.beforeAfter.original}
                        modified={fixProposal.proposal.fix.beforeAfter.modified}
                      />
                    )}
                  </div>
                )}

                <div className="flex justify-end space-x-3 mt-auto pt-4 border-t border-white/5">
                  <button
                    onClick={() => onReject(goal.id)}
                    className="px-4 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center"
                  >
                    <XCircle className="w-4 h-4 mr-2" /> Reject
                  </button>
                  <button
                    onClick={() => onApprove(goal.id)}
                    className="px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center"
                  >
                    <CheckCircle className="w-4 h-4 mr-2" /> Approve
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ProposedGoalModal;