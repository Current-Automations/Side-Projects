/**
 * GET /api/game/leaderboard/[slug] - top players for a shop, all-time.
 * Contest-scoped boards come later with the contest UI.
 */
import { leaderboard } from '@/lib/game';
import { ApiErrorCode } from '@/lib/types/api';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params;

  const result = await leaderboard(slug);
  if (!result.success) {
    return Response.json(
      { success: false, error: result.error, code: ApiErrorCode.DB_ERROR },
      { status: 502 }
    );
  }

  return Response.json({ success: true, data: result.data });
}
