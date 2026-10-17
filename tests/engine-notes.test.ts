import { describe, expect, it } from 'vitest';
import { LORE_TOKENS, act, contextPlan, estimateTokens, keysFor, loadModule, say, setReply, startSave, type PraxisModule, type Save } from '../src/engine';
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

// The lorebook section and the reply's opening.
const loreOf = (world: PraxisModule, save: Save) => contextPlan(world, save).messages[1]!.content;
const prefillOf = (world: PraxisModule, save: Save) => contextPlan(world, save).prefill;
// The entries switched on by key: everything after you, the place, who is present and what
// lies between them.
const keyed = (lore: string) => lore.split('\n').filter((line) => !/^\[ (You are|The landward gate,|Present at|The gate Arbiter and)/.test(line) && line.startsWith('['));

describe('lore switched on by key', () => {
  it('is called to mind by name, by the parts of a proper name, by title and by listed keys', () => {
    expect(keysFor('Ottavio Marrane', ['the Governor'], { proper: true })).toEqual(['Ottavio Marrane', 'Ottavio', 'Marrane', 'the Governor']);
    expect(keysFor('The gate Arbiter', undefined, { proper: true })).toEqual(['The gate Arbiter', 'gate Arbiter']);
    expect(keysFor('Humans', undefined, { plural: true })).toEqual(['Humans', 'Human']);
    const save = must(say(module, startSave(module), 't1', 'I ask about the Governor, and whether Marrane ever comes to the gate.')).save;
    const lore = loreOf(module, save);
    expect(lore.match(/\[ Ottavio Marrane, the Governor, of the Humans: Leads the colony\./g)).toHaveLength(1);
    expect(lore).toContain("Usually at the Governor's court, and not here now.");
  });

  it('stays on from when it is named until you leave, and is never said twice', () => {
    let save = startSave(module);
    save = must(say(module, save, 't1', 'I look around.')).save;
    save = must(setReply(save, 't1', 'Somewhere past the wall a bell rings for Cadfan the trader.')).save;
    save = must(say(module, save, 't2', 'I wait.')).save;
    save = must(setReply(save, 't2', 'The fog thickens.')).save;
    save = must(say(module, save, 't3', 'I keep waiting.')).save;
    save = must(setReply(save, 't3', 'Gulls.')).save;
    save = must(say(module, save, 't4', 'I ask the gate Arbiter about Brond.')).save;
    const lore = loreOf(module, save);
    expect(lore).toMatch(/\[ Brond, Head of Clan Aurochs, of the Bovinefolk: .* and not here now\. \]/);
    // Cadfan came up three replies ago, in this scene: still on.
    expect(lore).toContain('[ Cadfan, a fen trader');
    // In the order they came up, after the scene's own entries.
    expect(lore.indexOf('[ Cadfan')).toBeLessThan(lore.indexOf('[ Brond'));
    // The gate Arbiter is here: her profile once, and her line in the dramatis personae without
    // her description, which her profile carries.
    expect(lore.match(/\[ The gate Arbiter, of the Humans: /g)).toHaveLength(1);
    expect(lore).toMatch(/\[ Present at the landward gate, [a-z ]+: The gate Arbiter, keeping the ledger at the landward gate\. /);
    // Leave, and the scene starts over.
    const away = must(act(module, save, 't5', { type: 'travel', to: 'pc-outside-walls' })).save;
    expect(loreOf(module, away)).not.toContain('[ Cadfan');
  });

  it('takes the longest name that matches, so a garrison guard is not the garrison', () => {
    const lore = loreOf(module, must(say(module, startSave(module), 't1', 'I look at the guard. The garrison guard looks back.')).save);
    expect(lore).toContain('[ A garrison guard, of the Humans: ');
    expect(lore).not.toContain('[ The garrison, a building');
  });

  it('keeps to its budget, people here first', () => {
    const crowd = withRaw((raw) => {
      for (const character of raw.characters) if (character.id !== 'traveller') character.description = 'A long account. '.repeat(30);
    });
    const named = 'Ottavio, Lucan, Ines, Cadfan, Brond, Bogwater, Caerwyn, Fenmire, Cairn Maw, the harbour, the registry and the garrison';
    const save = must(say(crowd, startSave(crowd), 't1', `${named}: I name them all.`)).save;
    const entries = keyed(loreOf(crowd, save));
    expect(entries.length).toBeGreaterThan(1);
    expect(entries.reduce((sum, entry) => sum + estimateTokens(entry, save.options.tokensPerChar) + 2, 0)).toBeLessThanOrEqual(LORE_TOKENS + 4);
    expect(entries.some((entry) => entry.startsWith('[ The gate Arbiter, of the Humans'))).toBe(true);
  });

  it('covers lore blocks, species and things with their whereabouts', () => {
    const world = withRaw((raw) => {
      raw.world.lore.customs = 'Contracts that matter are tattooed on the skin, over the heart or along the forearm.';
      raw.world.species.find((species: { id: string }) => species.id === 'humans').description = 'The latest arrivals, neither predator nor prey.';
      raw.items = [{ id: 'seal', name: "The Governor's seal", description: 'Brass, heavy, warm from the hand.', heldBy: 'ottavio-marrane' }];
    });
    const save = must(say(world, startSave(world), 't1', "What are the customs here for humans? And the Governor's seal?")).save;
    const lore = loreOf(world, save);
    expect(lore).toContain('[ Customs: Contracts that matter are tattooed on the skin, over the heart or along the forearm. ]');
    expect(lore).toContain('[ Humans: The latest arrivals, neither predator nor prey. ]');
    expect(lore).toContain("[ The Governor's seal, carried by Ottavio Marrane: Brass, heavy, warm from the hand. ]");
  });
});

describe('the lorebook section and the reply\'s opening', () => {
  it('describes you by appearance only, and keeps world and thing conditions true', () => {
    const world = withRaw((raw) => {
      const traveller = raw.characters.find((character: { id: string }) => character.id === 'traveller');
      traveller.appearance = 'Road dust to the knees, a pack with one strap mended in twine.';
      traveller.speech = 'Should never reach the narrator.';
      raw.ruleset.states.push({ id: 'tide', name: 'Tide', scope: 'world', min: 0, max: 2, start: 0, bands: [{ at: 0, label: 'is out' }, { at: 2, label: 'is in' }], restBand: 0 });
    });
    let save = startSave(world);
    save = { ...save, values: { ...save.values, world: { tide: 2 } } };
    save = must(say(world, save, 't1', 'I look.')).save;
    const lore = loreOf(world, save);
    expect(lore).toMatch(/^\[ You are the traveller: .*Looks: Road dust to the knees, a pack with one strap mended in twine\. \]/m);
    expect(lore).not.toContain('Should never reach the narrator.');
    expect(prefillOf(world, save)).toContain('\n- Remember that Abernys is in.\n');
  });

  it('refuses items placed somewhere unknown', () => {
    const raw = structuredClone(abernysRaw) as Record<string, any>;
    raw.items = [{ id: 'x', name: 'X', locationId: 'nowhere' }];
    const loaded = loadModule(raw);
    expect(loaded.ok).toBe(false);
  });
});
