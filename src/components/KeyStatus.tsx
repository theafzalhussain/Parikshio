'use client';

import { AlertTriangle, Check, Sparkles, UserCheck } from 'lucide-react';
import type { KeyStatus } from '@shared/grade';
import type { QuestionType } from '@shared/types';
import { Badge } from './ui/Panel';

/** One badge per grading state (see `answerKeyStatus` in shared/grade.ts). */
export function KeyStatusBadge({ status }: { status: KeyStatus }) {
  if (status === 'missing') {
    return (
      <Badge tone="amber">
        <AlertTriangle className="h-3 w-3" /> key missing
      </Badge>
    );
  }
  if (status === 'ai') {
    return (
      <span title="No model answer: the AI evaluator marks it from the question">
        <Badge tone="royal">
          <Sparkles className="h-3 w-3" /> AI grades
        </Badge>
      </span>
    );
  }
  if (status === 'manual') {
    return (
      <span title="No model answer and AI grading is off: a teacher marks it">
        <Badge tone="neutral">
          <UserCheck className="h-3 w-3" /> manual review
        </Badge>
      </span>
    );
  }
  return (
    <Badge tone="mint">
      <Check className="h-3 w-3" /> ready
    </Badge>
  );
}

/** Label for the answer row under a fill / short / long question. */
export function answerRowLabel(type: QuestionType): string {
  return type === 'fill' ? 'accepted' : 'model answer';
}

/** What an empty answer row means for this question. */
export function emptyAnswerHint(type: QuestionType, status: KeyStatus): string {
  if (type === 'fill') return 'none · add the answer (fill in the blank is graded by key only)';
  if (status === 'ai') return 'none · AI grades from the question';
  if (status === 'manual') return 'none · a teacher marks it';
  return 'none · add a model answer (AI grading is off)';
}
