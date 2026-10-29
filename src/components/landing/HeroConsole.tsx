'use client';

import { useEffect, useState } from 'react';
import { Check, Radio, Trophy, Zap } from 'lucide-react';
import { RadialTimer } from '@/components/charts/Charts';
import { Badge } from '@/components/ui/Panel';
import { Avatar } from '@/components/ui/Pills';
import { cx } from '@/lib/api';

const options = [
  'Eₙ = n²π²ħ² / 2mL²',
  'Eₙ = nπħ / 2mL',
  'Eₙ = n²ħ² / 2mL',
  'Eₙ = nħω / 2'
];

const board = [
  { name: 'Ananya Rao', points: 20 },
  { name: 'Aarav Mehta', points: 20 },
  { name: 'Zoya Khan', points: 15 }
];

export function HeroConsole() {
  const [seconds, setSeconds] = useState(34);
  const [selected, setSelected] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [rank, setRank] = useState(3);

  useEffect(() => {
    const id = window.setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          setSubmitted(false);
          setSelected(0);
          return 45;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setSubmitted(true);
      setRank(2);
    }, 5200);
    return () => window.clearTimeout(id);
  }, [seconds === 45]);

  return (
    <div className="relative">
      {/* Soft halo behind the device. */}
      <div className="absolute -inset-8 -z-10 rounded-[3rem] bg-[radial-gradient(closest-side,rgba(98,121,245,0.28),rgba(223,184,115,0.08)_60%,transparent)]" />

      <div className="panel gold-edge sheen overflow-hidden">
        {/* console chrome */}
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] bg-white/[0.025] px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex gap-1.5" aria-hidden="true">
              <i className="h-2.5 w-2.5 rounded-full bg-white/15" />
              <i className="h-2.5 w-2.5 rounded-full bg-white/15" />
              <i className="h-2.5 w-2.5 rounded-full bg-gold-300/80" />
            </span>
            <span className="ml-1 rounded-md bg-white/[0.06] px-2 py-0.5 font-mono text-[11px] tracking-wider text-white/65">
              LIVE · QM4LIVE
            </span>
          </div>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-200">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold-300 opacity-80" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-gold-300" />
            </span>
            in session
          </span>
        </div>

        <div className="grid gap-5 p-5 sm:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge tone="royal">MCQ</Badge>
              <Badge tone="neutral">Quantum mechanics</Badge>
              <span className="num text-[12px] text-white/50">Q 3 / 6 · 10 pts</span>
            </div>
            <p className="font-display text-[17px] leading-relaxed text-white/95">
              A particle is confined to an infinite potential well of width L. Which expression gives the energy of the
              n-th stationary state?
            </p>
            <div className="mt-4 space-y-2">
              {options.map((opt, i) => {
                const active = selected === i;
                const correct = submitted && i === 0;
                const wrong = submitted && active && i !== 0;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setSelected(i)}
                    className={cx(
                      'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition duration-200',
                      correct
                        ? 'border-mint-400/50 bg-mint-500/10'
                        : wrong
                          ? 'border-ember-500/40 bg-ember-500/10'
                          : active
                            ? 'border-royal-400/55 bg-royal-500/[0.12]'
                            : 'border-white/[0.08] bg-white/[0.02] hover:border-white/20'
                    )}
                  >
                    <span
                      className={cx(
                        'grid h-6 w-6 shrink-0 place-items-center rounded-lg border text-[11px] font-semibold',
                        correct
                          ? 'border-transparent bg-mint-500 text-ink-950'
                          : active
                            ? 'border-transparent bg-royal-500 text-white'
                            : 'border-white/15 text-white/55'
                      )}
                    >
                      {correct ? <Check className="h-3.5 w-3.5" /> : String.fromCharCode(65 + i)}
                    </span>
                    <span className="truncate font-mono text-[13px] text-white/85">{opt}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3.5 flex items-center gap-2 text-[12px] text-white/50">
              <Zap className="h-3.5 w-3.5 text-gold-300" />
              Stored with a server timestamp · graded instantly · rank #{rank}
            </p>
          </div>

          <div className="flex flex-col items-center gap-3 sm:w-[176px]">
            <RadialTimer remaining={seconds * 1000} total={45_000} size={156} urgent={seconds < 12} />
            <div className="w-full rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3">
              <p className="mb-2 flex items-center justify-between text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/55">
                live board
                <Trophy className="h-3.5 w-3.5 text-gold-300" />
              </p>
              {board.map((row, i) => (
                <div key={row.name} className="flex items-center gap-2 py-1">
                  <span className={cx('num w-3 text-[11px]', i === 0 ? 'text-gold-200' : 'text-white/50')}>{i + 1}</span>
                  <Avatar name={row.name} size={20} />
                  <span className="flex-1 truncate text-[12px] text-white/80">{row.name.split(' ')[0]}</span>
                  <span className="num text-[12px] font-semibold text-white">{row.points}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/*
        Floating accent chips. They hang off the panel's outer edges — anchored
        inside the panel they covered the question text and the live board.
      */}
      <div className="absolute -top-3 left-6 hidden -translate-y-full animate-floaty rounded-2xl border border-gold-200/20 bg-ink-850/90 px-3.5 py-2.5 shadow-lift backdrop-blur-xl lg:block">
        <p className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.16em] text-white/55">
          <Radio className="h-3 w-3 text-gold-300" /> server clock
        </p>
        <p className="mt-1 font-display text-[19px] font-medium text-gold-200">Every screen in sync</p>
      </div>
      <div className="absolute -bottom-3 right-6 hidden translate-y-full animate-floaty rounded-2xl border border-white/10 bg-ink-850/90 px-3.5 py-2.5 shadow-lift backdrop-blur-xl [animation-delay:1.6s] lg:block">
        <p className="text-[10.5px] uppercase tracking-[0.16em] text-white/55">auto-graded</p>
        <p className="mt-1 font-display text-[19px] font-medium text-white">The moment it lands</p>
      </div>
    </div>
  );
}
