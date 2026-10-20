'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { AppShell } from '@longrich/ui-kit';
import type { MobileNavProps } from '@longrich/ui-kit';

export function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [searchValue, setSearchValue] = useState('');

  const activeItem: MobileNavProps['activeItem'] = pathname === '/'
    ? 'home'
    : pathname?.startsWith('/catalog')
      ? 'categories'
      : undefined;

  return (
    <AppShell
      header={{
        search: {
          value: searchValue,
          onChange: setSearchValue,
          onSubmit: () => {},
        },
      }}
      mobileNav={{ activeItem }}
    >
      {children}
    </AppShell>
  );
}
