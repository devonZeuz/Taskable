import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useCloudSync } from '../../../context/CloudSyncContext';
import { useTeamMembers } from '../../../context/TeamMembersContext';
import { DEFAULT_TEAM_MEMBERS, type TeamMember } from '../../../data/teamMembers';
import { buildEffectiveMembers } from '../../../services/memberDirectory';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';

type OrgRole = 'owner' | 'admin' | 'member' | 'viewer';

const ORG_ROLE_OPTIONS: OrgRole[] = ['owner', 'admin', 'member', 'viewer'];

export default function TeamPermissionsSettings() {
  const [newMemberValue, setNewMemberValue] = useState('');
  const {
    members: localMembers,
    removedDefaultMemberIds,
    addMember,
    removeMember,
    restoreMember,
  } = useTeamMembers();
  const {
    enabled: cloudEnabled,
    token: cloudToken,
    activeOrgId,
    orgs,
    user,
    members: cloudMembers,
    addMemberByEmail,
    removeMember: removeCloudMember,
    updateMemberRole,
  } = useCloudSync();

  const isCloudMode = cloudEnabled && Boolean(cloudToken && activeOrgId);
  const activeOrgRole = useMemo(
    () => orgs.find((org) => org.id === activeOrgId)?.role ?? null,
    [activeOrgId, orgs]
  );
  const effectiveMembers = useMemo(
    () => buildEffectiveMembers(localMembers, cloudMembers, isCloudMode),
    [cloudMembers, isCloudMode, localMembers]
  );
  const editableMembers = effectiveMembers.filter(
    (member) => member.id !== 'all' && member.id !== 'unassigned'
  );
  const hiddenDefaultMembers = DEFAULT_TEAM_MEMBERS.filter((member) =>
    removedDefaultMemberIds.includes(member.id)
  );

  const canManageCloudMembers =
    isCloudMode && (activeOrgRole === 'owner' || activeOrgRole === 'admin');

  const handleAddMember = async () => {
    const trimmed = newMemberValue.trim();
    if (!trimmed) return;

    if (!isCloudMode) {
      addMember(trimmed);
      setNewMemberValue('');
      return;
    }

    if (!canManageCloudMembers) {
      toast.error('Only owner/admin can add workspace members.');
      return;
    }

    try {
      await addMemberByEmail(trimmed);
      setNewMemberValue('');
      toast.success('Workspace member invited.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add member.';
      toast.error(message);
    }
  };

  const canEditRole = (member: TeamMember) => {
    if (!isCloudMode || !canManageCloudMembers) return false;
    const memberRole = normalizeRole(member.role);
    if (activeOrgRole === 'owner') return true;
    if (activeOrgRole === 'admin') {
      return memberRole === 'member' || memberRole === 'viewer';
    }
    return false;
  };

  const roleChoicesForMember = (member: TeamMember): OrgRole[] => {
    if (activeOrgRole === 'owner') return ORG_ROLE_OPTIONS;
    const memberRole = normalizeRole(member.role);
    if (activeOrgRole === 'admin' && (memberRole === 'member' || memberRole === 'viewer')) {
      return ['member', 'viewer'];
    }
    return [memberRole];
  };

  const canRemoveMemberEntry = (member: TeamMember) => {
    if (!isCloudMode) return true;
    if (!canManageCloudMembers) return false;
    if (member.id === user?.id) return false;
    const memberRole = normalizeRole(member.role);
    if (activeOrgRole === 'admin' && (memberRole === 'owner' || memberRole === 'admin')) {
      return false;
    }
    return true;
  };

  const handleRoleChange = async (memberId: string, role: OrgRole) => {
    try {
      await updateMemberRole(memberId, role);
      toast.success('Role updated.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update role.';
      toast.error(message);
    }
  };

  const handleRemoveMember = async (member: TeamMember) => {
    if (!isCloudMode) {
      removeMember(member.id);
      return;
    }

    try {
      await removeCloudMember(member.id);
      toast.success(`${member.name} removed.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove member.';
      toast.error(message);
    }
  };

  return (
    <div className="space-y-4">
      <section className="ui-hud-section rounded-[14px] p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
          Team Directory
        </p>
        <p className="mt-2 text-xs text-[color:var(--hud-muted)]">
          {isCloudMode
            ? 'Workspace roles are enforced server-side.'
            : 'Local mode stores team members in this browser.'}
        </p>

        <div className="mt-3 flex gap-2">
          <Input
            value={newMemberValue}
            onChange={(event) => setNewMemberValue(event.target.value)}
            placeholder={isCloudMode ? 'member@company.com' : 'Member name'}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void handleAddMember();
              }
            }}
          />
          <Button type="button" onClick={() => void handleAddMember()}>
            Add
          </Button>
        </div>
      </section>

      <section className="ui-hud-section rounded-[14px] p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
          Members & Roles
        </p>
        <div className="mt-3 space-y-2">
          {editableMembers.map((member) => {
            const currentRole = normalizeRole(member.role);
            const roleChoices = roleChoicesForMember(member);
            const isRoleEditable = canEditRole(member);
            const canRemove = canRemoveMemberEntry(member);

            return (
              <div
                key={member.id}
                className="flex flex-wrap items-center justify-between gap-2 ui-hud-row rounded-[10px] px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[color:var(--hud-text)]">
                    {member.name}
                  </p>
                  <p className="truncate text-[11px] text-[color:var(--hud-muted)]">
                    {member.email ?? member.id}
                    {member.id === user?.id ? ' | You' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {isCloudMode ? (
                    <Select
                      value={currentRole}
                      onValueChange={(value) =>
                        void handleRoleChange(member.id, normalizeRole(value))
                      }
                      disabled={!isRoleEditable}
                    >
                      <SelectTrigger className="h-8 w-[120px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {roleChoices.map((role) => (
                          <SelectItem key={`${member.id}-${role}`} value={role}>
                            {role}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="ui-hud-chip rounded-full px-2 py-1 text-[11px]">
                      Local member
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleRemoveMember(member)}
                    disabled={!canRemove}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            );
          })}
          {editableMembers.length === 0 && (
            <p className="text-sm text-[color:var(--hud-muted)]">No team members available.</p>
          )}
        </div>
      </section>

      {!isCloudMode && hiddenDefaultMembers.length > 0 && (
        <section className="ui-hud-section rounded-[14px] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
            Removed Built-in Members
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {hiddenDefaultMembers.map((member) => (
              <Button
                key={member.id}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => restoreMember(member.id)}
              >
                Restore {member.name}
              </Button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function normalizeRole(input: string | undefined): OrgRole {
  if (input === 'owner' || input === 'admin' || input === 'member' || input === 'viewer') {
    return input;
  }
  return 'member';
}
