import { buildTaskSearch, parseTaskIdFromSearch, removeTaskIdFromSearch } from './taskDeepLink';

describe('taskDeepLink helpers', () => {
  it('parses taskId query values', () => {
    expect(parseTaskIdFromSearch('?taskId=abc123')).toBe('abc123');
    expect(parseTaskIdFromSearch('?foo=1&taskId=hello-world&bar=2')).toBe('hello-world');
  });

  it('returns null when taskId is missing or empty', () => {
    expect(parseTaskIdFromSearch('')).toBeNull();
    expect(parseTaskIdFromSearch('?foo=bar')).toBeNull();
    expect(parseTaskIdFromSearch('?taskId=%20%20')).toBeNull();
  });

  it('removes taskId while preserving other params', () => {
    expect(removeTaskIdFromSearch('?taskId=abc')).toBe('');
    expect(removeTaskIdFromSearch('?taskId=abc&foo=bar')).toBe('?foo=bar');
    expect(removeTaskIdFromSearch('?foo=bar&taskId=abc&x=1')).toBe('?foo=bar&x=1');
  });

  it('builds taskId search safely', () => {
    expect(buildTaskSearch('abc123')).toBe('?taskId=abc123');
    expect(buildTaskSearch('  xyz  ')).toBe('?taskId=xyz');
    expect(buildTaskSearch('')).toBe('');
    expect(buildTaskSearch(null)).toBe('');
  });
});
