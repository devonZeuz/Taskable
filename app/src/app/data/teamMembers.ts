export interface TeamMember {
  id: string;
  name: string;
  email?: string;
  role?: string;
}

export const DEFAULT_TEAM_MEMBERS: TeamMember[] = [
  { id: 'all', name: 'All Team Members' },
  { id: 'unassigned', name: 'Unassigned' },
  { id: 'user1', name: 'John Doe' },
  { id: 'user2', name: 'Jane Smith' },
  { id: 'user3', name: 'Mike Johnson' },
  { id: 'user4', name: 'Sarah Williams' },
];

export const TEAM_MEMBERS = DEFAULT_TEAM_MEMBERS;

export const ASSIGNABLE_MEMBERS = DEFAULT_TEAM_MEMBERS.filter((member) => member.id !== 'all');
