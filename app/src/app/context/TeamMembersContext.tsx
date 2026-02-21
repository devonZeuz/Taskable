import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_TEAM_MEMBERS, TeamMember } from '../data/teamMembers';

interface TeamMembersContextType {
  members: TeamMember[];
  customMembers: TeamMember[];
  removedDefaultMemberIds: string[];
  addMember: (name: string) => void;
  removeMember: (id: string) => void;
  replaceCustomMembers: (members: TeamMember[]) => void;
  replaceRemovedDefaultMemberIds: (memberIds: string[]) => void;
  restoreMember: (id: string) => void;
}

const TeamMembersContext = createContext<TeamMembersContextType | undefined>(undefined);
const STORAGE_KEY = 'taskable-custom-team-members';
const REMOVED_DEFAULT_STORAGE_KEY = 'taskable-removed-default-team-members';

function loadCustomMembers(): TeamMember[] {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored) as TeamMember[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCustomMembers(members: TeamMember[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(members));
}

function loadRemovedDefaultMemberIds(): string[] {
  const stored = localStorage.getItem(REMOVED_DEFAULT_STORAGE_KEY);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored) as string[];
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function saveRemovedDefaultMemberIds(memberIds: string[]) {
  localStorage.setItem(REMOVED_DEFAULT_STORAGE_KEY, JSON.stringify(memberIds));
}

function createMemberId(name: string) {
  return `custom-${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 16)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function TeamMembersProvider({ children }: { children: React.ReactNode }) {
  const [customMembers, setCustomMembers] = useState<TeamMember[]>(() => loadCustomMembers());
  const [removedDefaultMemberIds, setRemovedDefaultMemberIds] = useState<string[]>(() =>
    loadRemovedDefaultMemberIds()
  );

  useEffect(() => {
    saveCustomMembers(customMembers);
  }, [customMembers]);

  useEffect(() => {
    saveRemovedDefaultMemberIds(removedDefaultMemberIds);
  }, [removedDefaultMemberIds]);

  const members = useMemo(
    () => [
      ...DEFAULT_TEAM_MEMBERS.filter((member) => !removedDefaultMemberIds.includes(member.id)),
      ...customMembers,
    ],
    [customMembers, removedDefaultMemberIds]
  );

  const addMember = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;

    const matchingDefault = DEFAULT_TEAM_MEMBERS.find(
      (member) => member.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (matchingDefault) {
      setRemovedDefaultMemberIds((prev) =>
        prev.filter((memberId) => memberId !== matchingDefault.id)
      );
      return;
    }

    const exists = members.some((member) => member.name.toLowerCase() === trimmed.toLowerCase());
    if (exists) return;
    setCustomMembers((prev) => [...prev, { id: createMemberId(trimmed), name: trimmed }]);
  };

  const removeMember = (id: string) => {
    if (id === 'all' || id === 'unassigned') return;
    const isCustom = customMembers.some((member) => member.id === id);
    if (isCustom) {
      setCustomMembers((prev) => prev.filter((member) => member.id !== id));
      return;
    }
    setRemovedDefaultMemberIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };

  const replaceCustomMembers = (nextMembers: TeamMember[]) => {
    const sanitized = nextMembers.filter(
      (member) => typeof member.id === 'string' && typeof member.name === 'string'
    );
    setCustomMembers(sanitized);
  };

  const restoreMember = (id: string) => {
    setRemovedDefaultMemberIds((prev) => prev.filter((memberId) => memberId !== id));
  };

  const replaceRemovedDefaultMemberIds = (memberIds: string[]) => {
    const sanitized = memberIds.filter((memberId) => typeof memberId === 'string');
    setRemovedDefaultMemberIds(sanitized);
  };

  return (
    <TeamMembersContext.Provider
      value={{
        members,
        customMembers,
        removedDefaultMemberIds,
        addMember,
        removeMember,
        replaceCustomMembers,
        replaceRemovedDefaultMemberIds,
        restoreMember,
      }}
    >
      {children}
    </TeamMembersContext.Provider>
  );
}

export function useTeamMembers() {
  const context = useContext(TeamMembersContext);
  if (!context) {
    throw new Error('useTeamMembers must be used within TeamMembersProvider');
  }
  return context;
}
