# Praxis Changelog

Newest first.

Praxis is pre-alpha. Versions below `0.1.0` do not exist; the project starts at
`0.1.0` so that every change from the first commit onward is recorded.

Use `X.Y.Z` semantic versioning, where `Z` is required. A new milestone gets a
short human-readable name after the version.

## 0.7.0 - First Narration - 2026-10-14

- Add turns. Speaking or acting opens a turn; an action is resolved by the rules
  first and carries its outcome to the narrator for that turn only. A reroll replaces
  the narration without resolving the action again. Undo restores the world as it was
  before the turn and drops everything recorded since.
- Add the context compiler. The narrator's rules and the world's canon come first,
  then the transcript, then the moment: the scene, who is present, standing facts,
  the ways out (closed ones with their reasons), the outcome and the player's words.
  The clock reaches the narrator only as its time band.
- Add per-character maximums and bands read as a share of them, so the Four
  Approaches NPC tiers (a minion's 2 Health, a rival's 5) read correctly. The gate
  staff in the Abernys module now use them.
- Add a NovelAI relay to the server: the player's key travels with each request and
  is never stored, logged or echoed; only the models and chat paths are forwarded,
  and every body is validated first.
- Add browser saves. Every change is saved in this browser with its module beside it;
  saves can be continued, deleted, exported to a file and imported on any device.
- The shell now narrates: connect NovelAI, write, narrate, reroll, undo, and inspect
  exactly what the narrator was sent.

## 0.6.0 - Clock and Travel - 2026-10-14

- Add the story clock, ported from Character Engine: one stored number of minutes,
  an authored calendar (the real one by default), and time bands as the only time
  words the model will be given.
- Add places and travel. A hop into or out of a place is priced by its depth tier;
  authored routes are priced by distance at the module's walking pace. Journeys take
  the quickest open way and resolve in one step. Routes can require a state of the
  player's character, in one direction or both, with the reason shown when closed.
- Add the save: clock, positions, state values and a ledger. Travel and waiting are
  actions; setting a state, the clock or anyone's position by hand are overrides,
  recorded as the player's.
- Add scene presence: the place, who else is there, the ways out and the time.
- Add the first module, *Abernys: Port Covenant*, built from the Abernys docs.
  Invented details (distances, district names, the gate staff, the player character)
  are marked `canonStatus: "draft"`.
- The development shell now plays the module without a model: travel, wait, set any
  value, read the ledger.

## 0.5.0 - Rebuild - 2026-10-14

- Replace the Java bridge and browser prototype with a TypeScript rebuild on the
  Orbis and Speculus stack: React and Vite, a thin Express server, zod and Vitest.
  The previous prototype remains in the history at `d3b13ee`.
- Add the engine's state primitive, ported from Character Engine: scoped bounded
  values, clamping at the write, bands with a resting band, standing-fact lines,
  terminals that fire on crossing, and a ledger entry for every change that names
  whether a rule or the player made it.
- Add the `praxis-module/1` format: Orbis-shaped world records, characters, items,
  a state catalog and a scenario, with reference and cycle checks.
- Add a development shell that loads and validates a module file.
- Add a CI workflow running tests, type checks and the build.
- `package.json` is now the only version source.

## 0.4.0 - Free-roam Controls - 2026-10-05

- Continue the existing Praxis slice with a reading window above a multiline
  action prompt and switchable Manual, Assisted AI and Full AI control modes.
- Keep optional Hollowmere milestones, travel, fatigue, Endurance rolls and
  character panels. Market and Bakery remain test fixtures.
- Add mode-specific narration instructions and `/api/v1/ai/action` for one
  player-triggered Full AI action selected from the current available choices.
- Reject unavailable action keys before resolving prototype mechanics. AI
  responses never apply model-supplied health, inventory or other state fields.
- Add Pause AI, discard stale responses, and prevent overlapping actions.
- Save/resume local state, transcript, goal, mode and draft without API tokens.
  Preserve unreadable saves and confirm before resetting.
- Route travel before incidental “look” verbs, reject unmapped destinations,
  preserve the exact submitted text and avoid duplicate history entries.
- Extract browser session/application code and add Java boundary tests and
  Node tests for intent routing, action choices, saves and history.
- Health and inventory mechanics and server-owned sessions remain future work.

## 0.3.0 - AI Pipe - 2026-09-30

### NovelAI bridge

- Start the Java runtime side with a small HTTP service bound to
  `127.0.0.1:8787` by default.
- Add NovelAI as the first narration provider through the current
  OpenAI-compatible text endpoint.
- Add `GET /api/v1/health`, `GET /api/v1/ai/models`,
  `POST /api/v1/ai/turn`, and `POST /api/v1/ai/director`.
- Accept a user's NovelAI Persistent API token through the
  `X-NovelAI-Token` request header. The browser keeps that token in memory only
  and does not write it to localStorage.
- Keep optional server-side `NOVELAI_TOKEN` support as a development fallback,
  not a repository secret.
