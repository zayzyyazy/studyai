/**
 * Convert common LaTeX delimiters from models/PDFs into remark-math syntax
 * ($inline$, $$block$$). Skips fenced ``` code ``` blocks to avoid corrupting samples.
 */
export function normalizeLatexDelimiters(text) {
  if (!text || typeof text !== 'string') return '';

  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts
    .map((chunk) => {
      if (chunk.startsWith('```')) return chunk;
      return convertLatexDelimitersInPlainMarkdown(chunk);
    })
    .join('');
}

function convertLatexDelimitersInPlainMarkdown(s) {
  let out = s;
  // Display: \[ ... \]
  out = out.replace(/\\\[([\s\S]*?)\\\]/g, (_, inner) => `$$\n${inner.trim()}\n$$`);
  // Inline: \( ... \)
  out = out.replace(/\\\(([\s\S]*?)\\\)/g, (_, inner) => `$${inner.trim()}$`);
  return out;
}
