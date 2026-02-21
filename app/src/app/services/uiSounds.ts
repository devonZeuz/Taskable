const SNAP_SOUND_URL = new URL('../../../Assets/switch-sound.mp3', import.meta.url).href;
const SNAP_POOL_SIZE = 4;
let snapPool: HTMLAudioElement[] | null = null;
let nextSnapIndex = 0;
let snapAudioContext: AudioContext | null = null;
let unlockListenerInstalled = false;
let snapSourceUrl = SNAP_SOUND_URL;
let snapSourceReady = false;
let snapSourceWarmupPromise: Promise<void> | null = null;
let snapFilePlaybackDisabled = false;

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

function installUnlockListener() {
  if (unlockListenerInstalled || typeof window === 'undefined') return;
  unlockListenerInstalled = true;

  const unlock = () => {
    const context = getAudioContext();
    if (context?.state === 'suspended') {
      void context.resume();
    }
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

async function warmupSnapSource() {
  if (snapSourceReady || snapFilePlaybackDisabled || typeof window === 'undefined') return;
  if (snapSourceWarmupPromise) {
    await snapSourceWarmupPromise;
    return;
  }

  snapSourceWarmupPromise = (async () => {
    try {
      const response = await fetch(SNAP_SOUND_URL, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Sound asset request failed with status ${response.status}.`);
      }
      const blob = await response.blob();
      snapSourceUrl = URL.createObjectURL(blob);
    } catch {
      // Avoid repeated broken media fetches when cache/media APIs are unavailable.
      snapFilePlaybackDisabled = true;
    } finally {
      snapSourceReady = true;
      if (snapPool && !snapFilePlaybackDisabled) {
        snapPool.forEach((audio) => {
          if (audio.src === snapSourceUrl) return;
          audio.src = snapSourceUrl;
          audio.load();
        });
      }
      snapSourceWarmupPromise = null;
    }
  })();

  await snapSourceWarmupPromise;
}

function getSnapChannel(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  installUnlockListener();
  void warmupSnapSource();
  if (snapFilePlaybackDisabled) return null;
  if (!snapPool) {
    snapPool = Array.from({ length: SNAP_POOL_SIZE }, () => {
      const audio = new Audio(snapSourceUrl);
      audio.preload = 'auto';
      audio.volume = 0.75;
      audio.addEventListener(
        'error',
        () => {
          snapFilePlaybackDisabled = true;
          snapPool = null;
        },
        { once: true }
      );
      return audio;
    });
  }
  const channel = snapPool[nextSnapIndex] ?? null;
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
