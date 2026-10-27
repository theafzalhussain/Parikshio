'use client';

import { AlertTriangle, Bot, KeyRound, Loader2, RotateCw, ShieldAlert, Sparkles, UserCheck } from 'lucide-react';
import type { AiEvaluation, GradingMode, GradingStatus, Response } from '@shared/types';
import { cx, fmtMs } from '@/lib/api';
import { Badge } from './ui/Panel';
import { Button } from './ui/Button';

export const isAiBusy = (ai?: AiEvaluation) => ai?.status === 'queued' || ai?.status === 'running';

/** Compact status chip for one response row in the live feed. */
export function AiStatusChip({ ai }: { ai?: AiEvaluation }) {
  if (!ai) return null;
  if (isAiBusy(ai))
    return (
      <Badge tone="sky" className="normal-case tracking-normal">
        <Loader2 className="h-3 w-3 animate-spin" />
        {ai.status === 'queued' ? 'AI queued' : 'AI grading'}
      </Badge>
    );
  if (ai.status === 'failed')
    return (
      <Badge tone="ember" className="normal-case tracking-normal">
        <AlertTriangle className="h-3 w-3" />
        AI failed
      </Badge>
    );
  return (
    <Badge tone={ai.needsReview ? 'amber' : 'violet'} className="normal-case tracking-normal">
      {ai.needsReview ? <ShieldAlert className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
      AI {Math.round((ai.confidence ?? 0) * 100)}%{ai.needsReview ? ' · check' : ''}
    </Badge>
  );
}

const MODE_META: Record<GradingMode, { label: string; icon: typeof Bot }> = {
  key: { label: 'answer key', icon: KeyRound },
  ai: { label: 'AI evaluator', icon: Bot },
  manual: { label: 'faculty', icon: UserCheck }
};

export function GradedByTag({ mode }: { mode?: GradingMode }) {
  if (!mode) return <span className="text-[11px] text-white/35">not graded yet</span>;
  const meta = MODE_META[mode];
  const Icon = meta.icon;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-white/55">
      <Icon className="h-3 w-3" /> graded by {meta.label}
    </span>
  );
}

