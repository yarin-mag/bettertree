# Bettertree

Bettertree is a Tauri-based desktop Git repository explorer and working-copy dashboard built with React, Vite, and Rust.

## What it does

- Browse local repositories
- Inspect branch and commit graphs
- View diffs and working tree status
- Stage, unstage, and commit changes
- Pull and fetch from remotes

## Tech stack

- Frontend: React + Vite + TypeScript
- Styling: Tailwind CSS
- Desktop shell: Tauri 2
- Backend integration: Rust + `git2` + `rusqlite`

## Prerequisites

Before running the project locally, install:

- Node.js 20+
- npm
- Rust and Cargo for the desktop/Tauri workflow

## Install

```bash
npm install
```

## Run locally (frontend)

```bash
npm run dev -- --host 127.0.0.1
```

Then open:

```text
http://127.0.0.1:5173/
```

## Build the frontend

```bash
npm run build
```

## Run the desktop app

```bash
npm run tauri dev
```

This requires a working Rust toolchain on your machine.

## Build the desktop app

```bash
npm run tauri build
```

## Repository layout

- `src/` — React application
- `src-tauri/` — Tauri/Rust backend and desktop shell
- `docs/` — design and planning notes
- `e2e/` and `wdio-e2e/` — browser and desktop integration tests

## Notes

- The frontend can be developed and previewed without the desktop shell.
- The full Tauri desktop experience needs Rust installed locally.
