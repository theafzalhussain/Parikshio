/**
 * Levels and badges on the student dashboard. Everything here is derived from
 * the student's real, graded answers (GET /api/student/history and
 * /api/student/insights), so nothing extra is stored and the numbers always
 * match what faculty see.
 */

export interface LevelStep {
  level: number;
  name: string;
  /** Points needed to reach this level. */
  at: number;
}

export const LEVELS: LevelStep[] = [
  { level: 1, name: 'Starter', at: 0 },
  { level: 2, name: 'Learner', at: 25 },
  { level: 3, name: 'Explorer', at: 75 },
  { level: 4, name: 'Achiever', at: 150 },
  { level: 5, name: 'Scholar', at: 300 },
  { level: 6, name: 'Expert', at: 500 },
  { level: 7, name: 'Master', at: 800 },
  { level: 8, name: 'Legend', at: 1200 }
];

export interface LevelInfo extends LevelStep {
  next: LevelStep | null;
  /** 0–1 progress from this level to the next (1 at the top level). */
  progress: number;
  /** Points still needed for the next level. */
  toNext: number;
}

export function levelFor(points: number): LevelInfo {
  const safe = Number.isFinite(points) && points > 0 ? points : 0;
  let index = 0;
  for (let i = 0; i < LEVELS.length; i++) if (safe >= LEVELS[i]!.at) index = i;
  const current = LEVELS[index]!;
  const next = LEVELS[index + 1] ?? null;
  if (!next) return { ...current, next: null, progress: 1, toNext: 0 };
  const span = next.at - current.at;
  return {
    ...current,
    next,
    progress: Math.min(1, Math.max(0, (safe - current.at) / span)),
    toNext: Math.max(0, Math.ceil(next.at - safe))
  };
}

export interface ProgressInput {
  answered: number;
  /** Answers with a final grade (not awaiting review). */
  graded: number;
  /** 0–100, over graded answers. */
  accuracy: number;
  bestStreak: number;
  avgLatencyMs: number;
  sessions: number;
  /** Best leaderboard rank in any session, or null when never ranked. */
  bestRank: number | null;
  points: number;
  /** Distinct question formats answered (MCQ, true/false, fill, short, long). */
  formats: number;
}

export type BadgeId = 'first' | 'streak' | 'sharp' | 'quick' | 'regular' | 'podium' | 'century' | 'allrounder';

export interface BadgeState {
  id: BadgeId;
  name: string;
  /** How to earn it, shown on the back of the badge. */
  goal: string;
  earned: boolean;
  /** 0–1 towards earning it. */
  progress: number;
  /** Short progress text, e.g. "4 / 10 answers". */
  status: string;
}

const pct = (value: number, target: number) => (target > 0 ? Math.min(1, Math.max(0, value / target)) : 0);

export function badgesFor(p: ProgressInput): BadgeState[] {
  const quickTarget = 15_000;
  const sharp =
    p.graded < 10
      ? { progress: pct(p.graded, 10) * 0.5, status: `${p.graded} / 10 graded answers` }
      : { progress: 0.5 + pct(p.accuracy, 80) * 0.5, status: `${p.accuracy}% accuracy` };
  const quick =
    p.answered < 5
      ? { progress: pct(p.answered, 5) * 0.5, status: `${p.answered} / 5 answers` }
      : {
          progress: 0.5 + Math.min(1, quickTarget / Math.max(p.avgLatencyMs, 1)) * 0.5,
          status: `avg ${(p.avgLatencyMs / 1000).toFixed(1)}s per answer`
        };

  return [
    {
      id: 'first',
      name: 'First steps',
      goal: 'Answer your first question in a live session.',
      earned: p.answered >= 1,
      progress: pct(p.answered, 1),
      status: p.answered >= 1 ? 'Earned' : 'Not started yet'
    },
    {
      id: 'streak',
      name: 'On a roll',
      goal: 'Get 3 answers right in a row.',
      earned: p.bestStreak >= 3,
      progress: pct(p.bestStreak, 3),
      status: `Best streak ${p.bestStreak}`
    },
    {
      id: 'sharp',
      name: 'Sharpshooter',
      goal: 'Reach 80% accuracy across at least 10 graded answers.',
      earned: p.graded >= 10 && p.accuracy >= 80,
      ...sharp
    },
    {
      id: 'quick',
      name: 'Quick thinker',
      goal: 'Average 15 seconds or less per answer, over at least 5 answers.',
      earned: p.answered >= 5 && p.avgLatencyMs > 0 && p.avgLatencyMs <= quickTarget,
      ...quick
    },
    {
      id: 'regular',
      name: 'Regular',
      goal: 'Take part in 3 sessions.',
      earned: p.sessions >= 3,
      progress: pct(p.sessions, 3),
      status: `${p.sessions} / 3 sessions`
    },
    {
      id: 'podium',
      name: 'Podium',
      goal: 'Finish in the top 3 of a session leaderboard.',
      earned: p.bestRank !== null && p.bestRank <= 3,
      progress: p.bestRank === null ? 0 : Math.min(1, 3 / p.bestRank),
      status: p.bestRank === null ? 'Not ranked yet' : `Best rank #${p.bestRank}`
    },
    {
      id: 'century',
      name: 'Century',
      goal: 'Score 100 points in total.',
      earned: p.points >= 100,
      progress: pct(p.points, 100),
      status: `${Math.round(p.points)} / 100 points`
    },
    {
      id: 'allrounder',
      name: 'All-rounder',
      goal: 'Answer 3 different question formats.',
      earned: p.formats >= 3,
      progress: pct(p.formats, 3),
      status: `${p.formats} / 3 formats`
    }
  ];
}

/** "Good morning" and friends, from the device's own clock. */
export function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  if (hour >= 17 && hour < 22) return 'Good evening';
  return 'Hello';
}
