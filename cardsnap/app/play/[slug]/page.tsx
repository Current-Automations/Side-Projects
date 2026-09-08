/**
 * /play/[slug] - the white-label shop game.
 *
 * Multi-tenant by URL slug: one deploy, per-shop config selected here. Adding a
 * shop is a row in `shops`, not a deploy. The page shell is server-rendered;
 * the game loop is the client component.
 */
import type { Metadata } from 'next';
import { GameClient } from './game-client';

export const metadata: Metadata = {
  title: 'Card Match',
  robots: { index: false },
};

export default async function PlayPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <GameClient slug={slug} />;
}
