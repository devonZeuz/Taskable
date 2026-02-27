const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } = require('electron');
const { startStaticServer } = require('./localServer.cjs');
const { readDesktopState, writeDesktopState, defaultDesktopState } = require('./store.cjs');

const APP_PROTOCOL = 'tareva';
const DEFAULT_DEV_SERVER_URL = 'http://localhost:5173';
const PRELOAD_PATH = path.join(__dirname, 'preload.cjs');
const TRAY_ICON_PATH = path.join(__dirname, 'assets', 'tray.png');

const isDev = process.env.TAREVA_DESKTOP_DEV === '1';
const devServerUrl = process.env.TAREVA_DESKTOP_DEV_SERVER_URL || DEFAULT_DEV_SERVER_URL;

if (isDev) {
  try {
    app.setPath('userData', path.join(app.getPath('appData'), 'Tareva-dev-shell'));
  } catch {
    // Ignore userData overrides when unavailable.
  }
}

let rendererBaseUrl = devServerUrl;
let staticServerHandle = null;
let mainWindow = null;
let compactWindow = null;
let tray = null;
let appIsQuitting = false;
let desktopState = { ...defaultDesktopState };

function persistDesktopState() {
  writeDesktopState(app.getPath('userData'), desktopState);
}

function makeRouteUrl(pathname = '/', search = '') {
  const url = new URL(pathname, rendererBaseUrl);
  if (search) {
    url.search = search;
  }
  return url.toString();
}

function isRendererOriginUrl(rawUrl) {
  try {
    const target = new URL(rawUrl);
    const renderer = new URL(rendererBaseUrl);
    return target.origin === renderer.origin;
  } catch {
    return false;
  }
}

function hardenWindow(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  window.webContents.on('will-navigate', (event, rawUrl) => {
    if (isRendererOriginUrl(rawUrl)) return;
    event.preventDefault();
  });

  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
}

function getDesktopShellStatePayload() {
  return {
    isDesktop: true,
    compactVisible: Boolean(
      compactWindow && !compactWindow.isDestroyed() && compactWindow.isVisible()
    ),
    compactAlwaysOnTop: Boolean(desktopState.compactAlwaysOnTop),
  };
}

function broadcastDesktopState() {
  const payload = getDesktopShellStatePayload();
  BrowserWindow.getAllWindows().forEach((window) => {
    if (window.isDestroyed()) return;
    window.webContents.send('desktop:state', payload);
  });
  refreshTrayMenu();
}

function getTrayImage() {
  const fallbackPath = path.join(process.cwd(), 'desktop', 'assets', 'tray.png');
  const iconPath = fs.existsSync(TRAY_ICON_PATH) ? TRAY_ICON_PATH : fallbackPath;
  const image = nativeImage.createFromPath(iconPath);
  return image.isEmpty() ? nativeImage.createEmpty() : image;
}

function refreshTrayMenu() {
  if (!tray) return;

  const compactVisible = Boolean(
    compactWindow && !compactWindow.isDestroyed() && compactWindow.isVisible()
  );
  const menu = Menu.buildFromTemplate([
    {
      label: compactVisible ? 'Hide Compact' : 'Show Compact',
      click: () => {
        void toggleCompactWindow();
      },
    },
    {
      label: 'Always on top',
      type: 'checkbox',
      checked: Boolean(desktopState.compactAlwaysOnTop),
      click: (menuItem) => {
        setCompactAlwaysOnTop(Boolean(menuItem.checked));
      },
    },
    { type: 'separator' },
    {
      label: 'Open Tareva',
      click: () => {
        focusMainWindow();
      },
    },
    {
      label: 'Quit',
      click: () => {
        appIsQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
}

function createTray() {
  if (tray) return;

  tray = new Tray(getTrayImage());
  tray.setToolTip('Tareva');
  tray.on('double-click', () => {
    focusMainWindow();
  });
  refreshTrayMenu();
}

function persistWindowBounds(stateKey, window) {
  if (!window || window.isDestroyed()) return;
  desktopState = {
    ...desktopState,
    [stateKey]: window.getBounds(),
  };
  persistDesktopState();
}

function attachBoundsPersistence(window, stateKey) {
  let saveTimer = null;
  const scheduleSave = () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => {
      saveTimer = null;
      persistWindowBounds(stateKey, window);
    }, 180);
  };

  window.on('resize', scheduleSave);
  window.on('move', scheduleSave);
  window.on('close', () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    persistWindowBounds(stateKey, window);
  });
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }

  const bounds = desktopState.mainBounds;
  mainWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 980,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#1f2127',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      sandbox: true,
      preload: PRELOAD_PATH,
    },
  });

  hardenWindow(mainWindow);

  attachBoundsPersistence(mainWindow, 'mainBounds');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    broadcastDesktopState();
  });

  mainWindow.on('closed', () => {
    if (compactWindow && !compactWindow.isDestroyed()) {
      compactWindow.hide();
      desktopState = {
        ...desktopState,
        compactVisible: false,
      };
      persistDesktopState();
    }
    mainWindow = null;
    broadcastDesktopState();
  });

  mainWindow.loadURL(makeRouteUrl('/')).catch((error) => {
    console.error('[desktop] failed to load main window', error);
  });

  return mainWindow;
}

