import React, { useState, useEffect, useRef } from 'react';

const QUESTIONS = [
  {
    id: 'purpose',
    ask: "Before we get into everything — what are you actually trying to build? Not the technical answer, the real one.",
  },
  {
    id: 'collaboration',
    ask: "How do you want to work together? Do you want me to push back on your ideas, challenge your thinking — or mostly help you execute?",
  },
  {
    id: 'context',
    ask: "Last one — tell me something about yourself that you think I should know. Anything. Work, life, whatever feels relevant.",
  },
];

// Typewriter hook
function useTypewriter(text, speed = 22, enabled = true) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!enabled || !text) return;
    setDisplayed('');
    setDone(false);
    let i = 0;
    const timer = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(timer);
        setDone(true);
      }
    }, speed);
    return () => clearInterval(timer);
  }, [text, enabled]);

  return { displayed, done };
}

export default function OnboardingWizard({ onComplete }) {
  const [step, setStep]           = useState('intro');   // intro | q0 | q1 | q2 | ack | done
  const [qIndex, setQIndex]       = useState(0);
  const [answers, setAnswers]     = useState([]);
  const [input, setInput]         = useState('');
  const [ackText, setAckText]     = useState('');
  const [closing, setClosing]     = useState('');
  const [saving, setSaving]       = useState(false);
  const [fadeOut, setFadeOut]     = useState(false);
  const inputRef                  = useRef(null);

  // What SOMA is currently "saying"
  const currentText =
    step === 'intro'    ? "Hey. I'm SOMA. Before we dive in, I want to ask you a few things — not to fill out a profile, just to actually know who I'm working with. It'll only take a minute."
  : step === 'ack'      ? ackText
  : step === 'closing'  ? closing
  : QUESTIONS[qIndex]?.ask || '';

  const { displayed, done } = useTypewriter(currentText, step === 'intro' ? 18 : 20);

  // Auto-focus input when question appears
  useEffect(() => {
    if ((step.startsWith('q') || step === 'ack') && done) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [step, done]);

  const handleIntroNext = () => setStep('q' + qIndex);

  const handleAnswer = async () => {
    if (!input.trim()) return;
    const ans = { q: QUESTIONS[qIndex].ask, a: input.trim() };
    const newAnswers = [...answers, ans];
    setAnswers(newAnswers);
    setInput('');

    if (qIndex < QUESTIONS.length - 1) {
      // Get a natural acknowledgment from SOMA before next question
      setStep('ack');
      try {
        const res = await fetch('/api/soma/onboard/ack', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answer: ans.a, questionId: QUESTIONS[qIndex].id, nextQuestion: QUESTIONS[qIndex + 1].ask }),
        });
        const data = await res.json();
        setAckText(data.ack || QUESTIONS[qIndex + 1].ask);
      } catch {
        setAckText(QUESTIONS[qIndex + 1].ask);
      }
    } else {
      // Last answer — save everything
      setSaving(true);
      setStep('closing');
      // Mark onboarded immediately so a refresh never re-triggers the wizard
      localStorage.setItem('soma_onboarded', '1');

      // Race the backend against a 20s client-side timeout so we never hang on "Remembering..."
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const res = await fetch('/api/soma/onboard/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers: newAnswers }),
          signal: controller.signal,
        });
        const data = await res.json();
        setClosing(data.closing || "I'll remember all of this. Let's get to work.");
      } catch {
        // Timeout or network error — still let the user through
        setClosing("I'll remember all of this. Let's get to work.");
      } finally {
        clearTimeout(timeout);
        setSaving(false);
      }
    }
  };

  const handleAckNext = () => {
    const next = qIndex + 1;
    setQIndex(next);
    setStep('q' + next);
  };

  const handleFinish = () => {
    localStorage.setItem('soma_onboarded', '1');
    setFadeOut(true);
    setTimeout(() => onComplete?.(), 600);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (step.startsWith('q') && done) handleAnswer();
    }
  };

  const progress = qIndex / QUESTIONS.length;
  const isQuestion = step.startsWith('q');
  const showInput = isQuestion && done;
  const showAckNext = step === 'ack' && done;
  const showFinish = step === 'closing' && done && !saving;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{
        background: 'radial-gradient(ellipse at center, #0d0015 0%, #000000 100%)',
        opacity: fadeOut ? 0 : 1,
        transition: 'opacity 600ms ease',
      }}
    >
      {/* Ambient glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(217,70,239,0.08) 0%, transparent 70%)' }} />
      </div>

      <div className="relative w-full max-w-xl px-6 flex flex-col items-center gap-8">

        {/* SOMA logo */}
        <div className="flex flex-col items-center gap-3">
          <svg width="52" height="52" viewBox="0 0 24 24" fill="currentColor"
            className="text-fuchsia-500 drop-shadow-[0_0_12px_rgba(217,70,239,0.8)]">
            <path d="M12 2C10.5 2 9 2.5 8 3.5C7 2.5 5.5 2 4 2C2.5 2 1 3 1 5C1 6.5 1.5 8 2.5 9C1.5 10 1 11.5 1 13C1 14.5 2 16 3.5 16.5C3 17.5 3 18.5 3.5 19.5C4 20.5 5 21 6 21.5C7 22 8.5 22 10 22H14C15.5 22 17 22 18 21.5C19 21 20 20.5 20.5 19.5C21 18.5 21 17.5 20.5 16.5C22 16 23 14.5 23 13C23 11.5 22.5 10 21.5 9C22.5 8 23 6.5 23 5C23 3 21.5 2 20 2C18.5 2 17 2.5 16 3.5C15 2.5 13.5 2 12 2Z" />
          </svg>
          <span className="text-zinc-500 text-xs font-mono uppercase tracking-[0.25em]">SOMA</span>
        </div>

        {/* Progress bar — only show during questions */}
        {(isQuestion || step === 'ack') && (
          <div className="w-full h-px bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-fuchsia-500/60 rounded-full transition-all duration-700"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        )}

        {/* SOMA's speech */}
        <div className="w-full min-h-[80px] flex items-start">
          <p className="text-zinc-200 text-lg leading-relaxed font-light">
            {displayed}
            {!done && <span className="inline-block w-0.5 h-5 bg-fuchsia-500 ml-0.5 animate-pulse align-middle" />}
          </p>
        </div>

        {/* Intro next button */}
        {step === 'intro' && done && (
          <button
            onClick={handleIntroNext}
            className="px-6 py-2.5 rounded-xl bg-fuchsia-500/10 border border-fuchsia-500/30 text-fuchsia-300 text-sm font-medium hover:bg-fuchsia-500/20 transition-all"
          >
            Let's do it
          </button>
        )}

        {/* Answer input */}
        {showInput && (
          <div className="w-full flex flex-col gap-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your answer..."
              rows={3}
              className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3 text-zinc-200 placeholder-zinc-600 text-sm leading-relaxed resize-none focus:outline-none focus:border-fuchsia-500/40 focus:ring-1 focus:ring-fuchsia-500/20 transition-all"
            />
            <button
              onClick={handleAnswer}
              disabled={!input.trim()}
              className="self-end px-5 py-2 rounded-xl bg-fuchsia-500/10 border border-fuchsia-500/30 text-fuchsia-300 text-sm font-medium hover:bg-fuchsia-500/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              {qIndex === QUESTIONS.length - 1 ? 'Done' : 'Continue'}
            </button>
          </div>
        )}

        {/* Ack → next question */}
        {showAckNext && (
          <button
            onClick={handleAckNext}
            className="self-start px-5 py-2 rounded-xl bg-white/5 border border-white/10 text-zinc-400 text-sm hover:text-zinc-200 hover:border-white/20 transition-all"
          >
            Continue →
          </button>
        )}

        {/* Saving indicator */}
        {saving && (
          <div className="flex items-center gap-2 text-zinc-500 text-sm">
            <div className="w-1.5 h-1.5 rounded-full bg-fuchsia-500 animate-ping" />
            Remembering...
          </div>
        )}

        {/* Finish */}
        {showFinish && (
          <button
            onClick={handleFinish}
            className="px-6 py-2.5 rounded-xl bg-fuchsia-500/15 border border-fuchsia-500/40 text-fuchsia-200 text-sm font-medium hover:bg-fuchsia-500/25 transition-all"
          >
            Let's go →
          </button>
        )}

      </div>
    </div>
  );
}
