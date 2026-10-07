import React, { useState, useEffect } from 'react';
import { StreamingText } from './StreamingText';
import { PaletteArtifact } from './PaletteArtifact';
import { ImageArtifact } from './ImageArtifact';
import { TodoArtifact } from './TodoArtifact';
import { ResponseDisplay } from './ResponseDisplay';
import { BusMessage } from './BusMessage';
import { AgentExecution } from './ExecutionPlan';
import { CodeArtifact } from './CodeArtifact';
import { CrawlReport } from './CrawlReport';
import { FileSearchArtifact } from './FileSearchArtifact';
import ReasoningTree from './ReasoningTree';
import { BlinkingDots } from './BlinkingDots';
import { WorkingIndicator } from './WorkingIndicator';
import ThinkingBox from './ThinkingBox';
import { MessageActions } from './MessageActions';

export const OutputLine = ({ item, currentPath, isAgentConnected, onEdit, onRetry, onBranch, onPin }) => {
  const [isFaded, setIsFaded] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    // Clutter reduction: Fade out 'info' type messages (system status, voice logs) after 10 seconds
    if (item.type === 'info') {
      const fadeTimer = setTimeout(() => {
        setIsFaded(true);
        // After fading out (1s transition), collapse the height to truly remove clutter
        setTimeout(() => setIsCollapsed(true), 1000);
      }, 10000);
      return () => clearTimeout(fadeTimer);
    }
  }, [item.type]);

  if (isCollapsed) return null;

  const renderContent = () => {
    // ThinkingBox - Universal cognitive process container
    if (item.type === 'thinking') {
      return (
        <ThinkingBox
          isThinking={item.isThinking}
          streamedText={item.streamedText || item.content}
          confidence={item.confidence}
          uncertainty={item.uncertainty}
          toolsUsed={item.toolsUsed || []}
          debate={item.debate}
          ideas={item.ideas}
          brain={item.brain || 'LOGOS'}
        />
      );
    }

    if (React.isValidElement(item.content)) {
      return item.content;
    }
    if (typeof item.content === 'string') {
      if (item.type === 'help') {
        return <pre className="whitespace-pre-wrap font-mono text-sm text-zinc-400 leading-relaxed" dangerouslySetInnerHTML={{ __html: item.content }} />;
      }
      if (item.type === 'response' || item.type === 'think' || item.type === 'working') {
        // Use ResponseDisplay for responses to handle Mermaid
        return (
          <div className={`relative overflow-hidden group transition-colors pl-2 ${item.type === 'think' ? 'animate-pulse' : ''}`}>

            {item.type === 'think' ? (
              <div className="flex items-center text-sm font-mono italic space-x-2">
                <span className="text-cycle-think">{item.content}</span>
                <BlinkingDots />
                <style>{`
                          @keyframes textColorCycleThink {
                            0%, 100% { color: #71717a; }
                            33% { color: #a78bfa; }
                            66% { color: #22d3ee; }
                          }
                          .text-cycle-think { animation: textColorCycleThink 3s infinite ease-in-out; }
                        `}</style>
              </div>
            ) : item.type === 'working' ? (
              <WorkingIndicator task={item.content} startTime={item.startTime} />
            ) : (
              <>
                <ResponseDisplay responseText={item.content} />
                {item.tree && <ReasoningTree tree={item.tree} />}
                {item.arbiters && item.arbiters.length > 0 && (
                  <div className="mt-3 pt-3 flex flex-wrap gap-1.5 opacity-50 hover:opacity-100 transition-opacity">
                    <span className="text-[9px] text-zinc-600 uppercase tracking-widest font-bold mr-1 self-center">Swarm:</span>
                    {item.arbiters.map((arbiter, i) => (
                      <span key={i} className="text-[9px] px-2 py-0.5 rounded-full bg-white/5 text-zinc-500 border border-white/5 font-medium uppercase tracking-wide">
                        {arbiter}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        );
      }
      if (item.type === 'bus') {
        return <BusMessage topic={item.metadata?.topic || 'SYSTEM'} payload={item.content} />;
      }
      if (item.type === 'plan') {
        return <AgentExecution goal="Execution Plan" plan={item.content} logEntries={[]} status="Active" />;
      }
      if (item.type === 'code') {
        return (
          <>
            {item.explanation && (
              <div className="mb-3 text-sm text-zinc-300 leading-relaxed">
                {item.explanation}
              </div>
            )}
            <CodeArtifact code={item.content} language="javascript" filename="artifact.js" />
            {item.tests && item.tests.length > 0 && (
              <div className="mt-3">
                <div className="text-xs text-zinc-400 uppercase tracking-wider font-semibold mb-2">Generated Tests:</div>
                {item.tests.map((test, i) => (
                  <CodeArtifact key={i} code={test.code} language="javascript" filename={test.name} />
                ))}
              </div>
            )}
            {item.tree && <ReasoningTree tree={item.tree} />}
          </>
        );
      }
      if (item.type === 'crawl') {
        try {
          const data = typeof item.content === 'string' ? JSON.parse(item.content) : item.content;
          return <CrawlReport startUrl={data.url} results={data.results || []} />;
        } catch {
          return <pre className="whitespace-pre-wrap font-mono text-zinc-300">Crawling: {item.content}</pre>;
        }
      }
      // Handle potentially large shell output
      if (item.type === 'run' || (isAgentConnected && item.type === 'response')) {
        return <pre className="whitespace-pre font-mono text-sm text-zinc-300 overflow-x-auto">{item.content}</pre>;
      }

      if (item.type === 'palette') {
        try {
          const data = JSON.parse(item.content);
          return <PaletteArtifact colors={data.colors} theme={data.theme} />;
        } catch {
          return <pre className="whitespace-pre-wrap font-mono text-red-400">Error parsing palette data.</pre>;
        }
      }
      if (item.type === 'image') {
        const [src, ...promptParts] = item.content.split('|');
        const prompt = promptParts.join('|');
        return <ImageArtifact src={src} prompt={prompt} />;
      }
      if (item.type === 'todo') {
        try {
          const items = JSON.parse(item.content);
          return <TodoArtifact initialItems={items} />;
        } catch {
          return <pre className="whitespace-pre-wrap font-mono text-red-400">Error parsing todo data.</pre>;
        }
      }
      if (item.type === 'search_results') {
        try {
          const data = typeof item.content === 'string' ? JSON.parse(item.content) : item.content;
          return <FileSearchArtifact query={data.query} results={data.results} />;
        } catch {
          return <pre className="whitespace-pre-wrap font-mono text-red-400">Error parsing search results.</pre>;
        }
      }

      return <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed">{item.content}</pre>;
    }
    return null;
  };

  const typeStyles = {
    command: 'text-zinc-300 font-medium',
    info: 'text-zinc-400',
    response: 'text-zinc-200',
    error: 'text-rose-400',
    help: 'text-emerald-400',
    status: 'text-purple-300',
    insights: 'text-indigo-300',
    search: 'text-amber-300',
    learn: 'text-emerald-300',
    think: 'text-zinc-500 italic',
    working: 'text-zinc-400',
    complete: 'text-emerald-400',
    plan: 'text-amber-200',
    code: 'text-zinc-200',
    debug: 'text-zinc-200',
    refactor: 'text-zinc-200',
    phase: 'text-sky-300 font-semibold',
    install: 'text-lime-300',
    run: 'text-zinc-300',
    execution: 'text-zinc-200',
    crawl: 'text-blue-300',
    compress: 'text-yellow-300',
    generate: 'text-zinc-100',
    dialogue: 'text-zinc-400/80',
    export: 'text-emerald-300',
    bus: 'text-blue-400/80',
    image: '',
    palette: '',
    design: '',
    todo: '',
  };

  // Prompt: "You ›"
  const prompt = `You ›`;
  const isStandardLine = !['execution', 'crawl', 'generate', 'bus', 'image', 'palette', 'design', 'todo'].includes(item.type);

  return (
    <div className={`group flex items-start ${typeStyles[item.type] || 'text-zinc-200'} ${isStandardLine ? 'mt-1.5' : 'mt-3'} transition-all duration-1000 ${isFaded ? 'opacity-0 scale-98 blur-[2px]' : 'opacity-100 scale-100 blur-0'} ${item.pinned ? 'rounded-lg border-l-2 border-amber-400/50 bg-amber-500/[0.03] pl-2' : ''}`}>
      {item.type === 'command' && <div className="w-auto mr-3 flex-shrink-0 select-none text-zinc-600 font-mono text-xs pt-0.5">{prompt}</div>}
      {item.type === 'response' && <div className="w-auto mr-3 flex-shrink-0 select-none text-fuchsia-500 font-mono text-xs pt-0.5 font-bold">SOMA ›</div>}
      <div className="flex-grow min-w-0">
        {renderContent()}
        {['command', 'response', 'error'].includes(item.type) && (
          <MessageActions item={item} onEdit={onEdit} onRetry={onRetry} onBranch={onBranch} onPin={onPin} />
        )}
        {item.metadata && Object.keys(item.metadata).length > 0 && (
          <details className="mt-1 text-[10px] text-zinc-600">
            <summary className="cursor-pointer hover:text-zinc-400">Runtime details</summary>
            <pre className="mt-1 max-h-40 overflow-auto rounded bg-black/20 p-2">{JSON.stringify(item.metadata, null, 2)}</pre>
          </details>
        )}
      </div>
    </div>
  );
};
