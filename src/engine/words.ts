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
