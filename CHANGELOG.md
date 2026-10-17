# Praxis Changelog

Newest first.

Praxis is pre-alpha. Versions below `0.1.0` do not exist; the project starts at
`0.1.0` so that every change from the first commit onward is recorded.

Use `X.Y.Z` semantic versioning, where `Z` is required. A new milestone gets a
short human-readable name after the version.

## 0.14.0 - The Scene and Its Cast - 2026-10-16

- The narrator's context is laid out the way NovelAI lays out a story, with each thing
  sent once:
  - **First system message, fixed for the story:** brief rules, the house format shown by
    example from another story, and the world, with the land's top regions one line each.
  - **Second system message, the lorebook section:**
    - the story so far and you;
    - where you are (forced on while you are there);
    - who is present and what they are doing (the dramatis personae);
    - what lies between them;
    - lore switched on by key.
  - **The transcript:** each past turn keeps your words with what the rules decided.
  - **Your words this turn, alone.**
  - **The reply's opening, as NovelAI's prefill:** "Understood. I will: …" with the outcome
    and every condition to keep true, then "[Of course, here you go:]" and an opening `*`.
- The world-wide list of names is gone. Character and other lore switches on by key:
  - **From where:** anything named since the scene began, in your words, a reply or an outcome.
  - **How long:** it stays on until you leave.
  - **Short names:** someone present also answers to the last word of their name ("guard").
  - **Targets:** anyone a check targets switches on.
  - **Longer names win:** where two names overlap, the longer one counts, so "the garrison
    guard" is not the garrison.
- Outcomes and conditions are brief facts that say what they mean:
  - "It works.", "It gains ground, but it is not over yet.", "It fails: it makes no headway
    against …".
  - Conditions say whether more is needed: "is hurt: bleeding and slowed, but still fighting",
    "is close to giving way: still holding out, but not for much longer", "has given way:
    they believe you, back down or do as you ask, until something new changes their mind".
  - Any loss now leaves the resting band, so a success always shows.
  - The screen shows only the words before the colon.
- Schedules hold while you are with someone: nobody walks out mid-conversation. They are
  "due at the Governor's court by now" instead, and go when you leave, wait or rest.
- Followers: someone can come with you when you travel.
  - **Who:** a companion once your bond reaches its warmest two tiers (`followsFrom` on a
    bond kind changes that); a captive once they are down; or someone who has given way to you.
  - **The rules:** `ruleset.follow` lists these. Their row in Scene offers it, and
    "Bring along anyway" sets it by hand.
  - **On the road:** followers keep no schedule. Each journey checks their reason again, and
    anyone it no longer holds for stays behind.
- Narration in asterisks shows in italics. Settings › What the narrator was sent shows the
  prefill. A reply that repeats the prefill is trimmed to the story.

## 0.13.0 - The Context Ladder - 2026-10-16

- The house format is now speech as plain text with no quotation marks, *narration and
  action* in asterisks, and (thoughts) in parentheses, which nobody else in the story
  hears. Square brackets are for notes outside the story: the game's to the narrator, or
  the player's. The story view, the composer, the Guide, the opening and AGENTS.md follow it.
- What the narrator is sent is laid out by how often it changes, and each thing has one
  home. The system message never changes in play: the directions, the world, a names-only
  list of who and where, and the journal. Then the transcript. Then the game's notes for
  the turn, as their own message: `[ Lore: … ]` for you and the people, things, groups and
  history here and anything just named; one `[ Scene: … ]` paragraph for where you are,
  who is here doing what, what shows and the ways out; and `[ Outcome: … ]` for what the
  rules decided. The player's words come last, alone.
- Nothing is said twice. A person's profile is lore while they are here and the scene only
  says they are here and what they are doing; the names list carries no descriptions; a
  fact the outcome states is not repeated in the scene that turn.
- Statuses read as story, in other people's terms: a guard "has given way to you: they
  believe you, back down or do as you ask", "is near death", "is wavering"; everyone at a
  place "is watching closely". States take `npcLabels` for this, and a terminal can carry a
  `playerNote` for when it is you who arrives there.
- An outcome says plainly what happened and what to do with it: "Flair succeeds. What you
  just tried works on the garrison guard. The garrison guard has given way to you … Show it
  in this reply, and let it change what the garrison guard does from here on." Failures,
  Focus, costs and side effects get the same treatment; arrival, waiting and resting are
  told to "you".
- A copied `[ Lore ]`, `[ Scene ]` or `[ Outcome ]` line is taken out of a reply. Settings
  › What the narrator was sent labels each message.
- *Abernys: Port Covenant* 0.6.0 takes its approach ratings, Health, Strain, Alert, dice
  and rest from the standard ruleset instead of repeating them, and its opening follows the
  house format.

## 0.12.0 - Four Ways - 2026-10-16

