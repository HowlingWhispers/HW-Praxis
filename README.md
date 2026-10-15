# Praxis

Praxis is a single-player chat RPG for The Howling Whispers: text-adventure roleplay with optional dice-driven mechanics, modeled on Character Engine. It loads a world module whose starting records come from Orbis, and keeps the live records in the player's own save.

The scope, architecture and release plan are in *Praxis — Charter* in the Howling Whispers dev project.

## Status

`0.7.0`. The engine has the state primitive, the clock and calendar, places and travel, scene presence, the save with its ledger, turns with reroll and undo, and the context compiler. The first module, *Abernys: Port Covenant*, is in `modules/`. The interface is a development shell: it narrates through NovelAI with the player's own key, keeps saves in the browser, and exports and imports them. The Java prototype that preceded this is in the history at `d3b13ee`.

## Layout

```text
src/engine   rules: pure TypeScript, no DOM or network
src/ui       the interface
modules      playable modules (praxis-module/1)
server       thin API: health, and a NovelAI relay that forwards the player's key per request
tests        Vitest
```

## Try a branch without deploying

Open the repository on GitHub, switch to the branch you want (a pull request names its branch), then **Code → Codespaces → Create codespace on …**. The codespace installs everything and starts Praxis; when it says the app is running, open the **Ports** tab and click the globe beside **Praxis**. Narration works there with your own NovelAI token. Stop the codespace from **Code → Codespaces** when you're done; it also stops on its own after 30 idle minutes.

## Develop

```bash
npm install
npm run dev:api
npm run dev
```

Open `http://localhost:5176`.

Before committing:

```bash
npm test
npm run lint
npm run build
```

## Narration

The interface sends narration requests to `/api/novelai/models` and `/api/novelai/chat` on the Praxis server, which forwards them to NovelAI's OpenAI-compatible text API with the player's Persistent API Token from the `X-NovelAI-Token` header. The server never stores, logs or echoes the token and has no key of its own. This relay stays until Orbis's generation gateway can carry Praxis.

## Deploy

Requires Node 22.

1. `npm ci && npm run build`. The interface lands in `dist/`, the server in `dist-server/`.
2. Run `node dist-server/server/index.js` with `NODE_ENV=production` and `PORT=8791`; `deploy/praxis.service.example` is a systemd unit for it. The server binds to localhost and, in production, also serves `dist/`.
3. Proxy `/api/` to it (`deploy/nginx-api-location.conf.example`), and either serve `dist/` as static files or proxy everything to the server.

The Java bridge this replaces ran as `praxis-ai` on port 8787 and can be stopped.

## License

Not yet chosen.
