import { PublicPage } from './PublicPage';

export interface LegalSection {
  id: string;
  title: string;
  body: React.ReactNode;
}

/** Readable long-form text: spaced paragraphs, real bullets, gold links. */
const prose =
  'space-y-3.5 text-[15px] leading-[1.75] text-white/65 ' +
  '[&_strong]:font-semibold [&_strong]:text-white/85 ' +
  '[&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_li]:pl-1 [&_li]:marker:text-gold-300/60 ' +
  '[&_a]:font-medium [&_a]:text-gold-200 [&_a]:underline-offset-4 [&_a:hover]:text-gold-100 [&_a:hover]:underline';

/**
 * Layout for the privacy policy and terms: title block, a sticky table of
 * contents on wide screens, and numbered sections that can be linked to.
 */
export function LegalPage({
  eyebrow,
  title,
  intro,
  updated,
  updatedIso,
  sections
}: {
  eyebrow: string;
  title: string;
  intro: React.ReactNode;
  /** Human date, e.g. "29 October 2026". */
  updated: string;
  updatedIso: string;
  sections: LegalSection[];
}) {
  return (
    <PublicPage>
      <section className="mx-auto max-w-7xl px-5 pb-24 pt-10 sm:px-8 sm:pt-16 lg:pb-28">
        <header className="max-w-3xl animate-fadeUp">
          <p className="eyebrow eyebrow-rule">{eyebrow}</p>
          <h1 className="mt-5 font-display text-[2.5rem] font-normal leading-[1.06] text-white sm:text-[3.3rem]">
            {title}
          </h1>
          <p className="mt-4 text-[13.5px] text-white/45">
            Last updated <time dateTime={updatedIso}>{updated}</time>
          </p>
          <div className="mt-5 max-w-2xl text-[16px] leading-relaxed text-white/60">{intro}</div>
        </header>

        <div className="mt-12 grid gap-10 lg:grid-cols-[15rem_minmax(0,1fr)] xl:gap-14">
          <nav aria-label="On this page" className="lg:sticky lg:top-28 lg:self-start">
            <p className="eyebrow">On this page</p>
            <ol className="mt-4 grid gap-0.5 border-l border-white/[0.08] sm:grid-cols-2 lg:grid-cols-1">
              {sections.map((section, index) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="focus-ring -ml-px block rounded-r-lg border-l border-transparent py-1.5 pl-4 pr-2 text-[13.5px] text-white/55 transition hover:border-gold-300/60 hover:text-white"
                  >
                    <span className="num mr-2 text-white/30">{String(index + 1).padStart(2, '0')}</span>
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <article className="panel px-6 py-8 sm:px-10 sm:py-11">
            <div className="max-w-3xl space-y-11">
              {sections.map((section, index) => (
                <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`}>
                  <h2
                    id={`${section.id}-title`}
                    className="flex items-baseline gap-3 font-display text-[22px] font-medium leading-snug text-white sm:text-[24px]"
                  >
                    <span className="num text-[15px] text-gold-300/70">{String(index + 1).padStart(2, '0')}</span>
                    {section.title}
                  </h2>
                  <div className={`mt-4 ${prose}`}>{section.body}</div>
                </section>
              ))}
            </div>
          </article>
        </div>
      </section>
    </PublicPage>
  );
}
