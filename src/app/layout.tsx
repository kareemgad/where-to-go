import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'Where to Go',
  description: 'Find your kind of night.',
};

/**
 * Root layout only. Language and direction are set by the market-scoped layout
 * at src/app/[market]/layout.tsx, which reads them from the market record —
 * never from a constant here (ADR-009, ADR-012).
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
