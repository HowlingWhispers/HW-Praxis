# Praxis

Praxis is the experimental player-facing layer for The Howling Whispers. It is the
narrative/state bridge where freeform Speculus-style AI text meets Fabula-style
authoritative game state.

Players speak and act in ordinary language. Praxis decides what that language
*means* for the world, and the world answers with state that is real, inspectable
and consistent — not re-rolled prose.

Praxis is **Java-driven**. The Java runtime owns authoritative reality. The web
GUI is a presentation layer above it, not a game engine.

## Architecture

```
Praxis Web GUI
    |
    v
Java Runtime / API
    |
    +-- authoritative world/session state
    +-- action validation
    +-- movement and access constraints
    +-- doors, locks and interactables
    +-- inventory
    +-- stamina / health
    +-- dice and checks
    +-- context gating
    +-- persistence
    |
    +--> NovelAI narration layer
```

The browser talks to the Java runtime over a network API. The Java runtime talks
to NovelAI. The browser never talks to NovelAI directly, and NovelAI never writes
to state.

## The rules that define Praxis

1. **Java owns authoritative reality.** World and session state, rules, and
   persistence live in the Java runtime. Nothing else is authoritative.
2. **The browser GUI presents state and sends actions.** It renders what the
   runtime reports and submits player intents. It does not own game rules, does
   not resolve actions, and is not a source of truth that survives a reload.
3. **NovelAI generates narration and NPC dialogue, but does not decide
   authoritative outcomes.** It describes the world. It does not change it.
4. **A generated statement does not automatically become world state.** If the
   narration says the player opened a locked door, the door is still locked
   unless a validated action opened it.
5. **Only runtime-validated actions may change persistent state.** Every state
   transition is a Java-side validation that can refuse the action.
6. **Context from inaccessible rooms/places must not be sent to NovelAI.** The
   Java runtime builds the context payload and gates it. Gating is an access
   rule, not a prompt suggestion, and it happens before generation.
7. **Keep Praxis separate from Speculus and Fabula** for now. Praxis does not
   import from, vendor, fork, or modify Speculus, Fabula, Orbis or any other
   sibling repository. Any integration must be a deliberate, separate decision,
   and none has been made yet.

## The web GUI

The GUI is deliberately **loosely coupled** to the runtime:

- It consumes a versioned API contract and knows nothing about Java internals.
- All rules, rules-adjacent UI (availability, disabled actions, capacity) are
  reported by the runtime, not re-implemented in the client.
- It carries no authoritative state of its own and can be **redesigned later,
  especially for mobile**, without touching the Java runtime.

The GUI is a view. If the GUI would need to be rewritten to change how the game
works, the boundary is wrong.

## The three-room demo

Praxis starts from the three-room demo concept: three rooms, one player, and
enough authoritative state to make freeform interaction meaningful — walk into a
room, talk to something there, take or leave something, and see the world state
actually change as a result.

**The three-room demo is the first vertical slice for proving the Java
runtime/state boundary.** It is a UX and interaction-model prototype. The
prototype's JavaScript state engine is *not* the intended production
architecture and must not be mistaken for it.

The prototype exists to answer two questions:

1. Does freeform player input feel natural while still producing trustworthy
   state?
2. Does the GUI/runtime boundary hold — with the runtime owning the rules, the
   GUI only presenting them, and narration never becoming state?

What the prototype proves is the interaction model. What the Java runtime
implements is the authoritative reality. The Java implementation has not
started; it begins when the demo source is handed over and implementation is
explicitly authorised.

## Current version

`0.1.0` — Praxis Pre-Alpha. See [CHANGELOG.md](CHANGELOG.md).

## Branch model

- `main` is the only branch. No feature branches, no release branches.
- `main` is the single source of truth for Praxis.

## License

Not yet chosen. Praxis has no license file until the project is past the
interaction-model experiment.
