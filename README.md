# Daily Link Clipper (Stub)

This plugin watches the current daily note and automatically processes any new HTTP(S) links:

- Downloads the page to capture title, description, and a short excerpt.
- Classifies the link as a wishlist product or reading-list article.
- Creates a clipping note under `Attachments/Clippings` with collected metadata.
- Appends a JSON entry to `Bases/Wishlist.base` or `Bases/ReadingList.base` without duplicating URLs.

## Configuration

Use the plugin settings pane to adjust folders, file name patterns, and the OpenRouter model/API key (optional).

Classification falls back to lightweight heuristics when no model key is provided.

> Note: This implementation avoids calling OpenRouter without a key and handles repeated edits by debouncing updates to the daily note.
