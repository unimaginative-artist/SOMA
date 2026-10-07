import React, { useState, useEffect } from 'react';
import SteveAgentButton from './SteveAgentButton';
import SteveSystemChat from './SteveSystemChat';
import SteveToast from './SteveToast';
import { SteveContextManager } from '../lib/SteveContextManager';
import { toast } from 'react-toastify';

const WorkflowSteve = ({ onNavigate }) => {
  const [steveMood, setSteveMood] = useState('idle');
  const [stevePos, setStevePos] = useState({ x: 30, y: window.innerHeight - 60 });
  const [isDraggingSteve, setIsDraggingSteve] = useState(false);
  const [isSteveChatOpen, setIsSteveChatOpen] = useState(false);
  const [steveMessages, setSteveMessages] = useState([
    { role: 'steve', content: "S.T.E.V.E. online. Supervised Terminal Execution & Validation Engine initialized. What workflow disaster are we fixing now?" }
  ]);
  const [isSteveThinking, setIsSteveThinking] = useState(false);

  const handleSteveMouseDown = (e) => {
    const startX = stevePos.x;
    const startY = stevePos.y;
    const initialMouseX = e.clientX;
    const initialMouseY = e.clientY;

    const handleMouseMove = (moveEvent) => {
      setIsDraggingSteve(true);
      const deltaX = moveEvent.clientX - initialMouseX;
      const deltaY = moveEvent.clientY - initialMouseY;
      setStevePos({
        x: Math.max(0, Math.min(window.innerWidth - 60, startX + deltaX)),
        y: Math.max(0, Math.min(window.innerHeight - 60, startY + deltaY))
      });
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      setTimeout(() => setIsDraggingSteve(false), 50);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleSteveMessage = async (msg) => {
    setSteveMessages(prev => [...prev, { role: 'user', content: msg }]);
    setIsSteveThinking(true);
    setSteveMood('thinking');

    try {
      // Check for navigation commands
      const lowerMsg = msg.toLowerCase();
      if (lowerMsg.includes('show me') || lowerMsg.includes('go to') || lowerMsg.includes('open')) {
        if (lowerMsg.includes('security') && onNavigate) onNavigate('security');
        else if (lowerMsg.includes('analytics') && onNavigate) onNavigate('analytics');
        else if (lowerMsg.includes('knowledge') && onNavigate) onNavigate('knowledge');
        else if (lowerMsg.includes('terminal') && onNavigate) onNavigate('terminal');
      }

      console.log('Sending to STEVE:', msg);
      const response = await fetch('/api/steve/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          context: { source: 'steve-workflow-chat', mood: steveMood }
        })
      });
      const data = await response.json();

      let reply = data.response || "Processing complete.";

      // Judgement Layer
      if (Math.random() > 0.7) {
        reply += `\n\n_${SteveContextManager.judge()}_`;
        setSteveMood('annoyed');
        setTimeout(() => setSteveMood('idle'), 3000);
      } else {
        setSteveMood('idle');
      }

      setSteveMessages(prev => [...prev, {
        role: 'steve',
        content: reply,
      }]);

      // Persist to memory
      SteveContextManager.remember(msg);

    } catch (err) {
      console.error(err);
      setSteveMessages(prev => [...prev, { role: 'steve', content: "Neural link failure. Typical." }]);
      setSteveMood('annoyed');
    } finally {
      setIsSteveThinking(false);
    }
  };

  return (
    <>
      <SteveToast />

      <SteveSystemChat
        isOpen={isSteveChatOpen}
        onClose={() => setIsSteveChatOpen(false)}
        messages={steveMessages}
        onSendMessage={handleSteveMessage}
        isProcessing={isSteveThinking}
        onActionExecute={(cmd) => handleSteveMessage(`Execute: ${cmd}`)}
        onApplyEdits={(files) => toast.info(`Applying edits to ${files.length} files...`)}
        buttonPosition={stevePos}
        mood={steveMood}
      />

      <SteveAgentButton
        isActive={isSteveChatOpen}
        position={stevePos}
        onMouseDown={handleSteveMouseDown}
        isDragging={isDraggingSteve}
        onClick={() => !isDraggingSteve && setIsSteveChatOpen(prev => !prev)}
      />
    </>
  );
};

export default WorkflowSteve;
