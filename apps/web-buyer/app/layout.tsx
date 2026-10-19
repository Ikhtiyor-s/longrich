import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Longrich Marketplace — Buyer',
  description: 'G0 scaffold placeholder. No business logic yet.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
