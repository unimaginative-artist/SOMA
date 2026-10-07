import React, { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';

export const PIN_KEY = 'aperture.lock.pin.v1';
export const PIN_LENGTH = 4;

export function loadSavedPin() {
  return localStorage.getItem(PIN_KEY) || null;
}

export default function LockScreen({ wallpaper, wallpaperUrl, onUnlock, onSetPin }) {
  const savedPin = loadSavedPin();
  const [step, setStep]       = useState(savedPin ? 'locked' : 'setup');
  const [input, setInput]     = useState('');
  const [setupPin, setSetupPin] = useState('');
  const [error, setError]     = useState('');
  const [shake, setShake]     = useState(false);
  const [clock, setClock]     = useState(new Date());
  const inputRef              = useRef(null);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    inputRef.current?.focus();
    return () => clearInterval(t);
  }, []);

  const doError = (msg) => {
    setError(msg);
    setShake(true);
    setTimeout(() => { setInput(''); setError(''); setShake(false); }, 900);
  };

  const addDigit = (d) => {
    const next = (input + d).slice(0, PIN_LENGTH);
    setInput(next);
    if (next.length < PIN_LENGTH) return;

    if (step === 'locked') {
      if (next === (localStorage.getItem(PIN_KEY) || '')) {
        setInput('');
        onUnlock();
      } else {
        doError('Incorrect PIN');
      }
    } else if (step === 'setup') {
      setSetupPin(next);
      setInput('');
      setStep('confirm');
    } else if (step === 'confirm') {
      if (next === setupPin) {
        localStorage.setItem(PIN_KEY, next);
        onSetPin(next);
        onUnlock();
      } else {
        setSetupPin('');
        setStep('setup');
        doError('PINs do not match — try again');
      }
    }
  };

  const backspace = () => setInput(p => p.slice(0, -1));

  const handleKey = (e) => {
    if (e.key >= '0' && e.key <= '9') addDigit(e.key);
    else if (e.key === 'Backspace') backspace();
  };

  const KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, '⌫'];

  const wallStyle = wallpaper === 'custom' && wallpaperUrl
    ? { backgroundImage: `url("${wallpaperUrl}")` } : undefined;

  return (
    <div
      className={`ap-lock-screen ap-wallpaper-${wallpaper}`}
      style={wallStyle}
      onKeyDown={handleKey}
      tabIndex={0}
      ref={el => el?.focus()}
    >
      <div className="ap-lock-overlay" />

      <div className="ap-lock-clock">
        <span className="ap-lock-time">
          {clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
        <span className="ap-lock-date">
          {clock.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
        </span>
      </div>

      <div className="ap-lock-panel">
        <div className="ap-lock-brand">
          <Sparkles size={18} />
          <span>Aperture</span>
        </div>

        <div className="ap-lock-label">
          {step === 'setup'   && 'Create a PIN to secure Aperture'}
          {step === 'confirm' && 'Confirm your PIN'}
          {step === 'locked'  && 'Enter PIN to unlock'}
        </div>

        <div className={`ap-lock-dots ${shake ? 'ap-lock-shake' : ''}`}>
          {Array.from({ length: PIN_LENGTH }, (_, i) => (
            <span key={i} className={`ap-lock-dot ${i < input.length ? 'filled' : ''}`} />
          ))}
        </div>

        {error && <div className="ap-lock-error">{error}</div>}

        <div className="ap-lock-numpad">
          {KEYS.map((key, i) =>
            key === null ? <div key={i} /> :
            key === '⌫' ? (
              <button key={i} className="ap-lock-key ap-lock-del" onClick={backspace}>⌫</button>
            ) : (
              <button key={i} className="ap-lock-key" onClick={() => addDigit(String(key))}>
                {key}
              </button>
            )
          )}
        </div>

        {step === 'locked' && (
          <button className="ap-lock-skip" onClick={onUnlock}>
            Unlock without PIN
          </button>
        )}
      </div>
    </div>
  );
}
