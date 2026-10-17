// Small helpers for turning names and labels into plain sentences for the narrator.

// "A gate runner" reads as "a gate runner" inside a sentence; "The harbour" as "the harbour".
export const midSentence = (text: string) => (/^(The|A|An) /.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text);

// Once someone is in the scene they are "the" one: "A garrison guard" becomes "The garrison guard".
export const definite = (name: string) => name.replace(/^(A|An) /, 'The ');

export const capital = (text: string) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

// Ends a fragment with a full stop unless it already ends a sentence.
export const sentence = (text: string) => {
  const clean = text.trim();
  return !clean ? '' : /[.!?)]$/.test(clean) ? clean : `${clean}.`;
};

// "a, b and c".
export const listOf = (items: readonly string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

// A note written about "them", turned to the player: "They take no further part" becomes
// "You take no further part". Plural verbs read the same either way.
export const toYou = (text: string) =>
  text
    .replace(/\bThey\b/g, 'You').replace(/\bthey\b/g, 'you')
    .replace(/\bThemselves\b/g, 'Yourself').replace(/\bthemselves\b/g, 'yourself')
    .replace(/\bThem\b/g, 'You').replace(/\bthem\b/g, 'you')
    .replace(/\bTheir\b/g, 'Your').replace(/\btheir\b/g, 'your');

// What the player wants, written in their own voice, as the narrator reads it:
// "She lets me through" becomes "she lets you through".
export const wantedAsYou = (text: string) => {
  const clean = text.trim().replace(/\s+/g, ' ').replace(/[.!]+$/, '');
  if (!clean) return '';
  const turned = clean
    .replace(/\bI am\b/g, 'you are').replace(/\bI'm\b/g, "you're").replace(/\bI was\b/g, 'you were')
    .replace(/\bI\b/g, 'you').replace(/\b[Mm]yself\b/g, 'yourself').replace(/\b[Mm]ine\b/g, 'yours')
    .replace(/\b[Mm]e\b/g, 'you').replace(/\bMy\b/g, 'Your').replace(/\bmy\b/g, 'your');
  return /^(She|He|They|It|The|A|An|You|Your|We|Our|Her|His|Their)\b/.test(turned) ? turned.charAt(0).toLowerCase() + turned.slice(1) : turned;
};

export interface Pronouns { they: string; them: string; their: string }

// "she/her" and the like, as the three forms a sentence needs. Unset or unknown reads as
// they/them.
export function pronounsOf(text: string | undefined): Pronouns {
  const first = (text ?? '').trim().toLowerCase().split(/[\s/,]+/)[0] ?? '';
  if (first === 'she') return { they: 'she', them: 'her', their: 'her' };
  if (first === 'he') return { they: 'he', them: 'him', their: 'his' };
  if (first === 'it') return { they: 'it', them: 'it', their: 'its' };
  return { they: 'they', them: 'them', their: 'their' };
}

export const THEY: Pronouns = { they: 'they', them: 'them', their: 'their' };
