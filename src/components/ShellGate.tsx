import { LogoMark } from './Logo';

/** Full-screen holding state while a shell verifies the signed-in role. */
export function ShellGate({ label }: { label: string }) {
  return (
    <div className="grid min-h-screen place-items-center px-6">
      <div className="flex flex-col items-center gap-5 text-center">
        <span className="relative grid h-16 w-16 place-items-center">
          <span className="absolute inset-0 animate-spin rounded-full border border-gold-300/15 border-t-gold-300/80" />
          <LogoMark className="h-9 w-9" />
        </span>
        <p className="text-[13.5px] text-white/60" role="status">
          {label}
        </p>
      </div>
    </div>
  );
}
