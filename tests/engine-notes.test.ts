import { describe, expect, it } from 'vitest';
import { MENTION_TOKENS, contextPlan, estimateTokens, keysFor, loadModule, mentionedNotes, say, setReply, startSave, type PraxisModule, type Save } from '../src/engine';
import { abernys, abernysRaw } from './abernys';

const module = abernys();

function must<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error((result as unknown as { reason: string }).reason);
  return result as Extract<T, { ok: true }>;
}

function withRaw(change: (raw: Record<string, any>) => void): PraxisModule {
  const raw = structuredClone(abernysRaw) as Record<string, any>;
  change(raw);
  const loaded = loadModule(raw);
  if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
  return loaded.module;
}

const sceneOf = (world: PraxisModule, save: Save) => contextPlan(world, save).messages.at(-1)!.content;

describe('mentioned records', () => {
  it('are called to mind by name, by the parts of a proper name, by title and by listed keys', () => {
    expect(keysFor('Ottavio Marrane', ['the Governor'], { proper: true })).toEqual(['Ottavio Marrane', 'Ottavio', 'Marrane', 'the Governor']);
    expect(keysFor('The gate Arbiter', undefined, { proper: true })).toEqual(['The gate Arbiter', 'gate Arbiter']);
    expect(keysFor('Humans', undefined, { plural: true })).toEqual(['Humans', 'Human']);
    const save = must(say(module, startSave(module), 't1', 'I ask about the Governor, and whether Marrane ever comes to the gate.')).save;
    const notes = mentionedNotes(module, save, save.turns.at(-1)!, new Set());
    expect(notes.filter((note) => note.startsWith('Ottavio Marrane, the Governor, Humans: Leads the colony.'))).toHaveLength(1);
    expect(notes.join('\n')).toContain("Usually at the Governor's court.");
  });

  it('come from the player\'s words and the last two replies, and skip what is already in the scene', () => {
    let save = startSave(module);
    save = must(say(module, save, 't1', 'I look around.')).save;
    save = must(setReply(save, 't1', 'Somewhere past the wall a bell rings for Cadfan the trader.')).save;
    save = must(say(module, save, 't2', 'I wait.')).save;
    save = must(setReply(save, 't2', 'The fog thickens.')).save;
    save = must(say(module, save, 't3', 'I keep waiting.')).save;
    save = must(setReply(save, 't3', 'Gulls.')).save;
    save = must(say(module, save, 't4', 'I ask the gate Arbiter about Brond.')).save;
    const scene = sceneOf(module, save);
    expect(scene).toMatch(/Mentioned, not here:\n- Brond, Head of Clan Aurochs/);
    // Cadfan was named three replies ago: out of reach.
    expect(scene).not.toContain('Cadfan, A fen trader');
    // The gate Arbiter is present, so she is not repeated as a mention.
    expect(scene.match(/The gate Arbiter, Humans:/g)).toHaveLength(1);
  });

  it('keep to their budget', () => {
    const crowd = withRaw((raw) => {
      for (const character of raw.characters) if (character.id !== 'traveller') character.description = 'A long account. '.repeat(30);
    });
    const named = 'Ottavio, Lucan, Ines, Cadfan, Brond, Bogwater, Caerwyn, Fenmire, Cairn Maw, the harbour, the registry and the garrison';
    const save = must(say(crowd, startSave(crowd), 't1', `${named}: I name them all.`)).save;
    const notes = mentionedNotes(crowd, save, save.turns.at(-1)!, new Set());
    expect(notes.length).toBeGreaterThan(1);
    expect(notes.length).toBeLessThan(12);
    expect(notes.reduce((sum, note) => sum + estimateTokens(note, save.options.tokensPerChar) + 2, 0)).toBeLessThanOrEqual(MENTION_TOKENS);
    // People come first.
    expect(notes[0]!.startsWith('Ottavio Marrane')).toBe(true);
  });

  it('cover lore blocks, species and things with their whereabouts', () => {
    const world = withRaw((raw) => {
      raw.world.lore.customs = 'Contracts that matter are tattooed on the skin, over the heart or along the forearm.';
      raw.world.species.find((species: { id: string }) => species.id === 'humans').description = 'The latest arrivals, neither predator nor prey.';
      raw.items = [{ id: 'seal', name: "The Governor's seal", description: 'Brass, heavy, warm from the hand.', heldBy: 'ottavio-marrane' }];
    });
    const save = must(say(world, startSave(world), 't1', "What are the customs here for humans? And the Governor's seal?")).save;
    const notes = mentionedNotes(world, save, save.turns.at(-1)!, new Set(['ottavio-marrane']));
    expect(notes).toContain('Customs: Contracts that matter are tattooed on the skin, over the heart or along the forearm.');
    expect(notes).toContain('Humans: The latest arrivals, neither predator nor prey.');
    expect(notes).toContain("The Governor's seal (carried by Ottavio Marrane): Brass, heavy, warm from the hand.");
  });
});

describe('the scene block', () => {
  it('describes the player by appearance only, and holds world and thing facts', () => {
    const world = withRaw((raw) => {
      const traveller = raw.characters.find((character: { id: string }) => character.id === 'traveller');
      traveller.appearance = 'Road dust to the knees, a pack with one strap mended in twine.';
      traveller.speech = 'Should never reach the narrator.';
      raw.ruleset.states.push({ id: 'tide', name: 'Tide', scope: 'world', min: 0, max: 2, start: 0, bands: [{ at: 0, label: 'is out' }, { at: 2, label: 'is in' }], restBand: 0 });
    });
    let save = startSave(world);
    save = { ...save, values: { ...save.values, world: { tide: 2 } } };
    const scene = sceneOf(world, must(say(world, save, 't1', 'I look.')).save);
    expect(scene).toContain('Looks: Road dust to the knees, a pack with one strap mended in twine.');
    expect(scene).not.toContain('Should never reach the narrator.');
    expect(scene).toMatch(/\nFacts:\n- Abernys is in\./);
  });

  it('refuses items placed somewhere unknown', () => {
    const raw = structuredClone(abernysRaw) as Record<string, any>;
    raw.items = [{ id: 'x', name: 'X', locationId: 'nowhere' }];
    const loaded = loadModule(raw);
    expect(loaded.ok).toBe(false);
  });
});
