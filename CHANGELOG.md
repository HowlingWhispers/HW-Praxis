# Praxis Changelog

Newest first.

Praxis is pre-alpha. Versions below `0.1.0` do not exist; the project starts at
`0.1.0` so that every change from the first commit onward is recorded.

Use `X.Y.Z` semantic versioning, where `Z` is required and `X` and `Y` may be
omitted as `0.1`. A new milestone gets a short human-readable name after the
version, as in `0.2.0 — State Bridge`.

## Unreleased: Java-driven architecture correction

- Establish that Praxis is **Java-driven**. The Java runtime / API owns
  authoritative reality; the web GUI is a presentation layer above it.
- Record the architecture explicitly:

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

- Make the boundaries binding and numbered: Java owns authoritative reality; the
  browser GUI presents state and sends actions but owns no game rules; NovelAI
  generates narration and NPC dialogue but never decides authoritative
  outcomes.
- Record that a generated statement does not automatically become world state,
  and that only runtime-validated actions may change persistent state.
- Record that context from inaccessible rooms/places must not be sent to
  NovelAI. Context gating is a Java-side access rule applied before generation,
  not a prompt suggestion.
- Keep Praxis separate from Speculus and Fabula. No imports, forks, or shared
  runtime code while the interaction model is unproven.
- Keep the GUI loosely coupled to a versioned API contract and explicitly
  redesignable later, especially for mobile, without touching the Java runtime.
- Keep the three-room demo concept, and reclassify it as the first vertical
  slice for proving the Java runtime/state boundary.
- Mark the existing HTML/JavaScript three-room demo as a UX and
  interaction-model prototype only. Its JavaScript state engine is explicitly
  not the intended production architecture.
- No Java implementation begins yet. It starts when the demo source is handed
  over and implementation is explicitly authorised.
- Record the intended production origin, `https://praxis.thehowlingwhispers.com`,
  as the canonical public host for Praxis, with the GUI, runtime API, absolute
  links, CORS origins and redirects all built against that single origin.
- Note that the host has no DNS record or certificate yet and nothing is
  deployed. The name is recorded so later work targets one origin.
- No sibling repository was modified.

## 0.1.0 — Praxis Pre-Alpha

- Establish the repository as the experimental player-facing narrative/state
  bridge between freeform Speculus-style AI text and Fabula-style authoritative
  game state.
- Confirm Praxis stays completely separate from Speculus and Fabula. No imports,
  forks or shared runtime code while the interaction model is unproven.
- Start from the three-room demo concept as the development target.
- Defer the Java runtime and backend until the interaction model is proven.
- `main` only. No feature branches.
