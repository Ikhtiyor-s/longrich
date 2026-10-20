import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { AppChrome } from './app-chrome';
import './globals.css';

const inter = Inter({ subsets: ['latin', 'cyrillic'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'Longrich Marketplace — Buyer',
  description: 'Oʻzbekiston multi-vendor marketplace. Katalog, takliflar va xavfsiz xarid.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uz">
      <body className={inter.variable} style={{ fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
        <AppChrome>{children}</AppChrome>
      </body>
    </html>
  );
}