- Every person, thing and place in a scene can be acted on with the Four Approaches, with
  nothing authored. People: Force hurts or overpowers (Health), Flair persuades, charms,
  bluffs or intimidates (Strain), Finesse lifts, slips past or plants (a deed: it works or
  it fails, and failure raises Alert), Focus reads them for Leverage. Things: Force breaks
  them (Integrity), Finesse picks or takes them (Security), Focus studies them (Prepared).
  The place: Finesse lies low (Alert), Focus searches it (Prepared).
- Focus builds an edge for the other approaches. Leverage on a person makes the next
  check against them one step easier per point; Prepared on a thing or place adds a boost
  die per point. Both go up to two and are spent on the next check by another approach,
  unless switched off on the check. The rules guide has a chapter with the odds.
- Difficulty comes from the target: its own, by approach or for all; a random one fixed by
  the save's seed; its tier (minion Easy, rival Average, nemesis Hard); or the module's.
- Something in the story: on the check screen, name a door, a crowd or two guards, say
  how hard it is, and it joins your records, here, aimed at.
- The check screen is rebuilt around who or what you aim at, with what each approach does
  to it and how hard. Things in the Scene show their state and offer a check.
- The standard ruleset, `four-approaches/1`: a module that extends it gets the Four
  Approaches states, costs, dice, rest, tiers and deeds beneath its own, so a world with
  no rules of its own is playable.
- *Abernys: Port Covenant* 0.5.0 extends the standard ruleset, gives its people tiers, and
  adds the registry strongroom door (Daunting to force, Hard to pick). All draft.

## 0.11.0 - The Narrator's Notes - 2026-10-16

- The narrator's instructions are rewritten for GLM-4.6 as what to do rather than what
  not to: a text adventure in second person, present tense; each reply is the next beat
  and stops where the player can act; time moves only as far as the player's action; the
  scene is the truth of the moment; an Outcome is shown exactly as decided.
- The scene's notes now sit in one labelled `<scene>` block before the player's words,
  instead of lines in square brackets, which are the player's inner voice.
- Mentioned records: a person, place, group, piece of history, lore block, people, family
  or thing named in the player's words this turn or in the last two replies, and not
  already in the scene, gets a fuller note for that turn, within 800 tokens. Keys are the
  name, the name without its article, the parts of a person's proper name, a title role
  ("the Governor"), and any `keys` a record lists. The moment's reserve grows to 3,000.
- Gaps closed: the player character's appearance reaches the narrator (manner and voice
  stay the player's); world, faction and thing states off their resting band are facts;
  module items can lie somewhere or be carried (`locationId`, `heldBy`); a scene action
  that reaches a terminal tells the narrator.
- Xialong uses the same prompt as GLM-4.6 for now; a prompt built NovelAI's way is on hold.

## 0.10.1 - 2026-10-16

- `deploy/deploy.sh` deploys the newest `main` in one command on the server, following
  the owner's steps, and stops before the restart if any check fails. The README says how.

## 0.10.0 - Living World - 2026-10-16

- Dossiers. People can carry how they look, how they carry themselves and how they speak
  (Orbis's `appearance`, `personality` and `speech`). Everyone present reaches the
  narrator with theirs, within a fixed share of the window: a crowded room gives the
  later arrivals their first line only. The moment's reserve grows to 2,500 tokens.
- Schedules, in Character Engine's shape: a day of stops by the hour, other days picked by
  weekday, month, day of the month or a span of days. People follow their day as the
  clock moves, and a wait tells the narrator who left, who arrived and who came by and
  went on. Someone put somewhere by hand stays until their day next moves them. A new
  save starts everyone where their day has them. The Scene shows what each person is
  doing and until when.
- Relationships, one record per pair: what it is, what happens when both are in the
  room, and what each side wants. Its bond is a relationship state whose tiers are words.
  Relationships between people who are both present reach the narrator, and a tier off
  its resting band does too.
- Bonds in play. Start one with anyone from their row in Scene, write what lies between
  you, set its tier by hand or end it; it lives in your records and exports with them.
  A triumph against someone with the approach that owns the bond (Flair) warms it a
  tier, and a despair cools it. You lists your bonds.
- The turn's changes show comings and goings where you were; everyone's days elsewhere
  stay in the ledger.
- The rules guide has a chapter on people and bonds.
- *Abernys: Port Covenant* 0.4.0: dossiers and days for the gate staff, the Governor, the
  High Arbiter, the garrison captain, Cadfan (with a market day in Caerwyn) and Brond;
  four bond kinds (Acquaintance, Rivals, Friends, Uneasy allies); relationships between
  the Governor and the High Arbiter, the Governor and the captain, and the gate staff.
  All draft.
- Not yet: the evaluator, which waits on the generation test.

## 0.9.1 - 2026-10-16

- The menu is back where it was meant to be: in the same scroll as the story, under the
  prompt. Scroll past the prompt at the end of the story to reach the five sections,
  all closed until you open one. The header bar and the menu buttons on the prompt row
  are gone; the Scene heading now carries the place, the time and who is here.
- A check opens in the prompt's place. The journal, the rules guide and the record form
  open where the menu was, and going back returns to the section you came from.
- Opening a save, sending a turn or a reply landing shows the end of the story with the
  prompt at the foot of the screen. A reply taller than the screen shows from its start.
- The generation test, in Settings › Testing. It measures by time whether NovelAI reuses
  a long prompt it has just read, word for word or with a new ending, and whether a call
  on a second model costs the first its reuse. It reports in words and copies the numbers
  for pasting back. The relay now reports how long NovelAI took to answer.

## 0.9.0 - Dice - 2026-10-15

- Checks on the Four Approaches and Genesys dice. Choose what you are trying, against
  whom or what, the approach and a charge; see the dice and the exact odds, and what
  success and failure would do; then roll, or succeed without rolling.
- The rules settle every check. Success wears the target down by the net successes.
  Failure, and two or more threat, cost what the module's approach table says: Force in
  Health and noise, Finesse in Alert, Focus in time, Flair in Strain. A secondary approach
  adds a setback die and pays the owner's cost. An approach with no claim cannot move it.
- Charges spend and come back when all on an approach are used or after a full rest;
  pushing reuses a spent one for 2 Strain. Edge, Story Points on both sides, and the
  hidden momentum count work as the proposal says. Wounds and watchful scenes add
  setback dice.
- Waiting eight hours or more is a full rest: Health +1, Strain restored, charges fresh.
- Each check leaves a receipt in the story: the dice as rolled, the verdict and the
  chance it had. Settling without a roll is recorded as the player's choice, and
  Settings can make that the default.
- The narrator gets one outcome line per check, with the target's new band.
- *Abernys: Port Covenant* 0.3.0: the approach table, the traveller's charges (Flair
  trained), setbacks and the rest rule, all draft.
