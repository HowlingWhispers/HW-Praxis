# Praxis

Praxis is the experimental player-facing story layer for The Howling Whispers.
It is the narrative/state bridge where freeform AI roleplay meets authoritative
game state.

Praxis is built for **authored stories on semi-hard rails**. A story provides a
shape, milestones, time pressure, access rules, consequences and possible
branches, while the player remains free to talk, investigate, explore, wait,
rest and approach scenes in their own way. Freedom has systemic cost: time moves,
fatigue accumulates, resources change, schedules can move on, and risky actions
may require a system roll.

Players speak and act in ordinary language. Praxis decides what that language
*means* for authoritative state. Narration can improvise texture and dialogue,
but it cannot silently make inventory, movement, rolls, story progress or other
persistent state true.

Praxis is **Java-driven**. The planned Java runtime owns authoritative reality.
The web GUI is a presentation layer above it, not a game engine.

## Architecture

```
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
    +--> NovelAI narration / dialogue layer
```

The browser talks to the Java runtime over a network API. The Java runtime talks
to the narration provider. The browser never owns authoritative rules, and the
narrator never writes directly to state.

## The rules that define Praxis

1. **Java owns authoritative reality.** Story state, world/session state, rules,
   time, fatigue, rolls and persistence live in the runtime.
2. **The browser GUI presents state and sends actions.** It renders what the
   runtime reports and submits player intents. It does not resolve game rules.
3. **Narration is free inside the active scene.** Players can speak, investigate
   and explore naturally without turning the experience into a menu-only RPG.
4. **Narration does not decide persistent outcomes.** If prose says a locked door
   opened, the door is still locked unless Praxis validated the action.
5. **Only runtime-validated actions may change persistent state.** Movement,
   inventory, money, injuries, story milestones and other recorded changes pass
   through the runtime.
6. **Freedom has cost.** Talking, exploring, waiting, travel, exertion and rest
   can advance time or fatigue. The story can react to what the player spends.
7. **Scene presence gates context.** The runtime knows the current location,
   present characters, present items/interactables, current story phase and
   player condition. Only approved active-scene context is sent to narration.
8. **Story rails guide rather than puppet.** Rails define authored milestones,
   constraints, branches and consequences. They do not prescribe every line of
   dialogue or every moment-to-moment action.
9. **Keep Praxis separate from Speculus and Fabula for now.** Praxis does not
   import from, vendor, fork, or modify sibling repositories while the
   interaction model is still being proven.

## Scene presence

Praxis treats every active scene as a context boundary. The runtime should be
able to build a compact scene-state block such as:

```text
Story: A Morning in Hollowmere
Story phase: exploration
Location: Hollowmere
Time: 08:35
Fatigue: 2/10
Present: approved scene-present characters
Available local interactions: approved scene-present actions
Story milestones: current authoritative progress
```

The narration layer receives that active slice plus the relevant lore/context.
Inactive or inaccessible scenes are not automatically exposed just because the
story knows they exist.

## Hollowmere starter slice

Hollowmere is the first Praxis test area.

The first slice is intentionally small. It exists to prove the interaction model
before Praxis grows into larger authored stories. The current prototype tests:

- Hollowmere as the story anchor
- semi-hard story milestones rather than a fully open simulation
- free text conversation and exploration inside the current scene
- scene-presence context gating
- time advancement
- fatigue and recovery
- movement validated by runtime state
- a system check when exhaustion makes movement uncertain
- mobile-friendly HUD/navigation
- visible authoritative state for debugging

The prototype currently uses lightweight **test fixtures** for a Hollowmere
market scene and bakery scene. Those labels are there to exercise scene presence,
time, fatigue and story flow. They are not a replacement for canonical Orbis data
or a claim that the prototype defines the final Bitterroot map structure.

The source lives at:

```text
prototype/hollowmere-demo.html
```

It is still a UX and interaction-model prototype. Its JavaScript state engine is
not the intended production architecture and must not be mistaken for the future
Java runtime.

## The web GUI

The GUI is deliberately **loosely coupled** to the runtime:

- It consumes a versioned API contract and knows nothing about Java internals.
- Rules-adjacent UI such as availability, disabled actions, costs and capacity
  should be reported by the runtime rather than re-implemented in the client.
- It carries no authoritative state of its own in the production design.
- It must remain redesignable later, especially for mobile, without rewriting
  the game rules.

The GUI is a view. If the GUI would need to be rewritten to change how the game
works, the boundary is wrong.

## Development order

1. Prove the Hollowmere story interaction model in the browser prototype.
2. Lock down the story/session API contract.
3. Move authoritative state, time, fatigue, rolls, scene presence and story rails
   into the Java runtime.
4. Replace mock narration with the provider adapter.
5. Add persistence.
6. Only then decide how Praxis should consume canonical world data from Orbis.

This keeps Hollowmere useful as the test bed without hard-coding Praxis itself to
Bitterroot.

## Deployment

Praxis is intended to be served at:

```text
https://praxis.thehowlingwhispers.com
```

That is the canonical public origin for Praxis. Treat it as the single production
host: the GUI, runtime API, generated absolute links, CORS origins and redirects
should all resolve against it.

The host currently serves a **temporary work-in-progress landing page**. The
Hollowmere prototype is now stored in the repository, but it is not yet the live
Praxis application.

## Work-in-progress landing page

`praxis.thehowlingwhispers.com` currently serves a static placeholder page with
`noindex, no follow`. It describes the project and architecture. It is a
placeholder, not the product.

Served by nginx from `/var/www/praxis` via `/etc/nginx/sites-available/praxis.conf`.
There is no application proxy target or production Java backend yet.

### TLS

The host is live over HTTPS with a Let's Encrypt certificate.

| | |
| --- | --- |
| Origin | `https://praxis.thehowlingwhispers.com` |
| DNS | `A praxis -> 62.83.35.87` |
| Certificate | `/etc/letsencrypt/live/praxis.thehowlingwhispers.com/` |
| Issued by | Let's Encrypt (`YE1`) |
| Valid until | 2026-12-29 |
| Renewal | Automatic via `certbot.timer` |

The ACME HTTP-01 challenge location is kept on the port 80 vhost so renewals keep
working without the redirect getting in the way. Renewal has been verified with
`certbot renew --dry-run`.

Response headers served: `Strict-Transport-Security: max-age=31536000;
includeSubDomains`, `X-Content-Type-Options: nosniff`, `X-Frame-Options:
SAMEORIGIN`, `Referrer-Policy: no-referrer`. Plain HTTP 301-redirects to HTTPS.

To renew manually:

```bash
certbot renew --cert-name praxis.thehowlingwhispers.com
nginx -t && systemctl reload nginx
```

## Current version

`0.2.0` - Hollowmere Story Slice. See [CHANGELOG.md](CHANGELOG.md).

## Branch model

- `main` is the only branch. No feature branches, no release branches.
- `main` is the single source of truth for Praxis.

## License

Not yet chosen. Praxis has no license file until the project is past the
interaction-model experiment.
