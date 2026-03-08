const SNAP_SOUND_URL = new URL('../../../Assets/switch-sound.mp3', import.meta.url).toString();
const SNAP_POOL_SIZE = 4;
const MEDIA_READY_MIN = 2;
let snapPool: HTMLAudioElement[] | null = null;
let nextSnapIndex = 0;
let snapAudioContext: AudioContext | null = null;
let unlockListenerInstalled = false;
let snapFileUnavailable = false;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextCtor =
    window.AudioContext ||
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;
  if (!snapAudioContext) {
    snapAudioContext = new AudioContextCtor();
  }
  return snapAudioContext;
}

function ensureSnapPool(): HTMLAudioElement[] | null {
  if (typeof window === 'undefined' || snapFileUnavailable) return null;
  if (!snapPool) {
    snapPool = Array.from({ length: SNAP_POOL_SIZE }, () => {
      const audio = new Audio(SNAP_SOUND_URL);
      audio.preload = 'auto';
      audio.volume = 0.75;
      audio.addEventListener(
        'error',
        () => {
          snapFileUnavailable = true;
          snapPool = null;
        },
        { once: true }
      );
      return audio;
    });
  }
  return snapPool;
}

function primeSnapPool() {
  const pool = ensureSnapPool();
  if (!pool || pool.length === 0) return;

  const audio = pool[0];
  audio.load();
  if (audio.readyState >= MEDIA_READY_MIN) return;

  const wasMuted = audio.muted;
  audio.muted = true;
  const playPromise = audio.play();
  if (playPromise && typeof playPromise.then === 'function') {
    void playPromise
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.muted = wasMuted;
      })
      .catch(() => {
        audio.muted = wasMuted;
      });
    return;
  }

  audio.pause();
  audio.currentTime = 0;
  audio.muted = wasMuted;
}

function installUnlockListener() {
  if (unlockListenerInstalled || typeof window === 'undefined') return;
  unlockListenerInstalled = true;

  const unlock = () => {
    const context = getAudioContext();
    if (context?.state === 'suspended') {
      void context.resume();
    }
    primeSnapPool();
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
    window.removeEventListener('touchstart', unlock, true);
  };

  window.addEventListener('pointerdown', unlock, { once: true, capture: true });
  window.addEventListener('keydown', unlock, { once: true, capture: true });
  window.addEventListener('touchstart', unlock, { once: true, capture: true });
}

function playFallbackTone() {
  const context = getAudioContext();
  if (!context) return;

  if (context.state === 'suspended') {
    void context.resume();
  }

  const oscillator = context.createOscillator();
  const gainNode = context.createGain();
  oscillator.type = 'square';
  oscillator.frequency.setValueAtTime(720, context.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(520, context.currentTime + 0.028);
  gainNode.gain.setValueAtTime(0.0001, context.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.11, context.currentTime + 0.004);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.032);
  oscillator.connect(gainNode);
  gainNode.connect(context.destination);
  oscillator.start(context.currentTime);
  oscillator.stop(context.currentTime + 0.038);
}

function getSnapChannel(): HTMLAudioElement | null {
  if (typeof window === 'undefined' || snapFileUnavailable) return null;
  installUnlockListener();
  const pool = ensureSnapPool();
  if (!pool) return null;
  const channel = pool[nextSnapIndex] ?? null;
  nextSnapIndex = (nextSnapIndex + 1) % SNAP_POOL_SIZE;
  return channel;
}

export function playCalendarSnapSound() {
  const audio = getSnapChannel();
  if (!audio) {
    playFallbackTone();
    return;
  }
  try {
    if (audio.readyState < MEDIA_READY_MIN) {
      audio.load();
    }
    audio.currentTime = 0;
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      void playPromise.catch(() => {
        playFallbackTone();
      });
    }
  } catch {
    playFallbackTone();
  }
}

export function playReminderChime() {
  const context = getAudioContext();
  if (!context) {
    playFallbackTone();
    return;
  }

  if (context.state === 'suspended') {
    void context.resume();
  }

  const start = context.currentTime;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.52);
  gain.connect(context.destination);

  const first = context.createOscillator();
  first.type = 'sine';
  first.frequency.setValueAtTime(880, start);
  first.frequency.exponentialRampToValueAtTime(1320, start + 0.18);
  first.connect(gain);
  first.start(start);
  first.stop(start + 0.24);

  const second = context.createOscillator();
  second.type = 'sine';
  second.frequency.setValueAtTime(1174, start + 0.12);
  second.frequency.exponentialRampToValueAtTime(1568, start + 0.3);
  second.connect(gain);
  second.start(start + 0.12);
  second.stop(start + 0.42);
}

if (typeof window !== 'undefined') {
  installUnlockListener();
}
