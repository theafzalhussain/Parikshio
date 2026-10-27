'use client';

import { useEffect, useState } from 'react';
import { Check, Radio, Zap } from 'lucide-react';
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
  { name: 'Ananya Rao', points: 20, ms: '4.2s' },
  { name: 'Aarav Mehta', points: 20, ms: '5.4s' },
  { name: 'Zoya Khan', points: 15, ms: '7.8s' }
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
      <div className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-aurora-600/20 blur-3xl" />
      <div className="panel sheen overflow-hidden">
        {/* console chrome */}
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] bg-white/[0.02] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex gap-1.5">
              <i className="h-2 w-2 rounded-full bg-white/15" />
              <i className="h-2 w-2 rounded-full bg-white/15" />
              <i className="h-2 w-2 rounded-full bg-lime-400/70" />
            </span>
            <span className="ml-1 rounded-md bg-white/[0.05] px-2 py-0.5 font-mono text-[10.5px] tracking-wider text-white/50">
              LIVE · QM4LIVE
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-lime-300">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime-400 opacity-80" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-lime-400" />
              </span>
              socket live
            </span>
          </div>
        </div>

        <div className="grid gap-4 p-4 sm:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <div className="mb-2.5 flex flex-wrap items-center gap-2">
              <Badge tone="violet">MCQ</Badge>
              <Badge tone="neutral">Quantum mechanics</Badge>
              <span className="num text-[11px] text-white/35">Q 3 / 6 · 10 pts</span>
            </div>
            <p className="text-[13.5px] font-medium leading-relaxed text-white/90">
              A particle is confined to an infinite potential well of width L. Which expression gives the energy of the
              n-th stationary state?
            </p>
            <div className="mt-3.5 space-y-2">
              {options.map((opt, i) => {
                const active = selected === i;
                const correct = submitted && i === 0;
                const wrong = submitted && active && i !== 0;
                return (
                  <button
                    key={opt}
                    onClick={() => setSelected(i)}
                    className={cx(
                      'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition',
                      correct
                        ? 'border-mint-400/50 bg-mint-500/10'
                        : wrong
                          ? 'border-ember-500/40 bg-ember-500/10'
                          : active
                            ? 'border-aurora-400/50 bg-aurora-500/10'
                            : 'border-white/[0.08] bg-white/[0.02] hover:border-white/20'
                    )}
                  >
                    <span
                      className={cx(
                        'grid h-5 w-5 shrink-0 place-items-center rounded-md border text-[10px] font-semibold',
                        active ? 'border-transparent bg-aurora-500 text-white' : 'border-white/15 text-white/40'
                      )}
                    >
                      {correct ? <Check className="h-3 w-3" /> : String.fromCharCode(65 + i)}
                    </span>
                    <span className="truncate font-mono text-[12px] text-white/75">{opt}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex items-center gap-2 text-[10.5px] text-white/30">
              <Zap className="h-3 w-3 text-lime-400" />
              answer stored with server timestamp · graded in &lt; 2 ms at {rank}
              <span className="sr-only">rank</span>
            </div>
          </div>

          <div className="flex flex-col items-center gap-3 sm:w-[168px]">
            <RadialTimer remaining={seconds * 1000} total={45_000} size={152} urgent={seconds < 12} />
            <div className="w-full rounded-xl border border-white/[0.07] bg-white/[0.02] p-2.5">
              <p className="mb-1.5 flex items-center justify-between text-[9.5px] font-semibold uppercase tracking-[0.14em] text-white/35">
                live board
                <Radio className="h-3 w-3 text-lime-400" />
              </p>
              {board.map((row, i) => (
                <div key={row.name} className="flex items-center gap-2 py-1">
                  <span className="num w-3 text-[10px] text-white/35">{i + 1}</span>
                  <Avatar name={row.name} size={18} />
                  <span className="flex-1 truncate text-[10.5px] text-white/65">{row.name.split(' ')[0]}</span>
                  <span className="num text-[10.5px] font-semibold text-white/80">{row.points}</span>
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
      <div className="absolute -top-3 left-6 hidden -translate-y-full animate-floaty rounded-2xl border border-white/10 bg-ink-850/90 px-3 py-2 shadow-lift backdrop-blur-xl lg:block">
        <p className="text-[9.5px] uppercase tracking-[0.16em] text-white/35">push latency</p>
        <p className="num mt-0.5 text-[15px] font-semibold text-lime-300">38 ms</p>
      </div>
      <div className="absolute -bottom-3 right-6 hidden translate-y-full animate-floaty rounded-2xl border border-white/10 bg-ink-850/90 px-3 py-2 shadow-lift backdrop-blur-xl [animation-delay:1.6s] lg:block">
        <p className="text-[9.5px] uppercase tracking-[0.16em] text-white/35">auto-graded</p>
        <p className="num mt-0.5 text-[15px] font-semibold text-white">
          1,284 <span className="text-[11px] text-white/35">resp</span>
        </p>
      </div>
    </div>
  );
}
