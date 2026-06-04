import { NextRequest, NextResponse } from 'next/server';
import { handleGameAction } from '@/lib/v2/game-controller';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const viewState = await handleGameAction(body);
    return NextResponse.json(viewState);
  } catch (error) {
    if (error instanceof Error) {
      const isNotFound =
        error.message.includes('RecordNotFound') ||
        error.name === 'NotFoundError' ||
        error.message.toLowerCase().includes('no record was found');
      return NextResponse.json({ error: error.message }, { status: isNotFound ? 404 : 500 });
    }
    return NextResponse.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}
