# Daily Link Clipper

Daily Link Clipper watches the current daily note and automatically processes any new HTTP(S) links:

- Downloads the page to capture title, description, and a short excerpt.
- Classifies the link as a wishlist product or reading-list article (OpenRouter or heuristics).
- Creates a clipping note under `Attachments/Clippings` with collected metadata.
- Appends a JSON entry to `Bases/Wishlist.base` or `Bases/ReadingList.base` without duplicating URLs.

## Configuration

Use the plugin settings pane to adjust folders, file name patterns, and optional OpenRouter details. Classification falls back to lightweight heuristics when no key is available. Secrets should be provided via environment variables or a key file outside the vault.

## Development

The project uses TypeScript with esbuild for fast bundling:

```sh
npm install          # Install dependencies
npm run dev          # Watch mode for development
npm run build        # Production bundle to dist/
npm run lint         # Run ESLint
npm run lint:fix     # Auto-fix linting issues
npm run validate     # Validate version consistency
```

### Project Structure

```
QuickLinker/
├── src/
│   └── main.ts              # Plugin source code
├── scripts/
│   ├── validate-versions.mjs # Version validation
│   └── version-bump.mjs      # Version bumping utility
├── .github/
│   └── workflows/
│       ├── build.yml         # CI build workflow
│       ├── release.yml       # Release automation
│       └── pr-check.yml      # PR validation
├── dist/                     # Built files (generated)
├── manifest.json             # Obsidian plugin manifest
├── versions.json             # Version compatibility tracking
└── package.json              # NPM package config
```

### Version Management

To bump the version:

```sh
npm version patch      # 0.1.0 -> 0.1.1
npm version minor      # 0.1.0 -> 0.2.0
npm version major      # 0.1.0 -> 1.0.0
```

This automatically updates `manifest.json`, `versions.json`, and `package.json`.

### Creating Releases

1. **Stable Release:**
   ```sh
   git tag 0.1.0
   git push origin 0.1.0
   ```

2. **Beta Release:**
   ```sh
   git tag 0.2.0-beta.1
   git push origin 0.2.0-beta.1
   ```

The GitHub Actions workflow will automatically:
- Validate versions and run tests
- Build the plugin
- Generate changelog from commits
- Create a GitHub release
- Upload plugin files and zip package

### Workflow Features

- **Automated CI/CD**: Build and test on every push/PR
- **Version Validation**: Ensures consistency across manifest, package.json, and versions.json
- **Code Quality**: ESLint checks on every commit
- **Bundle Size Tracking**: Monitors plugin size
- **PR Checks**: Automated validation and bundle size comments
- **Dependabot**: Automatic dependency updates
- **Beta Releases**: Support for pre-release versions
- **Changelog Generation**: Automatic changelog from git history

### Code Quality

The project uses ESLint with TypeScript support. Run checks before committing:

```sh
npm run lint        # Check for issues
npm run lint:fix    # Auto-fix issues
```

`dist/main.js` is required by Obsidian at runtime. Remember to rebuild after modifying files under `src/`.
