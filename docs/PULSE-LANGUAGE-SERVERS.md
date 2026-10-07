# Pulse — Real Language Servers (Roadmap item #5)

Status: **in progress** (started 2026-09-13 night session). This document is the plan and is updated
with verified results as each step lands.

## Why

Pulse's editor (Monaco) only had browser-side intelligence: TypeScript/JavaScript checking inside
**open** files, nothing for Python, and `.mjs`/`.cjs` files (most of SOMA's backend) opened as plain
text. Cursor/VS Code get their smarts from Language Server Protocol (LSP) servers running as real
processes. This work gives Pulse the same engines.

## What's available on this machine

| Language | Engine | Status |
|---|---|---|
| JavaScript / TypeScript (.js .mjs .cjs .jsx .ts .tsx) | typescript-language-server 6 + TypeScript 6.0.3 | installed in `server/lsp-host` |
| Python | Pyright 1.1.414 (runs on Node, no Python install needed) | installed in `server/lsp-host` |
| Go / Rust / C, C++ | gopls / rust-analyzer / clangd | **not installed** — picked up automatically if added to PATH |
| JSON / CSS / HTML | Monaco's built-in workers | already working |

## Architecture

```
Pulse editor (Monaco models, file:///<workspace-relative path>)
   │  small LSP client inside pulse_standalone.html
   │    - maps editor positions/URIs <-> LSP
   │    - registers Monaco providers from the server's capabilities
   ▼  POST /api/pulse/lsp/session/:id/send      (browser -> server)
   ▲  SSE  /api/pulse/lsp/session/:id/stream    (server -> browser)
server/routes/pulseLspRoutes.js  (bridge)
   - spawns one server per language on demand, stops after 10 idle minutes
   - Content-Length framing over stdio
   - owns workspace identity (rootUri, folders, init options)
   - answers routine server requests (configuration, capability registration, progress)
   - local-only (localOnlyGuard: /api/pulse/lsp/*)
   ▼
tsserver / pyright-langserver processes (tsserver heap capped at 2GB; Pyright checks open files only)
```

## Plan

1. **Backend bridge** — `pulseLspRoutes.js`, isolated installs in `server/lsp-host`, guard + mount.
2. **Offline harness** — drive the real servers through the bridge: diagnostics, hover, completion,
   go-to-definition across files, references, rename, for both TS/JS and Python.
3. **Pulse client** — document sync (open/change/close), diagnostics → Problems tab, completion (+resolve),
   hover, signature help, go-to-definition/references into files that aren't open (opens them as tabs),
   document highlights, rename (single file applies live; multi-file goes through the accept/reject diff
   review), formatting, quick fixes. Language status indicator. `.mjs/.cjs/.mts/.cts` mapped to languages.
4. **Fallback** — while a server is starting or if it fails, the existing Monaco worker features stay on;
   once the server is ready they're switched off to avoid duplicate suggestions/errors.
5. **Deploy + live browser test** — one SOMA restart, headless end-to-end checks, LAN lockout check.
6. **Commit + notes + morning checklist.**

## Verified results

### Offline bridge harness (real servers, no browser) — 17/17

| Check | Result |
|---|---|
| Python: type error reported | ~3.0s after opening (was ~17s before limiting Pyright's scan) |
| Python: hover signature + docstring, completion (`result.` → int methods), go-to-definition into an unopened file | pass |
| Python: rename across files | pass (inside SOMA's code folders — see limits) |
| TypeScript: type error | ~0.5s |
| JavaScript: hover with JSDoc from another file, completion, go-to-definition, find references, rename across files | pass |
| TypeScript: formatting | pass |
| Memory, both servers running | ~765MB |
| Stop → no processes left behind | pass |

### Findings that shaped the design

- **Pyright scanned the whole SOMA folder** (~5,500 `.py` files, mostly cloned repos, `data/`, venvs) before its first
  diagnostics: ~17s. `python.analysis.include` is now limited to SOMA's own code folders (`server`, `appendages`,
  `backend`, `Concieve`, `scripts`, `arbiters`, `siren-bridge`, `marionette`, `cluster`, `core`, root `*.py`) → ~3s.
- **Graceful shutdown orphaned tsserver children**, so stopping now kills the whole process tree immediately.
- TypeScript 6.0.3 is pinned (not 7.0): 7.0 is the native rewrite and no longer ships the `tsserver.js`
  that typescript-language-server drives.

### Known limits

- Python **cross-file** rename / find-references only cover files inside the folders listed above. Files elsewhere
  (e.g. `research/`, cloned repos) still get errors, hover, completion and go-to-definition, but rename is per-file.
- Go, Rust and C/C++ need their tools installed (`gopls`, `rust-analyzer`, `clangd`); Pulse picks them up automatically.
- Only one Pulse window drives a language server at a time; opening Pulse in a second window takes it over.

### Live browser test against running SOMA — 21/21

Opened real files in Pulse (headless Chrome) and checked: Python + TS/JS badges reach "ready" (~2–3s),
Python type error in editor and Problems tab, Python hover/autocomplete/go-to-definition, Python rename
applied in place, TypeScript errors only from the language server (0 duplicates from Monaco's worker),
format document, **crash recovery** (killed tsserver → Pulse restarted it and errors returned),
`.mjs` autocomplete, JS hover with JSDoc from another file, find-references, go-to-definition into
another file, multi-file rename sent to the accept/reject review with nothing written to disk,
LAN request → 403, no page errors.

One more finding: Monaco registers its own TypeScript features **once**, when the first JS/TS file opens,
and ignores later attempts to switch them off (duplicate errors/suggestions). Pulse now asks SOMA which
language servers exist *before* the editor creates any file, and only then decides.

## Morning verification checklist

Open the Command Bridge → **Pulse** (refresh the tab first).

1. **Python** — open any file in `scripts/` or `marionette/` ending in `.py`.
   A badge next to "AI autocomplete" should say **◆ Python ready** within a few seconds.
2. Type a deliberate mistake, e.g. `x: int = "hello"` on a new line → a red squiggle appears and the
   **Problems** tab lists it with the file and line.
3. Hover over a function name → you see its signature and docstring.
4. Type `"abc".` → autocomplete lists string methods.
5. Click a function name and press **F12** → Pulse opens the file where it's defined (even if it wasn't open).
6. **JavaScript** — open `launcher_ULTRA.mjs` (`.mjs` files used to open as plain text).
   Badge: **◆ TS/JS ready**. Hover, autocomplete and **F12** work; **Shift+F12** shows every place a
   function is used.
7. **Rename** — click a name and press **F2**. If it's used in one file, it changes immediately. If it's used in
   several files, SOMA's panel shows the proposed changes to Accept or Reject — nothing is saved until you accept.
8. **Format** — right-click → Format Document (TS/JS files).
9. Undo any test edits (Ctrl+Z) — Pulse autosaves.

Re-run the automated checks any time: `node scripts/test-pulse-lsp-bridge.mjs` (no browser needed).

### If something looks wrong

- Badge says **unavailable** → the language server isn't installed (`server/lsp-host`); Go/Rust/C++ need their
  tools installed.
- Badge says **error/stopped** → Pulse retries automatically up to 3 times in 10 minutes; after that, reload Pulse.
- Server details: `GET http://localhost:3001/api/pulse/lsp/servers` (running servers, pids, uptime).