- Add model discovery and a default `glm-4-6` model selection.
- Keep every generation request tied to a human action in the prototype.

### Narration boundary

- Send only the active Praxis scene projection, story phase, player condition,
  visible exits/items, runtime-approved objectives, short conversation history,
  and already-resolved outcomes to the narrator.
- Explicitly instruct the narrator not to invent persistent state, hidden scene
  contents, inventory, successful rolls, movement, task completion or canon.
- Return narration separately from authoritative state and always mark
  `authoritativeStateChanged: false` on AI responses.

### Story Director

- Add a first Story Director pipe that turns one runtime-approved objective into
  a natural task briefing.
- Reject AI task responses that select an objective key outside the supplied
  allowed set.
- Keep the current allowed-objective set in the browser prototype for now, with
  the production requirement documented: the Java runtime must own the rail and
  objective set before Praxis can treat it as authoritative.

### Hollowmere prototype

- Upgrade `prototype/hollowmere-demo.html` to the v0.3.0 AI-pipe slice.
- Add live free-text narration and scene-present NPC conversation when NovelAI is
  connected.
- Add an AI setup dialog with memory-only Persistent API token handling and model
  selection.
- Add **Ask for next task** to the Story panel.
- Keep time, fatigue, movement, rolls and milestones in Praxis state rather than
  handing them to the model.
- Preserve a deterministic fallback mode when no AI token is connected.
- Add `prototype/praxis-ai.js` as the browser-side bridge client.

### Build and documentation

- Add a Java 21 Maven build and shaded executable JAR target.
- Add Jackson for JSON request/response handling.
- Ignore Maven `target/` output.
- Add `docs/AI_PIPELINE.md` with API contracts, provider boundary, token handling,
  build steps and the nginx proxy shape for deployment.

## 0.2.0 - Hollowmere Story Slice - 2026-09-30

### Story model

- Define Praxis as authored stories on **semi-hard rails** rather than a fully
  open-world simulation.
- Keep freeform talking, investigation and local exploration inside active
  scenes while allowing the story to enforce milestones, access rules, branches
  and consequences.
- Make time and fatigue first-class costs of freedom. Conversation, exploration,
  waiting, rest, exertion and movement can advance authoritative state.
- Record that system rolls are used when uncertain actions matter to persistent
  state rather than letting narration choose the result.

### Scene presence

- Adopt **scene presence** as the active context boundary.
- Define the scene-state payload around current location, story phase, time,
  fatigue, present characters, available local interactions and story progress.
- Keep inactive or inaccessible scene contents out of narration context.
- Keep the HUD/runtime state visible so the player can distinguish narrative
  texture from authoritative recorded state.

### Hollowmere prototype

- Add `prototype/hollowmere-demo.html` based on the supplied Praxis functional
  concept.
- Replace the abstract dungeon as the immediate development target with a small
  Hollowmere starter slice.
- Add a tiny orientation rail with market, bakery and return milestones.
- Add free text actions, local look/talk/explore/rest actions, runtime-owned
  scene transitions, time advancement and fatigue/recovery.
- Preserve the dice concept by requiring an Endurance check for scene movement
  at high fatigue.
- Add a scene-state / Author's Note preview showing exactly what the narrator is
  allowed to know about the active scene.
- Keep the market and bakery scenes explicitly marked as **test fixtures**, not
  final Orbis canon or final Bitterroot map structure.
- Retain the responsive phone layout from the supplied prototype.

### Architecture and hosting

- Establish that Praxis is **Java-driven**. The planned Java runtime / API owns
  authoritative reality; the web GUI is a presentation layer above it.
- Keep authoritative story/session state, action validation, movement/access,
  inventory/economy, fatigue/health, dice/checks, context gating and persistence
  on the runtime side in the production design.
- Keep NovelAI or another narration provider outside authoritative state.
- Keep Praxis separate from Speculus, Fabula and Orbis while the interaction
  model is being proven.
- Keep the GUI loosely coupled to a versioned API contract and redesignable,
  especially for mobile, without changing runtime rules.
- Keep the current HTML/JavaScript prototype explicitly non-production. The
  JavaScript state engine proves the interaction model only.
- Keep the Java runtime implementation as the next architecture step after the
  story/session API contract is stable.
- Serve a temporary work-in-progress landing page at
  `praxis.thehowlingwhispers.com`.
- Serve it from `/var/www/praxis` through the nginx `praxis.conf` vhost.
- Activate HTTPS with a Let's Encrypt certificate and keep HTTP redirected to
  HTTPS while preserving ACME renewal access.
- Confirm automatic certificate renewal with `certbot renew --dry-run`.

## 0.1.0 - Praxis Pre-Alpha

- Establish the repository as the experimental player-facing narrative/state
  bridge between freeform AI text and authoritative game state.
- Confirm Praxis stays completely separate from Speculus and Fabula. No imports,
  forks or shared runtime code while the interaction model is unproven.
- Start from the three-room demo concept as the development target.
- Defer the Java runtime and backend until the interaction model is proven.
- `main` only. No feature branches.
