import { NextResponse } from 'next/server';
import { getRuns } from '@/lib/runStore';

export const runtime = 'nodejs';

export async function GET() {
    return NextResponse.json({ runs: getRuns(20) });
}
