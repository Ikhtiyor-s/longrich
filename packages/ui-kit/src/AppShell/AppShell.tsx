import type { ReactNode } from 'react';
import { Header } from '../Header/Header.js';
import type { HeaderProps } from '../Header/Header.js';
import { MobileNav } from '../MobileNav/MobileNav.js';
import type { MobileNavProps } from '../MobileNav/MobileNav.js';
import styles from './AppShell.module.css';

export interface AppShellProps {
  children: ReactNode;
  header: HeaderProps;
  mobileNav?: MobileNavProps;
  footer?: ReactNode;
}

function DefaultFooter() {
  return (
    <p className={styles.footerText}>
      G7 — katalog bo&apos;limi. Savat/kirish keyingi bosqichlarda qo&apos;shiladi.
    </p>
  );
}

export function AppShell({ children, header, mobileNav, footer }: AppShellProps) {
  const resolvedMobileNav: MobileNavProps = mobileNav ?? {
    onFavoritesActivate: header.onFavoritesActivate,
    onProfileActivate: header.onAccountActivate,
  };

  return (
    <div className={styles.shell}>
      <Header {...header} />
      <main className={styles.main}>{children}</main>
      <footer className={styles.footer}>{footer ?? <DefaultFooter />}</footer>
      <MobileNav {...resolvedMobileNav} />
    </div>
  );
}
