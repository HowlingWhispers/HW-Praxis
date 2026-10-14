# Praxis

Praxis is a single-player chat RPG for The Howling Whispers: text-adventure roleplay with optional dice-driven mechanics, modeled on Character Engine. It loads a world module whose starting records come from Orbis, and keeps the live records in the player's own save.

The scope, architecture and release plan are in *Praxis — Charter* in the Howling Whispers dev project.

## Status

`0.5.0`, the rebuild. The engine has its state primitive and the module format; the interface is a development shell that loads and validates a module file. The Java prototype that preceded this is in the history at `d3b13ee`.

## Layout

```text
src/engine   rules: pure TypeScript, no DOM or network
src/ui       the interface
server       thin API: health now; Orbis launch and generation relay later
tests        Vitest
```

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

## Deploy

`npm run build`, then run `node dist-server/server/index.js` with `NODE_ENV=production` and `PORT=8791`. The server binds to localhost; `deploy/nginx-api-location.conf.example` shows the proxy block for praxis.thehowlingwhispers.com.

## License

Not yet chosen.
