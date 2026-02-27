import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../app/components/ui/utils';
import { useUiSystem } from '../wrappers/UISystemProvider';

type GapToken = '1' | '2' | '3' | '4' | '5' | '6' | '8';

interface WithChildren {
  children?: ReactNode;
}

interface LayoutProps extends HTMLAttributes<HTMLDivElement>, WithChildren {
  gap?: GapToken;
}

export function UIStack({ gap = '4', className, children, ...rest }: LayoutProps) {
  const { enabled } = useUiSystem();
  return (
    <div
      className={cn(enabled && 'ui-v1-stack', className)}
      style={enabled ? { ['--ui-v1-gap' as string]: `var(--ui-v1-space-${gap})` } : undefined}
      {...rest}
    >
      {children}
    </div>
  );
}

export function UICluster({ gap = '3', className, children, ...rest }: LayoutProps) {
  const { enabled } = useUiSystem();
  return (
    <div
      className={cn(enabled && 'ui-v1-cluster', className)}
      style={enabled ? { ['--ui-v1-gap' as string]: `var(--ui-v1-space-${gap})` } : undefined}
      {...rest}
    >
      {children}
    </div>
  );
}

interface UISplitPaneProps extends HTMLAttributes<HTMLDivElement>, WithChildren {
  leftWidth?: string;
}

export function UISplitPane({
  leftWidth = 'minmax(320px, 420px)',
  className,
  children,
  ...rest
}: UISplitPaneProps) {
  const { enabled } = useUiSystem();
  return (
    <div
      className={cn(enabled && 'ui-v1-split', className)}
      style={enabled ? { ['--ui-v1-left-pane' as string]: leftWidth } : undefined}
      {...rest}
    >
      {children}
    </div>
  );
}
