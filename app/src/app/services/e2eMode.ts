const DND_HOOK_QUERY_KEY = 'e2e-dnd';
const DND_HOOK_STORAGE_KEY = 'taskable:e2e-dnd';

export function isDeterministicDndMode(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get(DND_HOOK_QUERY_KEY) === '1') {
      return true;
    }
  } catch {
    // ignore URL parsing issues
  }

  try {
    return window.localStorage.getItem(DND_HOOK_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}
