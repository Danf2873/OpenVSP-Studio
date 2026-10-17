# OpenVSP Studio

OpenVSP Studio is a Tauri desktop application that provides a modern UI for the OpenVSP workflow (including geometry editing, analysis, and VSPAERO tooling).

## Repository layout

- `/ui` — React + Vite frontend
- `/src-tauri` — Tauri desktop shell
- `/engine` — Python RPC engine and OpenVSP integration
- `/docs` — project documentation (including the engine/UI RPC contract in `docs/API.md`)
- `/tools` — helper scripts for packaging and distribution

## Prerequisites

- Node.js and npm
- Python 3 (used by tooling/scripts)

## Development

Install dependencies:

```bash
npm install
npm --prefix ui install
```

Run the desktop app in development mode:

```bash
npm run dev
```

## Build

Build the app bundle:

```bash
npm run build
```

Create staged artifacts and bundled build:

```bash
npm run dist
```

## Useful scripts

- `npm run dev` — run Tauri app in development mode
- `npm run build` — production Tauri build
- `npm run stage` — run bundle staging script
- `npm run dist` — stage bundle, then build
