import React from 'react';

/**
 * AutoScrollText
 * - Shows N lines of text; on hover of a parent .group, slowly scrolls vertically.
 * - Duplicate copy is rendered for seamless looping.
 * - Works under Electron (file://) and browser.
 */
export default function AutoScrollText({
  text,
  lines = 2,
  durationSec = 12,
  className = '',
  masked = true,
}) {
  // Approximate line-height in em (matches text-xs leading-relaxed roughly)
  const lineHeightEm = 1.5;
  const heightEm = lines * lineHeightEm;

  return (
    <div
      className={`truncate-scroll ${masked ? 'truncate-scroll--mask' : ''} ${className}`}
      style={{ ['--ts-height']: `${heightEm}em`, ['--ts-duration']: `${durationSec}s` }}
    >
      <div className="truncate-scroll__inner">
        <p className="text-zinc-500 text-xs leading-relaxed">{text}</p>
        {/* Duplicate for seamless looping */}
        <p className="text-zinc-500 text-xs leading-relaxed mt-2">{text}</p>
      </div>
    </div>
  );
}
