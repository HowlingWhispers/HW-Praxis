# Praxis repository rules

- `main` is the source of truth. Work arrives on short-lived branches and merges into `main`.
- The project charter lives in the Howling Whispers dev project as *Praxis — Charter*. Read it before changing scope or architecture.
- `src/engine` is pure TypeScript: no DOM, no network and no storage. Time and randomness come in as arguments, never from globals. Rules live there and nowhere else. The interface and providers are adapters around it.
- The model never moves discrete state. State moves through a resolved rule or a player override, and every change is recorded with its source. Where the model's judgment is needed it returns a label from a closed list, and an authored table says what the label does.
- A state reaches the model only through its bands, and only when it is off its resting band.
- Modules are read-only canon. Play writes to the save, never to the module.
- Keep Orbis field names and IDs in module records so a future Orbis loader is a swap, not a translation.
- Saves live in the browser. The server holds no play state and never stores a provider credential.
- Preserve roleplay formatting: narration and action in single asterisks, speech as plain text with no quotation marks, thoughts in parentheses. Square brackets are for notes outside the story (the game's notes to the narrator, or the player's).
- Before completion run `npm test`, `npm run lint` and `npm run build`. CI runs the same three.
