// Roleplay formatting: narration and action in single asterisks, dialogue in double quotes,
// inner voice in square brackets. Built as elements, never as HTML strings.
import type { ReactNode } from 'react';

const TOKEN = /(\*[^*\n]+\*|"[^"\n]+"|\[[^\]\n]+\])/g;

function line(text: string): ReactNode[] {
  return text.split(TOKEN).filter(Boolean).map((part, index) => {
    if (part.startsWith('*') && part.endsWith('*')) return <em key={index} className="rp-action">{part.slice(1, -1)}</em>;
    if (part.startsWith('"') && part.endsWith('"')) return <span key={index} className="rp-dialogue">{part}</span>;
    if (part.startsWith('[') && part.endsWith(']')) return <span key={index} className="rp-thought">{part.slice(1, -1)}</span>;
    return <span key={index}>{part}</span>;
  });
}

export function RichText({ text }: { text: string }) {
  return (
    <div className="rp">
      {text.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{line(paragraph)}</p>)}
    </div>
  );
}
