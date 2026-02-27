import { expect, test } from '@playwright/test';
import { bootstrapLocalMode } from './storageBootstrap';

test('auto-start starts a task when now reaches its start time', async ({ page }) => {
  await bootstrapLocalMode(page, { seedDemoTasks: false });
  await page.addInitScript(() => {
    const fixedNow = new Date();
    fixedNow.setSeconds(0, 0);
    const fixedNowMs = fixedNow.getTime();

    const RealDate = Date;
    class MockDate extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          super(fixedNowMs);
          return;
        }
        if (args.length === 1) {
          super(args[0] as string | number | Date);
          return;
        }
        super(
          Number(args[0]),
          Number(args[1]),
          Number(args[2] ?? 1),
          Number(args[3] ?? 0),
          Number(args[4] ?? 0),
          Number(args[5] ?? 0),
          Number(args[6] ?? 0)
        );
      }
      static now() {
        return fixedNowMs;
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).Date = MockDate;

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
    const task = {
      id: 'auto-start-task',
      title: 'Auto start task',
      description: '',
      startDateTime: new RealDate(fixedNowMs).toISOString(),
      durationMinutes: 60,
      timeZone,
      completed: false,
      color: '#c9ced8',
      subtasks: [],
      type: 'quick',
      assignedTo: 'user1',
      status: 'scheduled',
      focus: false,
      executionStatus: 'idle',
      actualMinutes: 0,
    };

    window.localStorage.setItem(
      'taskable:user-preferences',
      JSON.stringify({
        schemaVersion: 6,
        preferences: {
          autoStartTasksAtStartTime: true,
          autoSwitchActiveTask: false,
          timelineZoom: 100,
        },
      })
    );

    window.localStorage.setItem(
      'taskable-tasks',
      JSON.stringify({
        schemaVersion: 4,
        tasks: [task],
      })
    );
  });

  await page.goto('/planner');

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem('taskable-tasks');
        if (!raw) return null;
        const parsed = JSON.parse(raw) as {
          tasks?: Array<{ id?: string; executionStatus?: string }>;
        };
        return parsed.tasks?.find((task) => task.id === 'auto-start-task')?.executionStatus ?? null;
      })
    )
    .toBe('running');
});
