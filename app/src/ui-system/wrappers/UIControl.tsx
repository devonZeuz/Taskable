import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../app/components/ui/utils';
import { useUiSystem } from './UISystemProvider';

export function UIControlGroup({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) {
  const { enabled } = useUiSystem();
  return (
    <div className={cn(enabled && 'ui-v1-control-group', className)} {...rest}>
      {children}
    </div>
  );
}

type UIActionTone = 'default' | 'primary' | 'subtle';

export function UIActionButton({
  tone = 'default',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: UIActionTone; children?: ReactNode }) {
  const { enabled } = useUiSystem();
  return (
    <button
      className={cn(enabled && 'ui-v1-action', enabled && `ui-v1-action-${tone}`, className)}
      {...rest}
    >
      {children}
    </button>
  );
}
