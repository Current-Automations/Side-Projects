/**
 * GET /api/game/shop/[slug] - per-shop config for the /play/[slug] page.
 * Public: no auth, anonymous players.
 */
import { getShopConfig } from '@/lib/game';
import { ApiErrorCode } from '@/lib/types/api';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params;

  const result = await getShopConfig(slug);
  if (!result.success) {
    return Response.json(
      { success: false, error: result.error, code: ApiErrorCode.NOT_FOUND },
      { status: 404 }
    );
  }

  return Response.json({ success: true, data: result.data });
}
