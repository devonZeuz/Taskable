# Desktop Security Checklist

Tareva desktop security posture (Electron shell):

- `contextIsolation: true` on all BrowserWindows.
- `nodeIntegration: false` on all BrowserWindows.
- `webSecurity: true` on all BrowserWindows.
- `sandbox: true` enabled on all BrowserWindows (preload remains the only bridge surface).
- Renderer preload uses an explicit IPC allowlist (`desktop:*` channels only).
- No generic passthrough IPC (`invoke(channel, payload)` style bridge) is exposed.
- External navigation is blocked:
  - `will-navigate` denies URLs outside the renderer origin.
  - `setWindowOpenHandler` is deny-by-default.
  - `will-attach-webview` is blocked.
- Protocol deep links are handled in the main process only (`Tareva://task/<taskId>`).

Operational notes:

- Keep `desktop/preload.cjs` minimal and narrowly typed.
- Any new IPC channel must be added to `desktop/main.cjs` with argument validation and explicit return shape.
- Re-run desktop regression suites after changing window/webPreferences or navigation handlers.