- Saves from 0.8 open with nothing spent.

## 0.8.0 - Play Screen - 2026-10-15

- A new interface. The story and the composer fill the screen. The menu is one scroll
  of five sections, one open at a time, each heading saying enough to know whether to
  open it: Scene, You, Map, World, Settings. On a phone it covers the story; on a wide
  screen it sits beside it.
- Every turn shows what changed and whether the rules or the player changed it. The
  scene's own actions, a short wait and the nearest ways out sit above the composer.
- The narrator's context is now sized to the model's window and laid out by how often
  each part changes. The transcript's start stays put between cuts and a whole piece
  leaves at once, so the prompt's prefix can be reused. A who's who of the world's
  people, groups and places goes in the system message, so the narrator reaches for
  what exists instead of inventing it, and the groups and history bearing on the scene
  go in the latest message.
- The journal keeps the story so far and is sent with every turn. Before a piece of
  story leaves the window, Praxis suggests a short entry recording it; when the journal
  passes its budget, it suggests combining the oldest entries. Nothing joins the journal
  until the player keeps it. The player can write, edit, archive and restore anything,
  and switch the suggestions off.
- Local records: the player can add people, places, things, groups and notes to a save.
  The narrator reads them like the module's own, a local place can be travelled to,
  and the records can be exported and imported on their own. The module never changes.
- Authored scene actions settled by the rules. *Abernys: Port Covenant* 0.2.0 adds
  signing the Covenant at the landward gate, and links the Pact to the Arbiters and to
  Port Covenant.
- A rules guide, How Praxis plays, written from the Four Approaches proposal.
- Settings for the model's window, reply length, journal budget and piece size, reading
  size and typeface, and a testing group: draft markers, numbers beside bands, what the
  narrator was sent, and diagnostics.
- A remembered NovelAI token connects by itself. The token estimate is corrected from
  NovelAI's own prompt counts.
- Saves from 0.7 open with an empty journal and default settings.

## 0.7.3 - Codespace Fix - 2026-10-15

- Codespaces now build Praxis and serve it the way production does, on port 8791,
  started on every codespace start rather than when an editor attaches.
- The page says "Loading Praxis…" until the app draws, and shows the error if the
  app script fails or the app crashes, instead of a blank page.
- CI now starts the production server and checks it serves the page and its script.

## 0.7.2 - GLM Prompt Route - 2026-10-15

- NovelAI's chat endpoint answered GLM-4.6 in completion format with empty text
  (113 tokens generated, none returned). Narration now defaults to sending one prompt
  in GLM's own chat format, thinking off, to the completions endpoint. The chat route
  stays available as a setting under Connect NovelAI.
- Diagnostics now name the endpoint and show the raw first choice, with long token
  lists shortened.

## 0.7.1 - Narration Diagnostics - 2026-10-14

- Give replies room for reasoning models: GLM-4.6 thinks before it answers, and the
  old 500-token limit could be spent entirely on thinking, leaving an empty reply.
  The default is now 2048.
- Explain that case by name when it happens, and strip leaked thinking from replies.
- Add a Diagnostics panel on the play screen: the last ten narration calls with what
  NovelAI sent back (status, finish reason, reply and reasoning lengths, usage, and
  NovelAI's own error text), without the token, with a copy button.
- Add a Codespaces setup: any branch can be opened in a codespace that installs
  and starts Praxis by itself, so changes can be tried with real narration before
  they are merged or deployed.

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