function createCompactWindow() {
  if (compactWindow && !compactWindow.isDestroyed()) {
    return compactWindow;
  }

  const bounds = desktopState.compactBounds;
  compactWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 420,
    minHeight: 260,
    frame: false,
    resizable: true,
    alwaysOnTop: Boolean(desktopState.compactAlwaysOnTop),
    show: false,
    skipTaskbar: true,
    backgroundColor: '#22242b',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      sandbox: true,
      preload: PRELOAD_PATH,
    },
  });

  hardenWindow(compactWindow);

  attachBoundsPersistence(compactWindow, 'compactBounds');

  compactWindow.once('ready-to-show', () => {
    if (desktopState.compactVisible) {
      compactWindow.showInactive();
      broadcastDesktopState();
    }
  });

  compactWindow.on('close', () => {
    desktopState = {
      ...desktopState,
      compactVisible: false,
    };
    persistDesktopState();
  });

  compactWindow.on('closed', () => {
    compactWindow = null;
    broadcastDesktopState();
  });

  compactWindow.loadURL(makeRouteUrl('/compact', '?desktopCompact=1')).catch((error) => {
    console.error('[desktop] failed to load compact window', error);
  });

  return compactWindow;
}

function focusMainWindow() {
  if (compactWindow && !compactWindow.isDestroyed() && compactWindow.isVisible()) {
    compactWindow.hide();
    desktopState = {
      ...desktopState,
      compactVisible: false,
    };
    persistDesktopState();
  }
  const window = createMainWindow();
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
  broadcastDesktopState();
}

function openMainTask(taskId) {
  focusMainWindow();
  const normalizedTaskId = typeof taskId === 'string' ? taskId.trim() : '';
  const search = normalizedTaskId ? `?taskId=${encodeURIComponent(normalizedTaskId)}` : '';
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(makeRouteUrl('/', search)).catch((error) => {
      console.error('[desktop] failed to deep-link task', error);
    });
  }
}

function setCompactAlwaysOnTop(enabled) {
  desktopState = {
    ...desktopState,
    compactAlwaysOnTop: Boolean(enabled),
  };

  if (compactWindow && !compactWindow.isDestroyed()) {
    compactWindow.setAlwaysOnTop(Boolean(enabled), 'floating');
  }

  persistDesktopState();
  broadcastDesktopState();
}

async function openCompactWindow() {
  const window = createCompactWindow();
  desktopState = {
    ...desktopState,
    compactVisible: true,
  };
  persistDesktopState();

  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    mainWindow.hide();
  }

  if (window.webContents.isLoading()) {
    window.once('ready-to-show', () => {
      window.showInactive();
      broadcastDesktopState();
    });
  } else {
    window.showInactive();
    broadcastDesktopState();
  }
}

function closeCompactWindow({ focusMain = false } = {}) {
  if (compactWindow && !compactWindow.isDestroyed()) {
    compactWindow.hide();
  }

  desktopState = {
    ...desktopState,
    compactVisible: false,
  };
  persistDesktopState();

  if (focusMain) {
    const window = createMainWindow();
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
  }

  broadcastDesktopState();
}

async function toggleCompactWindow() {
  const currentlyVisible = Boolean(
    compactWindow && !compactWindow.isDestroyed() && compactWindow.isVisible()
  );
  if (currentlyVisible) {
    closeCompactWindow({ focusMain: true });
    return;
  }

  await openCompactWindow();
}

