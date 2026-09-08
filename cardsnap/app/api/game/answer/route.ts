/**
 * POST /api/game/answer - grade an answer, record it, return the result.
 * Body: { deviceId, roundId, answer, timeMs? }. Grading is server-side against
 * the answer stored on the round row; the client never saw it.
 */
import { answerRound, AnswerRequestSchema } from '@/lib/game';
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

  const parsed = AnswerRequestSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ');
    return bad(msg, ApiErrorCode.VALIDATION_ERROR, 400);
  }

  const result = await answerRound(parsed.data);
  if (!result.success) {
    const status = result.error.includes('already answered') ? 409 : 502;
    return bad(result.error, ApiErrorCode.DB_ERROR, status);
  }

  return Response.json({ success: true, data: result.data });
}
