export interface AdminPanelBaseProps {
  token: string;
  orgId?: string;
  onError: (error: unknown, context: string) => void;
}
