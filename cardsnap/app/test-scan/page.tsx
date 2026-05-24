/**
 * app/test-scan/page.tsx
 *
 * DEV-ONLY manual test harness for POST /api/scan. Upload a card image, see the
 * raw JSON response.
 *
 * NOTE: this only REDIRECTS in production — the route is still registered and the
 * client source still ships in the production bundle. It is not usable (no scan
 * UI renders), but it is not build-time excluded.
 * Tracked in .scratch/scan-endpoint/issues/02-test-scan-page-ships-in-prod.md
 */

import { redirect } from 'next/navigation';
import { TestScanClient } from './test-scan-client';

export default function TestScanPage() {
  if (process.env.NODE_ENV === 'production') {
    redirect('/');
  }
  return <TestScanClient />;
}
