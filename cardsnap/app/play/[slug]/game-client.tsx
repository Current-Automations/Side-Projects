'use client';

/**
 * The game loop. Anonymous: a device id is minted into localStorage on first
 * launch and carries the score history. No signup. Every grade is server-side
 * (POST /api/game/answer) - the client never sees the correct answer until the
 * result comes back.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

function readLocal(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

const DEVICE_KEY = 'cardsnap_device';
const NAME_KEY = 'cardsnap_name';

interface ShopConfig {
  slug: string;
  display_name: string;
  logo_url: string | null;
  theme_color: string | null;
}

interface Question {
  roundId: string;
  mode: 'set' | 'variant';
  prompt: string;
  imageUrl: string;
  choices: string[];
}

interface AnswerResult {
  correct: boolean;
  correctAnswer: string;
  scored: boolean;
  player: { correct: number; answered: number; trustScore: number };
}

interface LeaderRow {
  displayName: string;
  correct: number;
  answered: number;
}

type Phase = 'loading' | 'not-found' | 'idle' | 'question' | 'feedback' | 'leaderboard';

function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export function GameClient({ slug }: { slug: string }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [shop, setShop] = useState<ShopConfig | null>(null);
  const [question, setQuestion] = useState<Question | null>(null);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [score, setScore] = useState<{ correct: number; answered: number }>({ correct: 0, answered: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [board, setBoard] = useState<LeaderRow[]>([]);
  const [name, setName] = useState(() => readLocal(NAME_KEY));
  const askedAt = useRef<number>(0);
  const [deviceId] = useState(() => (typeof window === 'undefined' ? '' : getDeviceId()));

  const accent = shop?.theme_color ?? '#0e7359';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/game/shop/${encodeURIComponent(slug)}`);
        const json = await res.json();
        if (cancelled) return;
        if (!json.success) {
          setPhase('not-found');
          return;
        }
        setShop(json.data);
        setPhase('idle');
      } catch {
        if (!cancelled) setPhase('not-found');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const nextRound = useCallback(async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/game/round', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, shopSlug: slug, mode: 'set' }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error ?? 'Could not load a card.');
        return;
      }
      setQuestion(json.data);
      setPhase('question');
      askedAt.current = Date.now();
    } catch {
      setError('Network error. Try again.');
    } finally {
      setBusy(false);
    }
  }, [slug, deviceId]);

  const answer = useCallback(
    async (choice: string) => {
      if (!question || busy) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch('/api/game/answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceId,
            roundId: question.roundId,
            answer: choice,
            timeMs: Date.now() - askedAt.current,
          }),
        });
        const json = await res.json();
        if (!json.success) {
          setError(json.error ?? 'Could not score that.');
          return;
        }
        const data: AnswerResult = json.data;
        setResult(data);
        setScore({ correct: data.player.correct, answered: data.player.answered });
        setPhase('feedback');
      } catch {
        setError('Network error. Try again.');
      } finally {
        setBusy(false);
      }
    },
    [question, busy, deviceId]
  );

  const openBoard = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/game/leaderboard/${encodeURIComponent(slug)}`);
      const json = await res.json();
      setBoard(json.success ? json.data : []);
      setPhase('leaderboard');
    } catch {
      setBoard([]);
      setPhase('leaderboard');
    } finally {
      setBusy(false);
    }
  }, [slug]);

  const claimName = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await fetch('/api/game/name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, shopSlug: slug, name: trimmed }),
      });
      try {
        localStorage.setItem(NAME_KEY, trimmed);
      } catch {
        /* ignore */
      }
      await openBoard();
    } finally {
      setBusy(false);
    }
  }, [name, slug, deviceId, openBoard]);

  // ── render ────────────────────────────────────────────────────────────────

  if (phase === 'loading') {
    return <Centered>Loading…</Centered>;
  }

  if (phase === 'not-found') {
    return <Centered>No game found for this shop.</Centered>;
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col px-4 pb-8 pt-6">
      <header className="mb-4 flex items-center justify-between">
        <div className="text-lg font-semibold" style={{ color: accent }}>
          {shop?.display_name}
        </div>
        <button
          onClick={openBoard}
          className="rounded-full border px-3 py-1 text-sm text-neutral-600"
        >
          Leaderboard
        </button>
      </header>

      {phase !== 'leaderboard' && (
        <p className="mb-4 text-sm text-neutral-500">
          Score {score.correct}/{score.answered}
        </p>
      )}

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {phase === 'idle' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
          <h1 className="text-2xl font-bold">Name the set</h1>
          <p className="max-w-xs text-neutral-500">
            A Pokémon card, four sets. Pick the one it came from. Build a streak, land on the
            board.
          </p>
          <button
            onClick={nextRound}
            disabled={busy}
            className="rounded-xl px-8 py-3 text-lg font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: accent }}
          >
            {busy ? 'Loading…' : 'Start'}
          </button>
        </div>
      )}

      {(phase === 'question' || phase === 'feedback') && question && (
        <div className="flex flex-1 flex-col">
          <div className="mb-4 overflow-hidden rounded-xl bg-neutral-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={question.imageUrl}
              alt="Pokémon card"
              className="mx-auto block max-h-[46vh] w-auto object-contain"
            />
          </div>
          <p className="mb-3 text-center font-medium">{question.prompt}</p>
          <div className="grid gap-2">
            {question.choices.map((choice) => {
              const isAnswer = result?.correctAnswer === choice;
              const isPicked = phase === 'feedback' && result && !result.correct && !isAnswer;
              return (
                <button
                  key={choice}
                  onClick={() => answer(choice)}
                  disabled={phase === 'feedback' || busy}
                  className={[
                    'rounded-xl border px-4 py-3 text-left text-sm font-medium transition',
                    phase === 'feedback' && isAnswer ? 'border-green-500 bg-green-50 text-green-800' : '',
                    isPicked ? 'border-red-400 bg-red-50 text-red-700' : '',
                    phase === 'question' ? 'active:scale-[0.99]' : '',
                  ].join(' ')}
                >
                  {choice}
                </button>
              );
            })}
          </div>

          {phase === 'feedback' && result && (
            <div className="mt-5 flex flex-col items-center gap-3">
              <p className={result.correct ? 'font-semibold text-green-700' : 'font-semibold text-red-600'}>
                {result.correct ? 'Correct' : `It was ${result.correctAnswer}`}
              </p>
              <button
                onClick={nextRound}
                disabled={busy}
                className="rounded-xl px-8 py-3 font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: accent }}
              >
                Next card
              </button>
            </div>
          )}
        </div>
      )}

      {phase === 'leaderboard' && (
        <div className="flex flex-1 flex-col">
          <h1 className="mb-4 text-xl font-bold">{shop?.display_name} leaderboard</h1>
          <ol className="mb-6 divide-y">
            {board.length === 0 && <li className="py-3 text-sm text-neutral-500">No scores yet. Be first.</li>}
            {board.map((row, i) => (
              <li key={row.displayName + i} className="flex items-center justify-between py-2 text-sm">
                <span>
                  {i + 1}. {row.displayName}
                </span>
                <span className="tabular-nums text-neutral-500">
                  {row.correct}/{row.answered}
                </span>
              </li>
            ))}
          </ol>

          <div className="mt-auto">
            <label className="mb-1 block text-sm text-neutral-500">Your name on the board</label>
            <div className="flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={24}
                placeholder="Ash"
                className="flex-1 rounded-xl border px-3 py-2 text-sm"
              />
              <button
                onClick={claimName}
                disabled={busy || !name.trim()}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: accent }}
              >
                Save
              </button>
            </div>
            <button
              onClick={() => (phase === 'leaderboard' && question ? setPhase('feedback') : setPhase('idle'))}
              className="mt-4 w-full rounded-xl border px-4 py-2 text-sm text-neutral-600"
            >
              Back to game
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-8 text-center text-neutral-500">
      {children}
    </main>
  );
}
