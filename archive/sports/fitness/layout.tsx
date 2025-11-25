import React from 'react';
import { StravaAuthProvider } from './StravaAuthContext';

export default function StravaSectionLayout({ children }: { children: React.ReactNode }) {
  return (
    <StravaAuthProvider>
      {children}
    </StravaAuthProvider>
  );
}
