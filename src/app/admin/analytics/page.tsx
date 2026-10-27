'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowUpRight, BarChart3, Radio } from 'lucide-react';
import { AdminShell } from '@/components/AdminShell';
import { Badge, EmptyState, Panel, SectionHead } from '@/components/ui/Panel';
import { LinkButton } from '@/components/ui/Button';
import { Loading, StatusPill } from '@/components/ui/Pills';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api';
import type { AdminExamRow } from '@shared/types';

export default function AnalyticsIndexPage() {
  const { push } = useToast();
  const [exams, setExams] = useState<AdminExamRow[] | null>(null);

  useEffect(() => {
    api<{ exams: AdminExamRow[] }>('/exams')
      .then((res) => setExams(res.exams))
      .catch((err: Error) => push({ kind: 'error', title: 'Could not load analytics', body: err.message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AdminShell
      title="Analytics"
      subtitle="Per-session accuracy, latency and question-level diagnostics"
      action={
        <LinkButton href="/admin/exams" variant="secondary" size="sm">
          <Radio className="h-3.5 w-3.5" /> Sessions
        </LinkButton>
      }
    >
      {!exams ? (
        <Panel className="p-6">
          <Loading label="Loading reports" />
        </Panel>
      ) : exams.length === 0 ? (
        <EmptyState
          icon={<BarChart3 className="h-5 w-5" />}
          title="No reports yet"
          body="Analytics unlock as soon as a session captures its first response."
        />
      ) : (
        <div className="space-y-4">
          <SectionHead
            eyebrow="Reports"
            title="Pick a session"
            sub="Live sessions update in near real time; ended sessions are frozen snapshots."
          />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {exams.map((exam) => (
              <Link
                key={exam.id}
                href={`/admin/analytics/${exam.id}`}
                className="panel group p-5 transition hover:border-aurora-400/30 hover:bg-white/[0.045]"
              >
                <div className="flex items-start justify-between gap-2">
                  <StatusPill status={exam.status} />
                  <ArrowUpRight className="h-4 w-4 text-white/20 transition group-hover:text-lime-300" />
                </div>
                <h3 className="mt-3 line-clamp-2 text-[14px] font-semibold text-white">{exam.title}</h3>
                <p className="mt-1 text-[11.5px] text-white/35">{exam.subject}</p>
                <div className="mt-4 flex items-center gap-2">
                  <Badge tone="violet">{exam.questionIds.length} Q</Badge>
                  <Badge tone="mint">{exam.participation} students</Badge>
                  <span className="num ml-auto text-[12px] text-white/50">{exam.avgScore} avg pts</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </AdminShell>
  );
}
