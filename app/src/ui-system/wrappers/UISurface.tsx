import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';
import { cn } from '../../app/components/ui/utils';
import { useUiSystem } from './UISystemProvider';

type SurfaceLevel = '1' | '2' | '3';
type SurfaceTone = 'default' | 'muted' | 'strong';

interface UISurfaceProps<T extends ElementType> {
  as?: T;
  level?: SurfaceLevel;
  tone?: SurfaceTone;
  className?: string;
  children?: ReactNode;
}

type PolymorphicProps<T extends ElementType> = UISurfaceProps<T> &
  Omit<ComponentPropsWithoutRef<T>, keyof UISurfaceProps<T>>;

export function UISurface<T extends ElementType = 'div'>({
  as,
  level = '1',
  tone = 'default',
  className,
  children,
  ...rest
}: PolymorphicProps<T>) {
  const { enabled } = useUiSystem();
  const Component = (as ?? 'div') as ElementType;

  return (
    <Component
      className={cn(
        enabled && 'ui-v1-surface',
        enabled && `ui-v1-surface-${level}`,
        enabled && `ui-v1-surface-tone-${tone}`,
        className
      )}
      {...rest}
    >
      {children}
    </Component>
  );
}
