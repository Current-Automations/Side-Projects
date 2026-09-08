/**
 * POST /api/game/round - draw and persist a new round, return the question.
 * Body: { deviceId, shopSlug, mode? }. The response never carries the answer.
 */
import { startRound, RoundRequestSchema } from '@/lib/game';
import { ApiErrorCode } from '@/lib/types/api';

function bad(error: string, code: string, status: number): Response {
  return Response.json({ success: false, error, code }, { status });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad('Request body must be valid JSON', ApiErrorCode.VALIDATION_ERROR, 400);
  }

  const parsed = RoundRequestSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ');
    return bad(msg, ApiErrorCode.VALIDATION_ERROR, 400);
  }

  const result = await startRound(parsed.data);
  if (!result.success) {
    return bad(result.error, ApiErrorCode.DB_ERROR, 502);
  }

  return Response.json({ success: true, data: result.data });
}
