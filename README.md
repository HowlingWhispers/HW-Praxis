# Praxis

Praxis is the experimental player-facing story layer for The Howling Whispers.
It is the narrative/state bridge where freeform AI roleplay meets authoritative
game state.

Praxis is now being developed as a **free-roam text RPG** in one world at a time.
Story milestones offer direction when wanted. Players can talk, investigate,
explore, travel and rest in their own way, while time, fatigue and checks still
constrain recorded outcomes.

The reading window sits above a multiline action prompt. Choose how much of the
character's writing to control:

| Mode | Player input | AI responsibility |
| --- | --- | --- |
| Manual | Actions and dialogue, in as much detail as desired | Surroundings and NPC reactions; preserve player control |
| Assisted AI | A short intention, such as “Go to the market and look around” | Fill in routine details; pause before important new decisions |
| Full AI | A character goal, then **Let AI act** | Propose one available action, let Praxis resolve it, then narrate it |

Full AI runs one step per click. **Pause AI** discards an unfinished response;
already resolved time, fatigue or travel remain recorded. Switch modes between
actions to take over. Enter adds a line; Ctrl/Cmd + Enter sends.

Players speak and act in ordinary language. Praxis decides what that language
*means* for authoritative state. AI narration can improvise atmosphere, dialogue
and story delivery, but it cannot silently make inventory, movement, rolls,
story progress or other persistent state true.

Praxis is **Java-driven**. The Java runtime/API owns the provider boundary and is
being grown into the authoritative story runtime. The web GUI remains a
presentation layer above it, not the game engine.

## Architecture

```text
Praxis Web GUI
    |
    v
Java Runtime / API
    |
    +-- authoritative story/session state
    +-- story rails, phases and milestones
    +-- scene presence and context gating
    +-- time and schedules
    +-- fatigue / health
    +-- action validation
    +-- movement and access constraints
    +-- doors, locks and interactables
    +-- inventory / economy
    +-- dice and checks
    +-- persistence
    |
    +--> NovelAI narration / dialogue / task delivery
```

The browser talks to the Praxis Java service. The service talks to the narration
provider. The browser must not become the long-term owner of rules, and the AI
provider never writes directly to state.

## The rules that define Praxis

1. **Java owns authoritative reality.** Story state, world/session state, rules,
   time, fatigue, rolls and persistence belong in the runtime.
2. **The browser GUI presents state and sends actions.** It renders what the
   runtime reports and submits player intents. It does not resolve production
   game rules.
3. **Narration is free inside the active scene.** Players can speak, investigate
   and explore naturally without turning the experience into a menu-only RPG.
4. **Narration does not decide persistent outcomes.** If prose says a locked door
   opened, the door is still locked unless Praxis validated the action.
5. **Only runtime-validated actions may change persistent state.** Movement,
   inventory, money, injuries, story milestones and other recorded changes pass
   through the runtime.
6. **Freedom has cost.** Talking, exploring, waiting, travel, exertion and rest
   can advance time or fatigue. The story can react to what the player spends.
7. **Scene presence gates context.** The active location, present characters,
   local items/interactables, story phase and player condition determine what is
   sent to narration.
8. **Story rails guide rather than puppet.** Rails define authored milestones,
   constraints, branches and consequences. They do not prescribe every line of
   dialogue or every moment-to-moment action.
9. **Keep Praxis separate from Speculus and Fabula for now.** Praxis does not
   import from, vendor, fork or modify sibling runtimes while this interaction
   model is being proven.

## Scene presence

Praxis treats every active scene as a context boundary. A narration request is
built from a compact projection such as:

```text
Story: A Morning in Hollowmere
Story phase: exploration
Location: Hollowmere
Time: 08:35
Fatigue: 2/10
Present: approved scene-present characters
Visible exits/items: approved local state
Allowed story objectives: runtime-approved keys
Resolved outcome: optional already-decided mechanic
```

Inactive or inaccessible scenes are not automatically exposed just because the
story knows they exist.

## Hollowmere starter slice

Hollowmere is the first Praxis test area. The prototype currently proves:

