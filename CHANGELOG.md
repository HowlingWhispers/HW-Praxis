# Praxis Changelog

Newest first.

Praxis is pre-alpha. Versions below `0.1.0` do not exist; the project starts at
`0.1.0` so that every change from the first commit onward is recorded.

Use `X.Y.Z` semantic versioning, where `Z` is required. A new milestone gets a
short human-readable name after the version.

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
