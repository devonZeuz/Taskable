import type { Page } from '@playwright/test';

interface LocalBootstrapOptions {
  seedDemoTasks?: boolean;
  clearStorage?: boolean;
}

export async function bootstrapLocalMode(page: Page, options: LocalBootstrapOptions = {}) {
  const { seedDemoTasks = false, clearStorage = true } = options;
  await page.addInitScript(
    ({ seed, clear }) => {
      if (clear) {
        window.localStorage.clear();
      }
      window.localStorage.setItem('taskable:mode', 'local');
      window.localStorage.setItem('taskable:tutorial:local-completed', 'true');

      if (!seed) return;

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const makeIso = (hour: number, minute: number) => {
        const date = new Date(today);
        date.setHours(hour, minute, 0, 0);
        return date.toISOString();
      };
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
      const tasks = [
        {
          id: '1',
          title: 'Germany Invoices',
          description: 'Process invoices for Germany office',
          startDateTime: makeIso(8, 0),
          durationMinutes: 60,
          timeZone,
          completed: true,
          color: '#c9ced8',
          subtasks: [],
          type: 'quick',
          assignedTo: 'user1',
          status: 'scheduled',
          focus: false,
          executionStatus: 'completed',
          actualMinutes: 58,
          completedAt: makeIso(8, 58),
        },
        {
          id: '2',
          title: 'Swiss Invoices',
          description: 'Process invoices for Swiss office',
          startDateTime: makeIso(9, 0),
          durationMinutes: 60,
          timeZone,
          completed: true,
          color: '#8d929c',
          subtasks: [],
          type: 'quick',
          assignedTo: 'user1',
          status: 'scheduled',
          focus: false,
          executionStatus: 'completed',
          actualMinutes: 61,
          completedAt: makeIso(10, 1),
        },
        {
          id: '3',
          title: 'Monthly Reports',
          description: 'Prepare monthly reports for all departments',
          startDateTime: makeIso(10, 0),
          durationMinutes: 120,
          timeZone,
          completed: false,
          color: '#2d2f33',
          subtasks: [
            { id: '3a', title: 'Report 1', completed: true },
            { id: '3b', title: 'Report 2', completed: false },
            { id: '3c', title: 'Report 3', completed: false },
          ],
          type: 'large',
          assignedTo: 'user1',
          status: 'scheduled',
          focus: true,
          executionStatus: 'idle',
          actualMinutes: 0,
        },
      ];

      window.localStorage.setItem(
        'taskable-tasks',
        JSON.stringify({
          schemaVersion: 4,
          tasks,
        })
      );
    },
    { seed: seedDemoTasks, clear: clearStorage }
  );
}
