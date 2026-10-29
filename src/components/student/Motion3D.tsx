'use client';

import { useEffect, useRef, useState } from 'react';
import { Atom, CodeXml, FlaskConical, Globe, Languages, Pi } from 'lucide-react';
import { cx } from '@/lib/api';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Tilts its children towards the pointer in 3D, with a soft light that follows
 * the cursor. Children can rise out of the surface with `depth-sm|md|lg`.
 *
 * Runs only for a mouse or trackpad, and never for people who prefer reduced
 * motion; touch screens get the static card. The motion is eased in a
 * requestAnimationFrame loop that stops as soon as it settles, so an idle
 * dashboard costs nothing.
 */
export function Tilt3D({
  children,
  className,
  max = 8,
  lift = 1.015,
  glare = true
}: {
  children: React.ReactNode;
  className?: string;
  /** Largest tilt in degrees. */
  max?: number;
  /** Scale while hovered. */
  lift?: number;
  glare?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion() || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    const target = { rx: 0, ry: 0, s: 1, g: 0 };
    const current = { rx: 0, ry: 0, s: 1, g: 0 };
    let frame = 0;

    const apply = () => {
      el.style.setProperty('--rx', `${current.rx.toFixed(2)}deg`);
      el.style.setProperty('--ry', `${current.ry.toFixed(2)}deg`);
      el.style.setProperty('--ts', current.s.toFixed(4));
      el.style.setProperty('--glare', current.g.toFixed(3));
    };
    const step = () => {
      let moving = false;
      for (const key of ['rx', 'ry', 's', 'g'] as const) {
        const delta = target[key] - current[key];
        if (Math.abs(delta) > 0.0005) {
          current[key] += delta * 0.14;
          moving = true;
        } else current[key] = target[key];
      }
      apply();
      frame = moving ? window.requestAnimationFrame(step) : 0;
    };
    const run = () => {
      if (!frame) frame = window.requestAnimationFrame(step);
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
      const rect = el.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
      target.rx = (0.5 - y) * max * 2;
      target.ry = (x - 0.5) * max * 2;
      target.s = lift;
      target.g = 1;
      el.style.setProperty('--gx', `${(x * 100).toFixed(1)}%`);
      el.style.setProperty('--gy', `${(y * 100).toFixed(1)}%`);
      run();
    };
    const onLeave = () => {
      target.rx = 0;
      target.ry = 0;
      target.s = 1;
      target.g = 0;
      run();
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [max, lift]);

  return (
    <div ref={ref} className={cx('tilt-3d', className)}>
      {children}
      {glare && <span aria-hidden="true" className="tilt-glare" />}
    </div>
  );
}

/**
 * Counts up to `value` when it first appears or changes. Screen readers get the
 * final number only, never the ticking one.
 */
export function CountUp({
  value,
  prefix = '',
  suffix = '',
  duration = 1100
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
}) {
  const decimals = Number.isInteger(value) ? 0 : 1;
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(a + (value - a) * eased);
      if (k < 1) frame = window.requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [value, duration]);

  const text = (n: number) => `${prefix}${n.toFixed(decimals)}${suffix}`;
  return (
    <>
      <span className="sr-only">{text(value)}</span>
      <span aria-hidden="true">{text(shown)}</span>
    </>
  );
}

/* Class names are written out in full: Tailwind keeps a custom class only when
   it finds the literal name in the source, so `cube-face-${i}` would be dropped
   and all six faces would stack flat. */
const CUBE_FACES = [
  { icon: Pi, label: 'Maths', className: 'cube-face cube-face-1' },
  { icon: Atom, label: 'Science', className: 'cube-face cube-face-2' },
  { icon: Languages, label: 'Languages', className: 'cube-face cube-face-3' },
  { icon: CodeXml, label: 'Computing', className: 'cube-face cube-face-4' },
  { icon: Globe, label: 'Social studies', className: 'cube-face cube-face-5' },
  { icon: FlaskConical, label: 'Chemistry', className: 'cube-face cube-face-6' }
];

/**
 * A slowly turning glass cube with a subject on every face, floating over a
 * soft shadow. Purely decorative.
 */
export function KnowledgeCube({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cx('cube-float', className)}>
      <div className="cube-scene">
        <div className="cube-3d">
          {CUBE_FACES.map((face) => (
            <div key={face.label} className={face.className}>
              <face.icon className="h-[42%] w-[42%] text-gold-200" strokeWidth={1.6} />
            </div>
          ))}
        </div>
      </div>
      <div className="cube-shadow" />
    </div>
  );
}

/**
 * Runs the CSS animations inside it only while it is on screen. Scrolled past
 * the hero, the cube, floor and chips pause, so a student reading their
 * history on a low-end phone is not paying for motion they cannot see.
 */
export function MotionZone({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        el.dataset.motion = entry?.isIntersecting ? 'running' : 'paused';
      },
      { rootMargin: '80px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} data-motion="running" className={className}>
      {children}
    </div>
  );
}

/** A ruled floor running towards the horizon, behind the dashboard hero. */
export function HorizonGrid({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cx('horizon', className)}>
      <div className="horizon-plane" />
    </div>
  );
}
