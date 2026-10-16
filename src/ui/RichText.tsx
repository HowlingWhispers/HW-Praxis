// Roleplay formatting: narration and action in single asterisks, speech as plain text,
// thoughts in parentheses, and notes outside the story in square brackets. Built as
// elements, never as HTML strings.
import type { ReactNode } from 'react';

const TOKEN = /(\*[^*\n]+\*|\([^)\n]+\)|\[[^\]\n]+\])/g;

function line(text: string): ReactNode[] {
  return text.split(TOKEN).filter(Boolean).map((part, index) => {
    if (part.startsWith('*') && part.endsWith('*')) return <em key={index} className="rp-action">{part.slice(1, -1)}</em>;
    if (part.startsWith('(') && part.endsWith(')')) return <span key={index} className="rp-thought">{part}</span>;
    if (part.startsWith('[') && part.endsWith(']')) return <span key={index} className="rp-note">{part}</span>;
    if (!part.trim()) return <span key={index}>{part}</span>;
    return <span key={index} className="rp-dialogue">{part}</span>;
  });
}

export function RichText({ text }: { text: string }) {
  return (
    <div className="rp">
      {text.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{line(paragraph)}</p>)}
    </div>
  );
}
