# Praxis

Praxis is the experimental player-facing layer for The Howling Whispers. It is the
narrative/state bridge where freeform Speculus-style AI text meets Fabula-style
authoritative game state.

Players speak and act in ordinary language. Praxis decides what that language
*means* for the world, and the world answers with state that is real, inspectable
and consistent — not re-rolled prose.

## What Praxis is

- **Freeform in, authoritative out.** A player types or says anything. Praxis
  resolves it against the world and updates the canonical state that actually
  governs play.
- **Prose is presentation, not truth.** Generated text describes what happened.
  The state ledger decides what happened. If the two disagree, the ledger wins.
- **Experimental by design.** Praxis exists to prove the interaction model before
  it is bound to a production runtime.

## Relationship to other projects

Praxis is deliberately **completely separate** from Speculus and Fabula while the
interaction model is proven.

- **Speculus** owns the freeform simulation prose and its proven generation
  foundation.
- **Fabula** owns persistent authoritative world state: travel, time, inventory,
  encounters, player state and long-running worlds.
- **Praxis** is the experimental layer that tests whether freeform AI interaction
  can drive authoritative state without corrupting either side.

Praxis does not import from, vendor, fork, or modify Speculus, Fabula, Orbis or
any other sibling repository. Any integration must be a deliberate, separate
decision, and none has been made yet.

## Starting point: the three-room demo

Development starts from a working three-room demo concept. Three rooms, one
player, and enough authoritative state to make freeform interaction meaningful:
you should be able to walk into a room, talk to something there, take or leave
something, and see the world state actually change as a result.

The demo exists to answer one question: **does freeform player input feel
natural while still producing trustworthy state?** It is a question about the
interaction model, not about graphics, scale or features.

## Build order

1. Prove the interaction model in the three-room demo.
2. Prove the state/text boundary and its failure modes.
3. Only then decide on a Java runtime or any production backend.

No Java runtime, backend service or production architecture is committed to yet.
The demo is the deliverable for now.

## Current version

`0.1.0` — Praxis Pre-Alpha. See [CHANGELOG.md](CHANGELOG.md).

## Branch model

- `main` is the only branch. No feature branches, no release branches.
- `main` is the single source of truth for Praxis.

## License

Not yet chosen. Praxis has no license file until the project is past the
interaction-model experiment.
