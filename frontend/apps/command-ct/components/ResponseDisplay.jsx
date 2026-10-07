import React, { useEffect, useRef } from 'react';
import mermaid from 'mermaid';
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
});

const sanitizeRenderedHtml = (html) => {
  const template = document.createElement('template');
  template.innerHTML = html;

  template.content.querySelectorAll('script, style, iframe, object, embed, link, meta').forEach(node => node.remove());
  template.content.querySelectorAll('*').forEach(node => {
    [...node.attributes].forEach(attr => {
      const name = attr.name.toLowerCase();
      const value = String(attr.value || '').trim().toLowerCase();
      if (name.startsWith('on') || value.startsWith('javascript:')) {
        node.removeAttribute(attr.name);
      }
      if ((name === 'href' || name === 'src') && value && !/^(https?:|mailto:|\/|#)/i.test(value)) {
        node.removeAttribute(attr.name);
      }
    });

    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noreferrer noopener');
    }
  });

  return template.innerHTML;
};

export const ResponseDisplay = ({ responseText }) => {
  const containerRef = useRef(null);

  useEffect(() => {
    if (responseText && containerRef.current) {
      // Clear previous content
      containerRef.current.innerHTML = '';

      const htmlContent = sanitizeRenderedHtml(md.render(responseText));
      
      // Create a temporary div to parse the HTML string
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = htmlContent;

      // Find all Mermaid code blocks and render them
      const mermaidCodeBlocks = tempDiv.querySelectorAll('pre code.language-mermaid');
      mermaidCodeBlocks.forEach(codeBlock => {
        const mermaidSvgId = `mermaid-svg-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        const mermaidDiv = document.createElement('div');
        mermaidDiv.className = 'mermaid';
        mermaidDiv.id = mermaidSvgId;
        mermaidDiv.textContent = codeBlock.textContent; // Transfer content to mermaid div

        // Replace the code block with the mermaid div
        codeBlock.parentNode?.replaceChild(mermaidDiv, codeBlock);
      });

      // Now set the processed HTML to the container
      containerRef.current.innerHTML = tempDiv.innerHTML;

      // Initialize mermaid for the new content
      try {
        mermaid.init(undefined, containerRef.current.querySelectorAll('.mermaid'));
      } catch (e) {
        console.warn('Mermaid initialization failed:', e);
      }
    }
  }, [responseText]);

  return (
    <div 
      ref={containerRef} 
      className="text-zinc-300 overflow-auto max-h-[calc(100vh-200px)] custom-scrollbar prose prose-invert max-w-none leading-relaxed"
    >
      {/* Content will be rendered here by useEffect */}
    </div>
  );
};