- Hollowmere as the story anchor
- optional story milestones within the current scene sandbox
- Manual, Assisted AI and Full AI control modes
- multiline writing with a reading window above the prompt
- local save/resume of state, mode, goals, draft and transcript
- free text conversation and exploration inside the current scene
- scene-presence context gating
- time advancement
- fatigue and recovery
- movement validated by Praxis state
- an Endurance check when exhaustion makes movement uncertain
- mobile-friendly HUD/navigation
- visible runtime state for debugging
- live NovelAI prose/dialogue through the Java AI bridge
- AI-delivered task briefings selected only from currently allowed story goals

The Market and Bakery remain lightweight **test fixtures**. They exist to test
story flow, time, fatigue, scene presence and AI piping. They are not a claim
about final Bitterroot/Orbis map structure.

Frontend sources:

```text
prototype/hollowmere-demo.html
prototype/praxis-ai.js
prototype/praxis-session.js
prototype/praxis-app.js
```

The browser still owns more prototype state than the production architecture
allows. That is temporary. The next runtime step is to move the rail, time,
fatigue, rolls and scene presence into Java.

## AI pipe

Praxis v0.4.0 extends the provider bridge with control modes and bounded action selection.

Endpoints:

```text
GET  /api/v1/health
GET  /api/v1/ai/models
POST /api/v1/ai/turn
POST /api/v1/ai/director
POST /api/v1/ai/action
```

NovelAI is the first provider, using its current OpenAI-compatible text API. The
prototype accepts the user's Persistent API token in `X-NovelAI-Token`. The
browser holds it in memory only for the page lifetime and does not save it to
localStorage.

`/api/v1/ai/turn` returns narration/dialogue and never authoritative mutations.
`/api/v1/ai/director` turns one currently allowed objective into a natural task
briefing. Invalid objective keys are rejected.
`/api/v1/ai/action` proposes one supplied action key for Full AI; unknown keys are
rejected again by the browser before any rule is resolved.

See [`docs/AI_PIPELINE.md`](docs/AI_PIPELINE.md) for the provider contract,
security notes, build steps and nginx proxy shape.

Local saves are specific to this browser and origin. They contain writing and
prototype state, never the API token. Refresh requires reconnecting NovelAI.
Reset asks before replacing a save. An unreadable save is preserved until an
explicit reset. Saves are not yet multiplayer or server-authoritative. Health
and inventory remain placeholders; searching for food cannot create items yet.
Unknown travel directions are rejected instead of silently converted to a look
action. This slice currently maps Hollowmere, the Market and the Bakery only.

## Build the Java bridge

Requires Java 21 and Maven:

```bash
mvn clean package
node --test tests/session.test.cjs
java -jar target/praxis-server.jar
```

Default bind:

```text
127.0.0.1:8787
```

The live nginx vhost should proxy `/api/` to that local service while serving the
frontend as static files.

## Development order

1. Prove live narration, dialogue and Story Director task delivery in Hollowmere.
2. Move the allowed story rail and objective set into Java so the browser cannot
   define authoritative tasks.
3. Move time, fatigue, rolls and scene presence into Java.
4. Move the local save/resume prototype to server-owned sessions.
5. Add health, inventory and richer actions to the free-roam foundation.
6. Decide the later Orbis integration boundary only after the runtime contract is
   stable.

## Deployment

Canonical origin:

```text
https://praxis.thehowlingwhispers.com
```

The existing nginx/TLS setup remains the deployment target. The Java service is
intended to stay bound to localhost behind nginx rather than being exposed on a
public port.

### TLS

| | |
| --- | --- |
| Origin | `https://praxis.thehowlingwhispers.com` |
| DNS | `A praxis -> 62.83.35.87` |
| Certificate | `/etc/letsencrypt/live/praxis.thehowlingwhispers.com/` |
| Issued by | Let's Encrypt (`YE1`) |
| Valid until | 2026-12-29 |
| Renewal | Automatic via `certbot.timer` |

The port 80 vhost keeps the ACME HTTP-01 challenge reachable and otherwise
redirects to HTTPS.

## Current version

`0.4.0` - Free-roam Controls. See [CHANGELOG.md](CHANGELOG.md).

## Branch model

- `main` is the only branch.
- `main` is the single source of truth for Praxis.

## License

Not yet chosen. Praxis has no license file until the project is past the
interaction-model experiment.
