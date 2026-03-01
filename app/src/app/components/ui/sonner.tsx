import { useEffect, useState, type CSSProperties } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

function getCurrentToasterTheme(): NonNullable<ToasterProps['theme']> {
  if (typeof document === 'undefined') {
    return 'dark';
  }

  const appTheme = document.documentElement.getAttribute('data-app-theme');

  if (appTheme === 'default') {
    return 'dark';
  }

  if (appTheme === 'sugar-plum') {
    return 'dark';
  }

  if (appTheme === 'vibrant-pop') {
    return 'dark';
  }

  if (appTheme === 'white') {
    return 'light';
  }

  return 'dark';
}

const Toaster = ({ ...props }: ToasterProps) => {
  const [theme, setTheme] = useState<NonNullable<ToasterProps['theme']>>(() =>
    getCurrentToasterTheme()
  );

  useEffect(() => {
    const updateTheme = () => {
      setTheme(getCurrentToasterTheme());
    };

    updateTheme();

    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-app-theme'],
    });

    return () => observer.disconnect();
  }, []);

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
