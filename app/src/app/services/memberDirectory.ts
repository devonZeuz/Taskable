import type { TeamMember } from '../data/teamMembers';

const ALL_MEMBERS_ENTRY: TeamMember = { id: 'all', name: 'All Team Members' };
const UNASSIGNED_ENTRY: TeamMember = { id: 'unassigned', name: 'Unassigned' };

export function buildEffectiveMembers(
  localMembers: TeamMember[],
  cloudMembers: TeamMember[],
  useCloudMembers: boolean
): TeamMember[] {
  if (!useCloudMembers) {
    return localMembers;
  }

  const uniqueCloudMembers = cloudMembers
    .filter((member) => member.id !== 'all' && member.id !== 'unassigned')
    .reduce<TeamMember[]>((acc, member) => {
      if (acc.some((existing) => existing.id === member.id)) return acc;
      acc.push({ id: member.id, name: member.name });
      return acc;
    }, []);

  return [ALL_MEMBERS_ENTRY, UNASSIGNED_ENTRY, ...uniqueCloudMembers];
}
