import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { normalizeLatexDelimiters } from '../utils/normalizeMathMarkdown';

const rehypePlugins = [
  [rehypeKatex, { throwOnError: false, strict: false, trust: false }]
];

const remarkPlugins = [remarkGfm, remarkMath];

/**
 * Lecture-facing markdown: GFM + TeX math rendered with KaTeX (\(...\), \[...\], $, $$).
 */
export default function LectureMarkdown({ children, content, ...rest }) {
  const raw = typeof content === 'string' ? content : (typeof children === 'string' ? children : '');
  const source = normalizeLatexDelimiters(raw);

  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      {...rest}
    >
      {source}
    </ReactMarkdown>
  );
}
