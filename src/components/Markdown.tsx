import { useEffect, useMemo, useRef } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import hljs from 'highlight.js/lib/common';
import { cn } from '../lib/utils';

marked.setOptions({ gfm: true, breaks: true });

let linkHookInstalled = false;
function installLinkHook() {
  if (linkHookInstalled) return;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer nofollow');
    }
  });
  linkHookInstalled = true;
}

interface MarkdownProps {
  content: string;
  className?: string;
  streaming?: boolean;
}

export function Markdown({ content, className, streaming = false }: MarkdownProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const html = useMemo(() => {
    installLinkHook();
    const parsed = marked.parse(content, { async: false, gfm: true, breaks: true }) as string;
    return DOMPurify.sanitize(parsed, {
      ADD_ATTR: ['target', 'rel'],
      USE_PROFILES: { html: true },
    });
  }, [content]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root || streaming) return;

    root.querySelectorAll('pre code').forEach((node) => {
      const code = node as HTMLElement;
      if (code.dataset.highlighted === 'true') return;
      try {
        hljs.highlightElement(code);
      } catch {
        /* highlight is best-effort */
      }
      code.dataset.highlighted = 'true';

      const pre = code.closest('pre');
      if (!pre || pre.previousElementSibling?.classList.contains('code-meta')) return;

      const language = Array.from(code.classList)
        .find((name) => name.startsWith('language-'))
        ?.replace('language-', '');

      const meta = document.createElement('div');
      meta.className = 'code-meta';

      const label = document.createElement('span');
      label.textContent = language ? language.toUpperCase() : 'CODE';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'code-copy';
      button.textContent = 'COPY';
      button.addEventListener('click', () => {
        const text = code.textContent ?? '';
        void navigator.clipboard?.writeText(text).then(() => {
          button.textContent = 'COPIED';
          window.setTimeout(() => {
            button.textContent = 'COPY';
          }, 1400);
        });
      });

      meta.append(label, button);
      pre.parentElement?.insertBefore(meta, pre);
    });
  }, [html, streaming]);

  if (!content.trim()) return null;

  return (
    <div
      ref={containerRef}
      className={cn('markdown', className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
