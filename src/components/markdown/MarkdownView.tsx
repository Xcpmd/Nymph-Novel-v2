'use client';

import { memo, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

import { splitDialogue } from '@/lib/markdown/dialogue';

/**
 * 正文渲染。
 *
 * 使用 rehype-sanitize 做 XSS 防护，只保留安全标签与属性；
 * 角色发言按引号识别并高亮，正文使用易读的衬线字体与较大行距。
 */

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-./]],
  },
};

/** 把 React 子节点里的字符串部分按引号切开并高亮对话。 */
function highlight(children: ReactNode, enabled: boolean): ReactNode {
  if (!enabled) return children;
  if (typeof children === 'string') {
    const parts = splitDialogue(children);
    if (parts.length === 1 && !parts[0]?.dialogue) return children;
    return parts.map((part, index) =>
      part.dialogue ? (
        <span key={index} className="dialogue">
          {part.text}
        </span>
      ) : (
        <span key={index}>{part.text}</span>
      ),
    );
  }
  if (Array.isArray(children)) {
    return children.map((child, index) =>
      typeof child === 'string' ? <span key={index}>{highlight(child, enabled)}</span> : child,
    );
  }
  return children;
}

export interface MarkdownViewProps {
  content: string;
  highlightDialogue?: boolean;
  fontSize?: number;
  lineHeight?: number;
  className?: string;
}

function MarkdownViewInner({
  content,
  highlightDialogue = true,
  fontSize = 18,
  lineHeight = 1.9,
  className,
}: MarkdownViewProps) {
  return (
    <div
      className={`prose-novel max-w-none text-text ${className ?? ''}`}
      style={{ fontSize: `${fontSize}px`, lineHeight }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
        components={{
          p: ({ children }) => <p>{highlight(children, highlightDialogue)}</p>,
          li: ({ children }) => <li>{highlight(children, highlightDialogue)}</li>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-accent underline decoration-dotted">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownView = memo(MarkdownViewInner);
