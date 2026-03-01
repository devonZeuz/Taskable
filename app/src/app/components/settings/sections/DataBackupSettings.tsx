import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAppTheme } from '../../../context/AppThemeContext';
import { useCloudSync } from '../../../context/CloudSyncContext';
import { useNotificationSettings } from '../../../context/NotificationSettingsContext';
import { useTasks } from '../../../context/TaskContext';
import { useTeamMembers } from '../../../context/TeamMembersContext';
import { useWorkday } from '../../../context/WorkdayContext';
import { createPlannerBackupPayload, parsePlannerBackup } from '../../../services/plannerBackup';
import { cloudRequest } from '../../../services/cloudApi';
import { Button } from '../../ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../ui/alert-dialog';

export default function DataBackupSettings() {
  const localImportRef = useRef<HTMLInputElement | null>(null);
  const [confirmDeleteAllOpen, setConfirmDeleteAllOpen] = useState(false);
  const { tasks, replaceTasks } = useTasks();
  const { workday, setWorkday } = useWorkday();
  const {
    customMembers,
    removedDefaultMemberIds,
    replaceCustomMembers,
    replaceRemovedDefaultMemberIds,
  } = useTeamMembers();
  const { theme, setTheme } = useAppTheme();
  const { enabled: notificationsEnabled, setEnabled: setNotificationsEnabled } =
    useNotificationSettings();
  const {
    token,
    activeOrgId,
    pullTasks,
    enabled: cloudEnabled,
    canDeleteTasks,
    activeOrgRole,
  } = useCloudSync();
  const isCloudWorkspaceMode = cloudEnabled && Boolean(token && activeOrgId);
  const roleLabel = activeOrgRole ?? 'viewer';

  const exportLocalBackup = () => {
    const payload = createPlannerBackupPayload({
      tasks,
      workday,
      customMembers,
      removedDefaultMemberIds,
      appTheme: theme,
      notificationsEnabled,
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `taskable-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('Local backup downloaded.');
  };

  const triggerLocalImport = () => {
    localImportRef.current?.click();
  };

  const importLocalBackup = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const parsed = parsePlannerBackup(await file.text());
      replaceTasks(parsed.tasks, { clearHistory: true });
      setWorkday(parsed.workday);
      replaceCustomMembers(parsed.customMembers);
      replaceRemovedDefaultMemberIds(parsed.removedDefaultMemberIds ?? []);
      setTheme(parsed.appTheme);
      setNotificationsEnabled(parsed.notificationsEnabled);
      toast.success('Backup restored.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to restore backup.';
      toast.error(message);
    }
  };

  const exportWorkspaceData = async () => {
    if (!token || !activeOrgId) {
      toast.error('Connect cloud sync first.');
      return;
    }

    try {
      const payload = await cloudRequest<{ tasks: unknown[] }>(
        `/api/v1/orgs/${activeOrgId}/tasks`,
        {
          token,
        }
      );
      const blob = new Blob(
        [
          JSON.stringify(
            {
              schemaVersion: 2,
              exportedAt: new Date().toISOString(),
              orgId: activeOrgId,
              tasks: payload.tasks ?? [],
            },
            null,
            2
          ),
        ],
        { type: 'application/json' }
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `taskable-workspace-${activeOrgId}-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success('Workspace export downloaded.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Workspace export failed.';
      toast.error(message);
    }
  };

  const importLocalIntoWorkspace = async () => {
    if (!token || !activeOrgId) {
      toast.error('Connect cloud sync first.');
      return;
    }

    const confirmed = window.confirm(
      'Import current local tasks into this workspace and replace existing workspace tasks?'
    );
    if (!confirmed) return;

    try {
      await cloudRequest<{ importedCount: number }>(`/api/v1/orgs/${activeOrgId}/import-local`, {
        method: 'POST',
        token,
        body: {
          replaceAll: true,
          tasks: tasks.map((task) => ({
            id: task.id,
            title: task.title,
            description: task.description ?? '',
            startDateTime: task.startDateTime,
            durationMinutes: task.durationMinutes,
            timeZone: task.timeZone,
            completed: task.completed,
            color: task.color,
            subtasks: task.subtasks.map((subtask) => ({
              id: subtask.id,
              title: subtask.title,
              completed: subtask.completed,
            })),
            type: task.type,
            assignedTo: task.assignedTo,
            status: task.status ?? (task.startDateTime ? 'scheduled' : 'inbox'),
            focus: Boolean(task.focus),
            executionStatus: task.executionStatus,
            actualMinutes: task.actualMinutes,
            lastStartAt: task.lastStartAt,
            completedAt: task.completedAt,
            lastEndPromptAt: task.lastEndPromptAt ?? task.lastPromptAt,
            lastPromptAt: task.lastEndPromptAt ?? task.lastPromptAt,
            version: task.version,
          })),
        },
      });
      await pullTasks();
      toast.success('Local tasks imported into workspace.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Workspace import failed.';
      toast.error(message);
    }
  };

  const resetLocalData = () => {
    const confirmed = window.confirm(
      'Reset local planner data? This clears local tasks, team customizations, and resets workday.'
    );
    if (!confirmed) return;

    replaceTasks([], { clearHistory: true });
    setWorkday({ startHour: 8, endHour: 16 });
    replaceCustomMembers([]);
    replaceRemovedDefaultMemberIds([]);
    toast.success('Local planner data reset.');
  };

  const deleteAllTasksForTesting = async () => {
    if (isCloudWorkspaceMode && !canDeleteTasks) {
      toast.error(`Role "${roleLabel}" cannot delete tasks in this workspace.`);
      return;
    }

    replaceTasks([], { clearHistory: false });

    if (isCloudWorkspaceMode) {
      toast.success('All tasks deleted. Syncing to cloud...');
      return;
    }

    toast.success('All local tasks deleted.');
  };

  return (
    <div className="space-y-4">
      <section className="ui-hud-section ui-v1-radius-md p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
          Local Backup
        </p>
        <p className="mt-2 text-xs text-[color:var(--hud-muted)]">
          Export or restore local planner data with schema versioning.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" onClick={exportLocalBackup}>
            Download local backup
          </Button>
          <Button type="button" variant="outline" onClick={triggerLocalImport}>
            Restore backup
          </Button>
          <Button type="button" variant="ghost" onClick={resetLocalData}>
            Reset local data
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => setConfirmDeleteAllOpen(true)}
            disabled={isCloudWorkspaceMode && !canDeleteTasks}
          >
            Delete all tasks (testing)
          </Button>
        </div>
        {isCloudWorkspaceMode && !canDeleteTasks && (
          <p className="mt-2 text-xs text-[color:var(--hud-warning-text)]">
            Role "{roleLabel}" cannot run delete-all in this workspace.
          </p>
        )}
        <input
          ref={localImportRef}
          type="file"
          accept="application/json"
          onChange={importLocalBackup}
          className="hidden"
        />
      </section>

      <section className="ui-hud-section ui-v1-radius-md p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
          Workspace Data
        </p>
        <p className="mt-2 text-xs text-[color:var(--hud-muted)]">
          Cloud mode only. Export workspace tasks or import your local board into the active
          workspace.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void exportWorkspaceData()}>
            Export workspace data
          </Button>
          <Button type="button" onClick={() => void importLocalIntoWorkspace()}>
            Import local data into workspace
          </Button>
        </div>
      </section>

      <AlertDialog open={confirmDeleteAllOpen} onOpenChange={setConfirmDeleteAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all tasks?</AlertDialogTitle>
            <AlertDialogDescription>
              This clears every task currently on the board.
              {isCloudWorkspaceMode
                ? ' In cloud mode this will also sync and remove tasks from the active workspace.'
                : ' This action affects local data only.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                void deleteAllTasksForTesting();
              }}
            >
              Delete all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
