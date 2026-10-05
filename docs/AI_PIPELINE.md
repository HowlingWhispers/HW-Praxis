# Praxis AI Pipeline

Status: pre-alpha, v0.4.0 bridge

Praxis now has the first real AI pipe for the Hollowmere prototype. The pipe is deliberately narrow: AI can narrate, speak as scene-present NPCs, and turn runtime-approved objectives into natural task briefings. It still cannot write authoritative world state.

## Provider

The first provider is NovelAI through the OpenAI-compatible text API at:

```text
https://text.novelai.net/oa/v1/chat/completions
```

Praxis uses a user's NovelAI Persistent API token. The browser prototype keeps the token in page memory only and sends it to the Praxis backend in the `X-NovelAI-Token` request header. The backend forwards it to NovelAI and does not persist it.

The backend also supports `NOVELAI_TOKEN` as a development/server fallback. Do not commit a token to the repository or put one in the public web root.

Default model:

```text
glm-4-6
```

The browser can query `/api/v1/ai/models` and select another model returned by the user's NovelAI account.

## Runtime boundary

```text
Player action
    |
    v
Praxis runtime state
    |
    +--> deterministic action / roll / time / fatigue
    |
    +--> active scene projection
             |
             v
        Praxis AI bridge
             |
             v
          NovelAI
             |
             v
        narration / dialogue
```

AI output is prose. It is not a state transaction.

A model may not directly:

- move the player
- add or remove inventory
- spend or grant money
- change health or fatigue
- unlock an exit
- decide a dice result
- complete a story milestone
- introduce inaccessible scene contents
- create authoritative canon

If prose implies one of those changes, the runtime remains authoritative.

## Scene presence

Every narration request receives only the active scene slice:

- story title / phase / status
- current location
- authored local description
- current time
- fatigue / health
- scene-present people
- visible exits
- visible items
- currently runtime-approved objectives
- any already-resolved mechanical outcome that the narrator is allowed to render

The model is instructed not to expose inactive scenes or entities that are not present.

## AI endpoints

### `GET /api/v1/health`

No NovelAI token required.

Returns bridge status and version.

### `GET /api/v1/ai/models`

Requires a NovelAI token in `X-NovelAI-Token`, unless the server has a development `NOVELAI_TOKEN` fallback.

Proxies the provider's available model list.

### `POST /api/v1/ai/turn`

Produces narration or NPC dialogue from the active Praxis scene.

Example body:

```json
{
  "model": "glm-4-6",
  "controlMode": "manual",
  "goal": "",
  "input": "I ask the trader what happened last night.",
  "scene": {
    "location": "Hollowmere · Market",
    "description": "The market scene is active.",
    "time": "08:35",
    "fatigue": "2/10",
    "health": "10/10",
    "present": ["Market traders", "Townsfolk"],
    "exits": ["Return to Hollowmere"],
    "items": []
  },
  "story": {
    "title": "A Morning in Hollowmere",
    "phase": "exploration",
    "status": "active"
  },
  "allowedObjectives": [
    {"key":"visit-bakery","label":"Visit the bakery scene"}
  ],
  "history": []
}
```

Response:

```json
{
  "ok": true,
  "provider": "novelai",
  "model": "glm-4-6",
  "narration": "...",
  "authoritativeStateChanged": false
}
```

### `POST /api/v1/ai/director`

Turns one runtime-approved story objective into a natural task briefing.

The AI is not allowed to invent an objective key. The bridge rejects any response whose `objectiveKey` is not in the supplied `allowedObjectives` set.

Example accepted response:

```json
{
  "ok": true,
  "accepted": true,
  "task": {
    "objectiveKey": "visit-bakery",
    "title": "Follow the Warm Bread",
    "briefing": "The bakery is already part of your permitted route. See what the morning there reveals.",
    "tone": "curious",
    "expiresInMinutes": 0
  },
  "authoritativeStateChanged": false
}
```

The current browser prototype still owns the story rail, so this validation is only a prototype boundary. In the production Java runtime, the server must own the allowed objective set rather than trusting a browser-supplied list.

### `POST /api/v1/ai/action`

Requires `controlMode: "full"`, a nonempty `goal`, the active scene projection,
and a bounded `allowedActions` list. Each choice has a unique `key`, a `kind`
(`look`, `talk`, `explore`, `rest` or `move`) and a description.

The provider returns only `{"actionKey":"look"}`. The bridge rejects malformed
JSON and unknown keys. The response reports `accepted`, `actionKey` on success,
and `authoritativeStateChanged: false`. The browser rechecks the key against its
current choices, resolves the existing mechanics and requests narration with
that resolved outcome. Model-supplied state fields are never applied.

The browser still owns available actions and mechanics in this prototype. These
checks prevent the model from choosing an unavailable action; they are not a
server-authoritative session boundary. Move choices, time, rolls and persistence
into Java before using this as a shared world runtime.

### Control modes on narration requests

`/ai/turn` accepts `controlMode` (`manual`, `assisted`, `full`) and optional
`goal`. Omitted mode defaults to Manual for compatibility; unknown modes fail
before generation. Manual forbids writing the player's character. Assisted
allows routine detail within the stated intention and resolved outcome. Full
narrates one selected action toward the goal. All modes retain the same rules
against inventing persistent outcomes.

## Human-triggered generation

NovelAI generation must remain tied to an explicit player action. Praxis currently generates only after the player sends text, presses a scene action that requests narration, presses **Ask for next task**, or presses **Let AI act** for one Full AI step. Do not add unattended generation loops.

The browser can abort its pending fetch and discard a late response. This does
not roll back an action already resolved, and does not guarantee that an
upstream provider stops generating. Mode changes and additional actions are
blocked during generation or an unresolved movement roll.

## Build

Requires Java 21 and Maven.

```bash
mvn clean package
java -jar target/praxis-server.jar
```

Default local bind:

```text
127.0.0.1:8787
```

Environment variables:

```text
PRAXIS_PORT=8787
PRAXIS_ALLOWED_ORIGIN=https://praxis.thehowlingwhispers.com
NOVELAI_MODEL=glm-4-6
NOVELAI_BASE_URL=https://text.novelai.net
NOVELAI_AUTH_PREFIX="Bearer "
```

`NOVELAI_TOKEN` is optional and should only be used as a development/server fallback. Per-user tokens sent by the browser are preferred for the prototype.

## Nginx shape

The live site should serve the Hollowmere frontend normally and proxy only `/api/` to the Java service:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 256k;
}
```

Do not proxy the Persistent API token anywhere except the Praxis Java bridge and NovelAI.

## Next runtime work

The v0.3.0 bridge proves the provider boundary. The next important step is to move the current browser-owned Hollowmere state into the Java runtime so the server, not JavaScript, owns:

1. story rail and allowed objectives
2. time and fatigue
3. rolls and resolved outcomes
4. scene presence
5. conversation history window
6. saves / resume

After that, NovelAI can remain a replaceable narration provider while Praxis becomes authoritative end to end.
