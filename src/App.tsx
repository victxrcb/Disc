import { lazy, Suspense } from 'react';
import { Download } from './pages/Download';

const DesktopApp = lazy(() => import('./DesktopApp'));

export function App() {
  if (import.meta.env.MODE !== 'desktop') return <Download />;
  return <Suspense fallback={null}><DesktopApp /></Suspense>;
}
