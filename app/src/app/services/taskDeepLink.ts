export function parseTaskIdFromSearch(search: string): string | null {
  if (!search) {
    return null;
  }

  const params = new URLSearchParams(search);
  const rawTaskId = params.get('taskId');
  if (!rawTaskId) {
    return null;
  }

  const normalized = rawTaskId.trim();
  return normalized.length > 0 ? normalized : null;
}

export function removeTaskIdFromSearch(search: string): string {
  if (!search) {
    return '';
  }

  const params = new URLSearchParams(search);
  params.delete('taskId');
  const next = params.toString();
  return next.length > 0 ? `?${next}` : '';
}

export function buildTaskSearch(taskId: string | null | undefined): string {
  const normalized = (taskId ?? '').trim();
  if (!normalized) {
    return '';
  }

  const params = new URLSearchParams();
  params.set('taskId', normalized);
  return `?${params.toString()}`;
}
