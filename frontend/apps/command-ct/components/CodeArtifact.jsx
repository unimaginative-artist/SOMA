import React, { useState, useEffect, useRef } from 'react';

const TabButton = ({ name, label, activeTab, setActiveTab, disabled }) => (
    <button
      onClick={() => !disabled && setActiveTab(name)}
      disabled={disabled}
      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors duration-200 flex items-center space-x-1.5 ${
        activeTab === name
          ? 'bg-white/10 text-white'
          : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
      } ${disabled ? 'opacity-30 cursor-not-allowed' : ''}`}
    >
      <span>{label}</span>
    </button>
);

export const CodeArtifact = ({ code, language, filename }) => {
  const isPreviewable = ['html', 'javascript', 'js', 'css', 'svg'].includes(language.toLowerCase());
  const [activeTab, setActiveTab] = useState(isPreviewable ? 'preview' : 'code');
  const [copyStatus, setCopyStatus] = useState('idle');
  const codeRef = useRef(null);

  useEffect(() => {
    if (activeTab === 'code' && codeRef.current && window.hljs) {
      window.hljs.highlightElement(codeRef.current);
    }
  }, [code, language, activeTab]);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2000);
    }, () => {
      setCopyStatus('failed');
      setTimeout(() => setCopyStatus('idle'), 2000);
    });
  };

  const getCopyButtonContent = () => {
    switch (copyStatus) {
      case 'copied':
        return <span className="text-emerald-400">Copied</span>;
      case 'failed':
        return <span className="text-rose-400">Error</span>;
      case 'idle':
      default:
        return <span>Copy</span>;
    }
  };

  const renderPreview = () => {
    const lang = language.toLowerCase();
    switch (lang) {
      case 'html':
        return (
          <iframe
            srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">${code}`}
            title="HTML Preview"
            className="w-full h-full border-0"
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
          />
        );
      case 'javascript':
      case 'js':
        const jsSrcDoc = `
          <html>
            <head>
              <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
              <style>
                body { margin: 0; padding: 8px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #ffffff; color: #333; }
                #root { width: 100%; height: 100%; }
                canvas { border: 1px solid #ccc; }
              </style>
            </head>
            <body>
              <div id="root"></div>
              <script>${code}</script>
            </body>
          </html>`;
        return (
          <iframe
            srcDoc={jsSrcDoc}
            title="JavaScript Preview"
            className="w-full h-full border-0"
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
          />
        );
      case 'css':
        const cssSrcDoc = `
          <html>
            <head>
              <style>${code}</style>
            </head>
            <body>
              <div class="container" style="padding: 1rem;">
                <h1>Styled Heading 1</h1>
                <p>This is a paragraph to demonstrate text styling. <a href="#">This is a link</a>.</p>
                <button class="btn btn-primary">Primary Button</button>
                <button class="btn btn-secondary">Secondary Button</button>
                <div class="card" style="border: 1px solid #ccc; padding: 1rem; margin-top: 1rem; border-radius: 8px;">
                  <h2>Card Title</h2>
                  <p>Some card content goes here.</p>
                </div>
              </div>
            </body>
          </html>`;
        return (
          <iframe
            srcDoc={cssSrcDoc}
            title="CSS Preview"
            className="w-full h-full border-0"
            sandbox=""
            referrerPolicy="no-referrer"
          />
        );
      case 'svg':
        const svgSrcDoc = `
          <body style="margin: 0; display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;">
            ${code}
          </body>
        `;
        return (
          <iframe
            srcDoc={svgSrcDoc}
            title="SVG Preview"
            className="w-full h-full border-0"
            sandbox=""
            referrerPolicy="no-referrer"
          />
        );
      default:
        return null;
    }
  };


  return (
    <div className="bg-zinc-800/50 backdrop-blur-md rounded-xl my-3 border border-white/5 shadow-lg w-full overflow-hidden group">
      <div className="flex justify-between items-center px-4 py-3 bg-white/5 border-b border-white/5">
        <div className="flex items-center space-x-2 overflow-hidden">
           <div className="w-2 h-2 rounded-full bg-zinc-500/50"></div>
           <span className="text-xs font-medium text-zinc-300 font-mono truncate">{filename}</span>
        </div>
        <div className="flex items-center space-x-2 flex-shrink-0">
          <TabButton name="code" label="Code" activeTab={activeTab} setActiveTab={setActiveTab} />
          <TabButton name="preview" label="Preview" activeTab={activeTab} setActiveTab={setActiveTab} disabled={!isPreviewable} />
          <button
            onClick={handleCopy}
            className="bg-transparent hover:bg-white/10 text-xs text-zinc-400 hover:text-white font-medium py-1 px-2 rounded-md transition-all duration-200"
          >
            {getCopyButtonContent()}
          </button>
        </div>
      </div>
      
      <div className="relative">
        {activeTab === 'code' && (
          <div className="bg-[#1a1b26] overflow-hidden">
            <pre className="p-4 m-0"><code ref={codeRef} className={`language-${language} hljs text-sm leading-relaxed !bg-transparent`}>
              {code}
            </code></pre>
          </div>
        )}
        {activeTab === 'preview' && isPreviewable && (
          <div className="bg-white h-64">
            {renderPreview()}
          </div>
        )}
      </div>
    </div>
  );
};