function parseProtocolTaskId(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== `${APP_PROTOCOL}:`) return null;

    if (parsed.hostname === 'task') {
      const value = decodeURIComponent(parsed.pathname.replace(/^\/+/, '')).trim();
      return value || null;
    }

    const normalizedPath = parsed.pathname.replace(/^\/+/, '');
    if (normalizedPath.startsWith('task/')) {
      const value = decodeURIComponent(normalizedPath.slice(5)).trim();
      return value || null;
    }

    const queryTaskId = parsed.searchParams.get('taskId');
    if (queryTaskId && queryTaskId.trim()) {
      return queryTaskId.trim();
    }

    return null;
  } catch {
    return null;
  }
}

function handleProtocolUrl(rawUrl) {
  const taskId = parseProtocolTaskId(rawUrl);
  if (taskId) {
    openMainTask(taskId);
    return;
  }
  focusMainWindow();
}

function registerProtocol() {
  if (process.defaultApp) {
    app.setAsDefaultProtocolClient(APP_PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
    return;
  }
  app.setAsDefaultProtocolClient(APP_PROTOCOL);
}

function registerIpcHandlers() {
  ipcMain.handle('desktop:getState', () => getDesktopShellStatePayload());
  ipcMain.handle('desktop:toggleCompact', async () => {
    await toggleCompactWindow();
    return getDesktopShellStatePayload();
  });
  ipcMain.handle('desktop:openCompact', async () => {
    await openCompactWindow();
    return getDesktopShellStatePayload();
  });
  ipcMain.handle('desktop:closeCompact', () => {
    closeCompactWindow();
    return getDesktopShellStatePayload();
  });
  ipcMain.handle('desktop:setAlwaysOnTop', (_event, enabled) => {
    setCompactAlwaysOnTop(Boolean(enabled));
    return getDesktopShellStatePayload();
  });
  ipcMain.handle('desktop:focusMain', () => {
    focusMainWindow();
    return getDesktopShellStatePayload();
  });
  ipcMain.handle('desktop:openFull', (_event, payload) => {
    const taskId =
      payload && typeof payload === 'object' && typeof payload.taskId === 'string'
        ? payload.taskId
        : undefined;
    if (taskId && taskId.trim()) {
      openMainTask(taskId.trim());
    } else {
      focusMainWindow();
    }
    return getDesktopShellStatePayload();
  });
  ipcMain.handle('desktop:openTask', (_event, taskId) => {
    openMainTask(taskId);
    return getDesktopShellStatePayload();
  });
}

async function prepareRendererBaseUrl() {
  if (isDev) {
    rendererBaseUrl = devServerUrl;
    return;
  }

  const distDir = path.join(__dirname, '..', 'dist');
  staticServerHandle = await startStaticServer({ distDir });
  rendererBaseUrl = staticServerHandle.url;
}

const shouldUseInstanceLock = !isDev;
const instanceLock = shouldUseInstanceLock ? app.requestSingleInstanceLock() : true;
if (!instanceLock) {
  app.quit();
} else {
  if (shouldUseInstanceLock) {
    app.on('second-instance', (_event, commandLine) => {
      const protocolArg = commandLine.find((argument) => argument.startsWith(`${APP_PROTOCOL}://`));
      if (protocolArg) {
        handleProtocolUrl(protocolArg);
        return;
      }
      focusMainWindow();
    });
  }

  app.on('open-url', (event, rawUrl) => {
    event.preventDefault();
    handleProtocolUrl(rawUrl);
  });

  app.whenReady().then(async () => {
    registerProtocol();
    desktopState = readDesktopState(app.getPath('userData'));
    await prepareRendererBaseUrl();

    registerIpcHandlers();
    createMainWindow();
    createTray();

    if (desktopState.compactVisible) {
      await openCompactWindow();
    }

    const startupProtocolArg = process.argv.find((argument) =>
      argument.startsWith(`${APP_PROTOCOL}://`)
    );
    if (startupProtocolArg) {
      handleProtocolUrl(startupProtocolArg);
    }
  });
}

app.on('activate', () => {
  focusMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Keep tray running until user explicitly quits.
  }
});

app.on('before-quit', () => {
  appIsQuitting = true;
});

app.on('will-quit', () => {
  if (staticServerHandle?.close) {
    void staticServerHandle.close();
  }
  if (!appIsQuitting) {
    persistDesktopState();
  }
});