/** Engine badge for page headers — shows whether subjective answers are AI-graded. */
export function AiEngineBadge({ status, busy }: { status: GradingStatus | null; busy?: number }) {
  if (!status) return null;
  if (!status.ai.enabled)
    return (
      <Badge tone="neutral" className="normal-case tracking-normal">
        <Bot className="h-3 w-3" /> AI grader off
      </Badge>
    );
  const inFlight = busy ?? status.ai.queued + status.ai.running;
  if (status.ai.quotaExhausted && inFlight === 0)
    return (
      <Badge tone="amber" className="normal-case tracking-normal">
        <AlertTriangle className="h-3 w-3" /> AI quota used up
      </Badge>
    );
  return (
    <Badge tone="violet" className="normal-case tracking-normal">
      {inFlight > 0 ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
      AI grader {inFlight > 0 ? `· ${inFlight} in queue` : status.ai.autoGrade ? '· auto' : '· on demand'}
    </Badge>
  );
}

/**
 * Full AI evaluation readout inside the scoring modal: verdict, score,
 * confidence, feedback, strengths and gaps — plus accept / re-run actions.
 */
export function AiEvaluationCard({
  response,
  aiEnabled,
  onAccept,
  onRerun,
  rerunning
}: {
  response: Pick<Response, 'ai' | 'gradedBy'> & { maxPoints: number };
  aiEnabled: boolean;
  onAccept: (score: number) => void;
  onRerun: () => void;
  rerunning: boolean;
}) {
  const ai = response.ai;

  if (!ai) {
    if (!aiEnabled) return null;
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-white/10 p-3">
        <p className="text-[12px] text-white/45">No AI evaluation for this answer yet.</p>
        <Button size="sm" variant="outline" onClick={onRerun} loading={rerunning}>
          <Sparkles className="h-3.5 w-3.5" /> Evaluate with AI
        </Button>
      </div>
    );
  }

  if (isAiBusy(ai))
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-sky-400/20 bg-sky-400/[0.05] p-3 text-[12px] text-sky-200">
        <Loader2 className="h-4 w-4 animate-spin" />
        {ai.status === 'queued' ? 'Queued for AI evaluation…' : 'AI is evaluating this answer…'}
        <span className="ml-auto text-[11px] text-white/35">the score appears here automatically</span>
      </div>
    );

  if (ai.status === 'failed')
    return (
      <div className="space-y-2 rounded-xl border border-ember-500/30 bg-ember-500/[0.06] p-3">
        <p className="flex items-center gap-1.5 text-[12px] font-medium text-ember-400">
          <AlertTriangle className="h-3.5 w-3.5" /> AI evaluation failed
        </p>
        <p className="break-words text-[11.5px] leading-relaxed text-white/50">{ai.error ?? 'Unknown error'}</p>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-white/35">Score it by hand below, or try again.</span>
          {aiEnabled && (
            <Button size="sm" variant="secondary" onClick={onRerun} loading={rerunning}>
              <RotateCw className="h-3.5 w-3.5" /> Retry AI
            </Button>
          )}
        </div>
      </div>
    );

  const score = ai.score ?? 0;
  const pct = ai.maxPoints > 0 ? Math.round((score / ai.maxPoints) * 100) : 0;
  return (
    <div className="space-y-3 rounded-xl border border-aurora-400/25 bg-aurora-500/[0.06] p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-aurora-100">
          <Sparkles className="h-3.5 w-3.5" /> AI evaluation
        </span>
        <Badge tone={ai.verdict === 'correct' ? 'mint' : ai.verdict === 'partial' ? 'amber' : 'ember'}>{ai.verdict}</Badge>
        <span className="num ml-auto text-[15px] font-semibold text-white">
          {score}
          <span className="text-white/35">/{ai.maxPoints}</span>
        </span>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
        <div
          className={cx('h-full rounded-full', pct >= 100 ? 'bg-mint-400' : pct > 0 ? 'bg-amber-300' : 'bg-ember-500')}
          style={{ width: `${Math.max(3, pct)}%` }}
        />
      </div>

      {ai.needsReview && (
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-400/10 px-2.5 py-1.5 text-[11.5px] text-amber-200">
          <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0" />
          Flagged for a human check — low confidence or the answer tries to instruct the grader.
        </p>
      )}

      <p className="text-[12.5px] leading-relaxed text-white/80">{ai.feedback}</p>

      {!!(ai.strengths?.length || ai.improvements?.length) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {!!ai.strengths?.length && (
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-mint-300/70">earned marks</p>
              <ul className="space-y-1 text-[11.5px] text-white/60">
                {ai.strengths.map((s) => (
                  <li key={s} className="flex gap-1.5">
                    <span className="text-mint-300">+</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!!ai.improvements?.length && (
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-amber-300/70">lost marks</p>
              <ul className="space-y-1 text-[11.5px] text-white/60">
                {ai.improvements.map((s) => (
                  <li key={s} className="flex gap-1.5">
                    <span className="text-amber-300">−</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-2.5">
        <span className="text-[10.5px] text-white/35">
          {ai.model} · confidence {Math.round((ai.confidence ?? 0) * 100)}%
          {ai.latencyMs ? ` · ${fmtMs(ai.latencyMs)}` : ''}
          {response.gradedBy === 'manual' ? ' · overridden by faculty' : ''}
        </span>
        <div className="ml-auto flex gap-1.5">
          {aiEnabled && (
            <Button size="sm" variant="ghost" onClick={onRerun} loading={rerunning}>
              <RotateCw className="h-3.5 w-3.5" /> Re-run
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => onAccept(score)}>
            Use AI score
          </Button>
        </div>
      </div>
    </div>
  );
}
