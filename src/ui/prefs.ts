// This browser's reading and testing preferences. They change how Praxis looks, never what
// the narrator is sent, so they live here rather than in the save.
import { useCallback, useEffect, useState } from 'react';

export interface Prefs {
  textSize: 'small' | 'standard' | 'large';
  storyFace: 'serif' | 'sans';
  // Testing: mark records the module calls unfinished.
  showDrafts: boolean;
  // Show the number beside each band.
  showNumbers: boolean;
  // The model that writes journal suggestions. Empty means the narration model.
  helperModel: string;
}

const KEY = 'praxis.prefs';
export const DEFAULT_PREFS: Prefs = { textSize: 'standard', storyFace: 'serif', showDrafts: true, showNumbers: false, helperModel: 'glm-4-6' };

function load(): Prefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      textSize: parsed.textSize === 'small' || parsed.textSize === 'large' ? parsed.textSize : 'standard',
      storyFace: parsed.storyFace === 'sans' ? 'sans' : 'serif',
      showDrafts: typeof parsed.showDrafts === 'boolean' ? parsed.showDrafts : DEFAULT_PREFS.showDrafts,
      showNumbers: typeof parsed.showNumbers === 'boolean' ? parsed.showNumbers : DEFAULT_PREFS.showNumbers,
      helperModel: typeof parsed.helperModel === 'string' ? parsed.helperModel : DEFAULT_PREFS.helperModel,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function apply(prefs: Prefs) {
  const root = document.documentElement;
  root.dataset.text = prefs.textSize;
  root.dataset.face = prefs.storyFace;
}

export function usePrefs(): [Prefs, (changes: Partial<Prefs>) => void] {
  const [prefs, setPrefs] = useState<Prefs>(load);
  useEffect(() => { apply(prefs); }, [prefs]);
  const update = useCallback((changes: Partial<Prefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...changes };
      try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* not remembered */ }
      return next;
    });
  }, []);
  return [prefs, update];
}
