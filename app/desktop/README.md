# Taskable Desktop Shell (Electron v1)

This folder contains a **thin desktop shell** over the existing Taskable React app.

- Renderer: existing web app routes (`/` entry gate, `/planner`, `/team`, `/compact`, auth routes)
- Desktop-only responsibilities:
  - window lifecycle
  - compact sticky window behavior
  - tray menu
  - deep-link handling
  - bounds/always-on-top persistence

No scheduling, sync, planning, or domain logic is duplicated in desktop code.

## Security

Desktop hardening checklist: `desktop/DESKTOP_SECURITY.md`

## Window model

- `mainWindow`
  - standard framed window
  - remembers bounds
  - loads `/` (entry gate -> `/welcome` or `/planner`)

- `compactWindow`
  - frameless, resizable, small default size
  - optional always-on-top
  - remembers bounds
  - loads `/compact`

## IPC channels

- `desktop:getState`
- `desktop:toggleCompact`
- `desktop:openCompact`
- `desktop:closeCompact`
- `desktop:setAlwaysOnTop`
- `desktop:openFull`
- `desktop:focusMain`
- `desktop:openTask`

## Tray menu

- Toggle Compact
- Always on top (checkbox)
- Open Taskable
- Quit

## Deep-link protocol

Windows protocol support is registered for:

- `taskable://task/<taskId>`

This focuses the main window and opens the full editor flow through the entry gate to
`/planner?taskId=<taskId>`.

## Packaging notes

- Config: `desktop/electron-builder.yml`
- Output folder: `release/`
- Target: Windows NSIS installer
- Tray + installer icons are aligned to `desktop/assets/tray.png`

## Run and build

From `app/`:

- Dev shell: `npm run desktop:dev`
- Build unpacked desktop app: `npm run desktop:build`
- Build Windows installer (`.exe`): `npm run desktop:dist`

Installer output:

- `release/Taskable-Setup-<version>.exe`

## Manual QA checklist (desktop shell)

1. Run `npm run desktop:dev`, open main planner (`/planner` after entry gate), and verify wheel/trackpad vertical scroll moves day rows up/down.
2. In main planner, hover over the hour header (time axis) and use wheel/trackpad vertical gesture; verify it pans timeline horizontally.
3. Move pointer away from the time header and wheel vertically; verify horizontal drift does not occur.
4. Open compact mode, verify vertical day scrolling works and timeline horizontal pan still works from hour header.
5. Toggle compact from tray:
   - compact opens while main hides
   - toggling back closes compact and focuses main
6. Enable/disable “Always on top” from tray and verify compact window behavior changes immediately.
7. Move/resize both windows, relaunch desktop shell, and verify bounds are restored.

## Future placeholders (not implemented in v1)

- Auto update (`electron-updater`)
- Code signing
- macOS notarization
