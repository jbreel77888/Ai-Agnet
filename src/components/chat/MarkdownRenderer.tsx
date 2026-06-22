'use client';

/**
 * MarkdownRenderer — GitHub-flavored markdown with syntax-highlighted code blocks.
 *
 * - Uses `react-markdown` + `remark-gfm` for tables, strikethrough, task lists.
 * - Code blocks rendered with `react-syntax-highlighter` (Prism, one-dark theme).
 * - Inline copy button on every code block.
 * - Links open in new tab safely (`target=_blank rel=noopener`).
 * - Images are responsive and rounded.
 */
import { memo, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Check, Copy } from 'lucide-react';

interface MarkdownRendererProps {
  content: string;
  /** Compact mode for tighter spacing (used inside small cards). */
  compact?: boolean;
}

function CodeBlock({ language, value }: { language: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [value]);

  return (
    <div className="relative group my-3 rounded-md overflow-hidden border border-slate-700/50">
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800/80 text-[10px] font-mono text-slate-300 uppercase tracking-wide">
        <span>{language || 'text'}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] hover:bg-slate-700 transition-colors"
          aria-label="Copy code"
        >
          {copied ? (
            <><Check className="w-3 h-3 text-emerald-400" /> Copied</>
          ) : (
            <><Copy className="w-3 h-3" /> Copy</>
          )}
        </button>
      </div>
      <SyntaxHighlighter
        language={language || 'text'}
        style={oneDark}
        customStyle={{
          margin: 0,
          padding: '12px 14px',
          fontSize: '12.5px',
          background: '#1e1e2e',
        }}
        codeTagProps={{ style: { fontFamily: 'var(--font-geist-mono), ui-monospace, monospace' } }}
        wrapLongLines
      >
        {value}
      </SyntaxHighlighter>
    </div>
  );
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  compact = false,
}: MarkdownRendererProps) {
  if (!content) return null;
  return (
    <div
      className={`markdown-body ${compact ? 'text-[13px]' : 'text-[14px]'} leading-relaxed break-words`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Code — distinguish inline vs block
          code({ inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '');
            const value = String(children).replace(/\n$/, '');
            if (inline || (!match && !value.includes('\n'))) {
              return (
                <code
                  className="px-1.5 py-0.5 mx-0.5 rounded bg-slate-100 dark:bg-slate-800 text-rose-600 dark:text-rose-400 font-mono text-[12.5px] border border-slate-200 dark:border-slate-700"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return <CodeBlock language={match?.[1] || ''} value={value} />;
          },
          p({ children }) {
            return <p className={`mb-3 last:mb-0 ${compact ? 'text-[13px]' : ''}`}>{children}</p>;
          },
          h1: ({ children }) => <h1 className="text-xl font-bold mt-4 mb-3 first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="text-lg font-bold mt-4 mb-2 first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="text-base font-semibold mt-3 mb-2 first:mt-0">{children}</h3>,
          h4: ({ children }) => <h4 className="text-sm font-semibold mt-3 mb-1.5 first:mt-0">{children}</h4>,
          ul: ({ children }) => <ul className="list-disc pl-5 mb-3 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 mb-3 space-y-1">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-sky-600 hover:text-sky-700 underline underline-offset-2">
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-slate-300 dark:border-slate-600 pl-3 italic text-muted-foreground my-3">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-4 border-t border-slate-200 dark:border-slate-700" />,
          table: ({ children }) => (
            <div className="overflow-x-auto my-3 rounded-md border">
              <table className="min-w-full text-[13px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-slate-100 dark:bg-slate-800">{children}</thead>,
          th: ({ children }) => <th className="px-3 py-1.5 text-left font-semibold border-b">{children}</th>,
          td: ({ children }) => <td className="px-3 py-1.5 border-b border-slate-100 dark:border-slate-800">{children}</td>,
          img: ({ src, alt }) => (
            <img src={typeof src === 'string' ? src : ''} alt={alt || ''} className="max-w-full rounded-md my-3 border" />
          ),
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
