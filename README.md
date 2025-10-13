# Daily Link Clipper

Daily Link Clipper watches the current daily note and automatically processes any new HTTP(S) links:

- Downloads the page to capture title, description, and a short excerpt.
- Classifies the link as a wishlist product or reading-list article (OpenRouter or heuristics).
- Creates a clipping note under `Attachments/Clippings` with collected metadata.
- Appends a JSON entry to `Bases/Wishlist.base` or `Bases/ReadingList.base` without duplicating URLs.

## Configuration

Use the plugin settings pane to adjust folders, file name patterns, and optional OpenRouter details. Classification falls back to lightweight heuristics when no key is available. Secrets should be provided via environment variables or a key file outside the vault.

## Development

The project mirrors the TypeScript/esbuild layout used in the `AI-formatter` plugin:

```sh
npm install
npm run dev      # watch mode
npm run build    # production bundle written to dist/main.js
```

`dist/main.js` is required by Obsidian at runtime. Remember to rebuild after modifying files under `src/`.
