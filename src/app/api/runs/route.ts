import { NextResponse } from 'next/server';
import { listRuns } from '@/lib/runStore';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ runs: listRuns() });
}
