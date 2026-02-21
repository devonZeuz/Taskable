const fs = require('node:fs');
const path = require('node:path');

const STORE_FILE_NAME = 'desktop-preferences.json';

const DEFAULT_MAIN_BOUNDS = {
  x: 90,
  y: 70,
  width: 1400,
  height: 900,
};

const DEFAULT_COMPACT_BOUNDS = {
  x: 180,
  y: 140,
  width: 520,
  height: 340,
};

const defaultDesktopState = {
  mainBounds: DEFAULT_MAIN_BOUNDS,
  compactBounds: DEFAULT_COMPACT_BOUNDS,
  compactAlwaysOnTop: false,
  compactVisible: false,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeBounds(input, fallback, { minWidth, minHeight }) {
  if (!input || typeof input !== 'object') {
    return { ...fallback };
  }

  const candidate = input;
  const width = Number(candidate.width);
  const height = Number(candidate.height);
  const x = Number(candidate.x);
  const y = Number(candidate.y);

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return { ...fallback };
  }

  return {
    x: Number.isFinite(x) ? Math.round(x) : fallback.x,
    y: Number.isFinite(y) ? Math.round(y) : fallback.y,
    width: clamp(Math.round(width), minWidth, 2600),
    height: clamp(Math.round(height), minHeight, 1600),
  };
}

function normalizeDesktopState(input) {
  if (!input || typeof input !== 'object') {
    return { ...defaultDesktopState };
  }

  return {
    mainBounds: normalizeBounds(input.mainBounds, DEFAULT_MAIN_BOUNDS, {
      minWidth: 980,
      minHeight: 640,
    }),
    compactBounds: normalizeBounds(input.compactBounds, DEFAULT_COMPACT_BOUNDS, {
      minWidth: 420,
      minHeight: 260,
    }),
    compactAlwaysOnTop: Boolean(input.compactAlwaysOnTop),
    compactVisible: Boolean(input.compactVisible),
  };
}

function getStorePath(userDataPath) {
  return path.join(userDataPath, STORE_FILE_NAME);
}

function readDesktopState(userDataPath) {
  try {
    const raw = fs.readFileSync(getStorePath(userDataPath), 'utf8');
    const parsed = JSON.parse(raw);
    return normalizeDesktopState(parsed);
  } catch {
    return { ...defaultDesktopState };
  }
}

function writeDesktopState(userDataPath, nextState) {
  try {
    const normalized = normalizeDesktopState(nextState);
    fs.writeFileSync(getStorePath(userDataPath), JSON.stringify(normalized, null, 2), 'utf8');
  } catch {
    // Ignore write failures to avoid blocking desktop interaction.
  }
}

module.exports = {
  defaultDesktopState,
  normalizeDesktopState,
  readDesktopState,
  writeDesktopState,
};
