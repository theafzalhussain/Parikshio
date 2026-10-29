'use client';

import {
  ArrowRight,
  BookOpen,
  Database,
  GraduationCap,
  Inbox,
  Mail,
  Presentation,
  Radio,
  Sparkles,
  UserCheck,
  UserPlus
} from 'lucide-react';
import { Badge, Panel, Stat } from '@/components/ui/Panel';
import { Avatar, Loading } from '@/components/ui/Pills';
import type { OwnerOverview } from '@shared/owner';
import { activityLabel } from './ActivitySection';
import { ago, ErrorNote, roleLabel, useOwnerData, type Navigate } from './common';

export function OverviewSection({ navigate, refreshKey }: { navigate: Navigate; refreshKey: number }) {
  const { data, error, reload } = useOwnerData<OwnerOverview>(`/overview?r=${refreshKey}`);

  if (error && !data) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return <Loading label="Loading the overview" />;

  const attention = [
    data.messages.facultyPending > 0 && {
      key: 'requests',
      text: `${data.messages.facultyPending} faculty access request${data.messages.facultyPending === 1 ? '' : 's'} waiting`,
      action: () => navigate('requests'),
      icon: UserCheck
    },
    data.messages.new > 0 && {
      key: 'messages',
      text: `${data.messages.new} new message${data.messages.new === 1 ? '' : 's'} in the inbox`,
      action: () => navigate('messages'),
      icon: Inbox
    },
    !data.health.email && {
      key: 'email',
      text: 'Email is not set up, so codes, invites and resets cannot be delivered',
      action: () => navigate('settings'),
      icon: Mail
    }
  ].filter(Boolean) as { key: string; text: string; action: () => void; icon: typeof Inbox }[];

  return (
    <div className="space-y-6">
      {attention.length > 0 && (
        <div className="space-y-2">
          {attention.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={item.action}
              className="focus-ring group flex w-full items-center gap-3 rounded-2xl border border-gold-300/25 bg-gold-400/[0.07] px-4 py-3 text-left text-[14px] text-gold-100 transition hover:border-gold-300/45 hover:bg-gold-400/[0.11]"
            >
              <item.icon className="h-4 w-4 shrink-0 text-gold-300" />
              <span className="min-w-0 flex-1">{item.text}</span>
              <ArrowRight className="h-4 w-4 shrink-0 transition group-hover:translate-x-0.5" />
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Students" value={data.users.students} hint={`${data.users.newThisWeek} joined this week`} tone="sky" icon={<GraduationCap className="h-3.5 w-3.5" />} />
        <Stat label="Faculty" value={data.users.faculty} hint={`${data.users.activeThisWeek} people active this week`} tone="gold" icon={<Presentation className="h-3.5 w-3.5" />} />
        <Stat label="Live now" value={data.exams.live} hint={`${data.exams.total} sessions in total`} tone="royal" icon={<Radio className="h-3.5 w-3.5" />} />
        <Stat label="Answers today" value={data.content.responsesToday} hint={`${data.content.responses} answers overall`} tone="mint" icon={<Sparkles className="h-3.5 w-3.5" />} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <MiniStat label="Questions in the bank" value={data.content.questions} icon={BookOpen} />
        <MiniStat label="Messages received" value={data.messages.total} icon={Inbox} />
        <MiniStat label="Suspended accounts" value={data.users.suspended} icon={UserPlus} />
      </div>

      <Panel className="p-5 sm:p-6">
        <p className="eyebrow">System health</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone={data.health.mongo ? 'mint' : 'ember'} dot>
            <Database className="h-3 w-3" /> Database {data.health.mongo ? 'connected' : 'not connected'}
          </Badge>
          <Badge tone={data.health.email ? 'mint' : 'ember'} dot>
            <Mail className="h-3 w-3" /> Email {data.health.email ? 'on' : 'off'}
          </Badge>
          <Badge tone={data.health.ai ? 'mint' : 'neutral'} dot>
            <Sparkles className="h-3 w-3" /> AI grading {data.health.ai ? 'on' : 'off'}
          </Badge>
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
        <Panel className="p-5 sm:p-6">
          <ListHead title="Newest accounts" action={() => navigate('users')} actionLabel="All users" />
          <ul className="mt-3 divide-y divide-white/[0.06]">
            {data.recentUsers.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => navigate('users', { userId: u.id })}
                  className="focus-ring flex w-full items-center gap-3 rounded-xl px-1 py-3 text-left transition hover:bg-white/[0.03]"
                >
                  <Avatar name={u.name} size={34} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-white">{u.name}</span>
                    <span className="block truncate text-[12.5px] text-white/50">{u.email}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={u.role === 'admin' ? 'gold' : 'neutral'}>{roleLabel(u.role)}</Badge>
                    <span className="text-[11.5px] text-white/40">{ago(u.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
            {!data.recentUsers.length && <li className="py-6 text-center text-[13.5px] text-white/45">No accounts yet.</li>}
          </ul>
        </Panel>

        <Panel className="p-5 sm:p-6">
          <ListHead title="Latest messages" action={() => navigate('messages')} actionLabel="Inbox" />
          <ul className="mt-3 divide-y divide-white/[0.06]">
            {data.recentMessages.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => navigate(m.topic === 'faculty' ? 'requests' : 'messages', { messageId: m.id })}
                  className="focus-ring flex w-full flex-col gap-1 rounded-xl px-1 py-3 text-left transition hover:bg-white/[0.03]"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={m.topic === 'faculty' ? 'gold' : m.topic === 'problem' ? 'ember' : 'royal'}>{m.topicLabel}</Badge>
                    {m.status === 'new' && <Badge tone="mint">new</Badge>}
                    <span className="ml-auto text-[11.5px] text-white/40">{ago(m.createdAt)}</span>
                  </span>
                  <span className="truncate text-[14px] font-medium text-white">{m.name}</span>
                  <span className="line-clamp-2 text-[13px] leading-relaxed text-white/55">{m.message}</span>
                </button>
              </li>
            ))}
            {!data.recentMessages.length && <li className="py-6 text-center text-[13.5px] text-white/45">No messages yet.</li>}
          </ul>
        </Panel>
      </div>

      <Panel className="p-5 sm:p-6">
        <ListHead title="Recent activity" action={() => navigate('activity')} actionLabel="Full log" />
        <ul className="mt-3 divide-y divide-white/[0.06]">
          {data.recentActivity.map((a) => (
            <li key={a.id} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:gap-4">
              <span className="w-28 shrink-0 text-[12px] text-white/40">{ago(a.at)}</span>
              <span className="min-w-0 flex-1 text-[13.5px] text-white/80">
                <span className="font-medium text-white">{activityLabel(a.action)}</span>
                <span className="text-white/45"> · {a.actorName}</span>
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function MiniStat({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Inbox }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-3.5">
      <Icon className="h-4 w-4 shrink-0 text-gold-300/80" />
      <span className="min-w-0 flex-1 text-[13px] text-white/60">{label}</span>
      <span className="num text-[18px] font-semibold text-white">{value}</span>
    </div>
  );
}

function ListHead({ title, action, actionLabel }: { title: string; action: () => void; actionLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="font-display text-[19px] font-medium text-white">{title}</h2>
      <button
        type="button"
        onClick={action}
        className="focus-ring inline-flex items-center gap-1 rounded-lg text-[13px] font-medium text-gold-200 hover:text-gold-100"
      >
        {actionLabel} <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
