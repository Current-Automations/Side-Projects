/**
 * POST /api/game/name - claim a leaderboard display name for a device.
 * Body: { deviceId, shopSlug, name }.
 */
import { z } from 'zod';
import { claimDisplayName, DisplayNameSchema } from '@/lib/game';
import { ApiErrorCode } from '@/lib/types/api';

const BodySchema = z.object({
  deviceId: z.string().min(8).max(64),
  shopSlug: z.string().min(1),
  name: DisplayNameSchema,
});

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

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ');
    return bad(msg, ApiErrorCode.VALIDATION_ERROR, 400);
  }

  const { deviceId, shopSlug, name } = parsed.data;
  const result = await claimDisplayName(deviceId, shopSlug, name);
  if (!result.success) {
    return bad(result.error, ApiErrorCode.DB_ERROR, 502);
  }

  return Response.json({ success: true, data: { name } });
}
