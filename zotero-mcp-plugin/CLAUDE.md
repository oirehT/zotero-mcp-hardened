# Zotero MCP Plugin

## Project Overview

A Zotero plugin that provides MCP (Model Context Protocol) server functionality, enabling AI assistants to interact with Zotero's library data.

## Tech Stack

- TypeScript
- Zotero Plugin API (Firefox/Gecko-based)
- zotero-plugin-scaffold for building
- SQLite for semantic search index

## Key Directories

- `src/` - TypeScript source code
- `addon/` - Plugin assets (manifest, locales, preferences UI)
- `.scaffold/build/` - Build output
- `update.json` - Zotero auto-update manifest

## Available Workflows

- `pnpm run build` - Build the XPI into `.scaffold/build/`
- `.github/workflows/release.yml` - Publish a GitHub release from a matching
  `vX.Y.Z` tag or manual workflow dispatch

## Build Commands

```bash
pnpm run build      # Production build
pnpm run start      # Development with hot reload
```

## Important Patterns

### Preferences

- Prefix: `extensions.zotero.zotero-mcp-plugin`
- Defined in `addon/content/preferences.xhtml`
- Accessed via `Zotero.Prefs.get/set`

### Localization

- English: `addon/locale/en-US/preferences.ftl`

### Release Workflow

Use `.github/workflows/release.yml` for the automated release process.

Key points:

- Version in: `package.json`, `README.md`, `update.json`
- Build: `pnpm run build` -> `.scaffold/build/zotero-mcp-plugin.xpi`
- `addon/` is gitignored — use `git add -f` for files under it
- Release assets: XPI renamed to `zotero-mcp-plugin-X.Y.Z.xpi` plus
  `update.json` or `update-beta.json`

## Code Style

- Use ztoolkit.log for logging
- Follow existing patterns in codebase
- Keep comments and user-facing strings in English
