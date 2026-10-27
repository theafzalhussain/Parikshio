'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ClipboardPaste,
  FileText,
  FileUp,
  Image as ImageIcon,
  Loader2,
  ScanLine,
  Sparkles,
  Trash2,
  UploadCloud
} from 'lucide-react';
import { AdminShell } from '@/components/AdminShell';
import { Badge, Panel, SectionHead } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Input, Label, TextArea } from '@/components/ui/Field';
import { Loading } from '@/components/ui/Pills';
import { useToast } from '@/components/ui/Toast';
import { api, apiUpload, ApiError, cx, fmtRelative } from '@/lib/api';
import type { Paper } from '@shared/types';

type PaperRow = Paper & { questionCount: number; examTitle: string | null };

/** Shape returned by both `/papers/upload` and `/papers/text`. */
type UploadResult = { paper: Paper; questions: unknown[] };

const ACCEPT = '.pdf,.docx,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff,.txt,.md';

const STEPS = [
  { key: 'read', label: 'Reading file' },
  { key: 'text', label: 'Extracting text' },
  { key: 'parse', label: 'Detecting questions' },
  { key: 'import', label: 'Importing to panel' }
];

const KIND_META: Record<string, { label: string; icon: typeof FileText }> = {
  pdf: { label: 'PDF', icon: FileText },
  docx: { label: 'Word', icon: FileText },
  image: { label: 'Image · OCR', icon: ImageIcon },
  text: { label: 'Text', icon: ClipboardPaste }
};

export default function PapersPage() {
  const router = useRouter();
  const { push } = useToast();
  const [papers, setPapers] = useState<PaperRow[] | null>(null);
  const [tab, setTab] = useState<'file' | 'text'>('file');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [pastedText, setPastedText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<number | null>(null);

  const load = useCallback(() => {
    api<{ papers: PaperRow[] }>('/papers')
      .then((res) => setPapers(res.papers))
      .catch((err: Error) => push({ kind: 'error', title: 'Could not load papers', body: err.message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!busy) {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    setStep(0);
    timerRef.current = window.setInterval(() => {
      setStep((s) => Math.min(STEPS.length - 1, s + 1));
    }, 900);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [busy]);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setWarnings([]);
    setPreview(null);
    const body = new FormData();
    body.append('file', file);
    if (name.trim()) body.append('name', name.trim());
    if (subject.trim()) body.append('subject', subject.trim());
    try {
      const data = await apiUpload<UploadResult>('/papers/upload', body);
      push({
        kind: 'success',
        title: `${data.questions.length} questions extracted`,
        body: 'Every item is now in your panel with its own timer and push button.'
      });
      setName('');
      setSubject('');
      router.push(`/admin/papers/${data.paper.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
      if (err instanceof ApiError) {
        // The extractor explains *why* it failed — surface that, not just the status.
        const detail = err.details ?? {};
        setWarnings(Array.isArray(detail.warnings) ? (detail.warnings as string[]) : []);
        setPreview(typeof detail.previewText === 'string' ? detail.previewText : null);
      }
    } finally {
      setBusy(false);
    }
  }

  async function importText() {
    if (pastedText.trim().length < 20) {
      setError('Paste at least a few lines of questions.');
      return;
    }
    setBusy(true);
    setError(null);
    setWarnings([]);
    try {
      const res = await api<UploadResult>('/papers/text', {
        method: 'POST',
        body: { name: name.trim() || undefined, subject: subject.trim() || undefined, text: pastedText }
      });
      push({
        kind: 'success',
        title: `${res.questions.length} questions extracted`,
        body: 'Imported from pasted text.'
      });
      setPastedText('');
      setName('');
      setSubject('');
      router.push(`/admin/papers/${res.paper.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Import failed');
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(paper: PaperRow) {
    try {
      await api(`/papers/${paper.id}`, { method: 'DELETE' });
      push({ kind: 'success', title: 'Paper removed', body: `${paper.questionCount} questions deleted from the bank.` });
      load();
    } catch (err) {
      push({ kind: 'error', title: 'Cannot delete paper', body: err instanceof ApiError ? err.message : 'Try again' });
    }
  }

  return (
    <AdminShell
      title="Question papers"
      subtitle="Upload a paper → every question is extracted into your panel, ready to time and push"
      action={<Badge tone="lime"><Sparkles className="h-3 w-3" /> AI-style extraction</Badge>}
    >
      <div className="space-y-5">
        <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
          {/* uploader */}
          <Panel className="overflow-hidden">
            <div className="flex items-center gap-1 border-b border-white/[0.07] bg-white/[0.02] px-3 py-2">
              {[
                { key: 'file' as const, label: 'Upload file', icon: FileUp },
                { key: 'text' as const, label: 'Paste text', icon: ClipboardPaste }
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={cx(
                    'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition',
                    tab === t.key ? 'bg-white/[0.08] text-white' : 'text-white/40 hover:text-white/75'
                  )}
                >
                  <t.icon className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              ))}
              <span className="ml-auto text-[10.5px] uppercase tracking-[0.14em] text-white/25">
                max 20 MB
              </span>
            </div>

            <div className="p-4 sm:p-5">
              {tab === 'file' ? (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file && !busy) upload(file);
                  }}
                  onClick={() => !busy && fileRef.current?.click()}
                  className={cx(
                    'relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition',
                    dragging
                      ? 'border-lime-400/60 bg-lime-400/[0.06]'
                      : 'border-white/12 bg-white/[0.015] hover:border-aurora-400/40 hover:bg-white/[0.03]',
                    busy && 'pointer-events-none opacity-70'
                  )}
                >
                  <input
                    ref={fileRef}
                    type="file"
                    accept={ACCEPT}
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) upload(file);
                      e.target.value = '';
                    }}
                  />
                  {busy ? (
                    <>
                      <Loader2 className="h-8 w-8 animate-spin text-lime-300" />
                      <p className="mt-3 text-[13px] font-medium text-white">Extracting questions…</p>
                      <ul className="mt-3 space-y-1.5 text-left">
                        {STEPS.map((s, i) => (
                          <li key={s.key} className="flex items-center gap-2 text-[11.5px]">
                            {i < step ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-mint-400" />
                            ) : i === step ? (
                              <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-lime-300 border-t-transparent" />
                            ) : (
                              <span className="h-3.5 w-3.5 rounded-full border border-white/15" />
                            )}
                            <span className={i <= step ? 'text-white/70' : 'text-white/25'}>{s.label}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <>
                      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-aurora-500/25 to-lime-400/15 text-white ring-1 ring-inset ring-white/10">
                        <UploadCloud className="h-6 w-6" />
                      </span>
                      <p className="mt-4 text-[13.5px] font-medium text-white">
                        Drop your question paper here, or click to browse
                      </p>
                      <p className="mt-1.5 max-w-sm text-[11.5px] leading-relaxed text-white/40">
                        PDF, Word (.docx), photos/scans (PNG, JPG — OCR runs automatically) or plain text.
                      </p>
                      <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                        {['PDF', 'DOCX', 'PNG · JPG', 'TXT'].map((f) => (
                          <span
                            key={f}
                            className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-white/40"
                          >
                            {f}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="paper-paste" hint="first line can be the paper title">
                      Paste the question paper text
                    </Label>
                    <TextArea
                      id="paper-paste"
                      rows={9}
                      value={pastedText}
                      onChange={(e) => setPastedText(e.target.value)}
                      placeholder={`1. Which organelle produces ATP? [2 marks]\n   A) Ribosome\n   B) Mitochondrion\n   C) Golgi\n   D) Lysosome\n\n2. Respiration happens in the ______. [2 marks]\n\nAnswer Key: 1-B, 2-mitochondria`}
                      className="font-mono text-[12px]"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="lime" onClick={importText} loading={busy} disabled={busy}>
                      <ScanLine className="h-3.5 w-3.5" /> Extract & import
                    </Button>
                    <Button
                      variant="ghost"
                      size="md"
                      onClick={() =>
                        setPastedText(
                          `Unit Test — Sample Paper\nTime: 30 minutes\n\n1. Which organelle produces most of the cell's ATP? [2 marks]\n   A) Ribosome\n   B) Mitochondrion\n   C) Golgi body\n   D) Nucleus\n\n2. Water moves across a semi-permeable membrane by ______. [2 marks]\n\n3. DNA replication is semi-conservative. State whether this is true or false. [1 mark]\n\nAnswer Key: 1-B, 2-osmosis, 3-True`
                        )
                      }
                    >
                      Load example
                    </Button>
                  </div>
                </div>
              )}

              <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                <div>
                  <Label htmlFor="paper-name" hint="optional">
                    Paper name
                  </Label>
                  <Input
                    id="paper-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Unit Test 2 — Cell Biology"
                  />
                </div>
                <div>
                  <Label htmlFor="paper-subject" hint="optional">
                    Topic / subject
                  </Label>
                  <Input
                    id="paper-subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="e.g. Cell Biology"
                  />
                </div>
              </div>

              {error && (
                <div className="mt-3 rounded-xl border border-ember-500/30 bg-ember-500/10 p-3">
                  <p className="flex items-center gap-2 text-[12px] font-medium text-ember-400">
                    <AlertTriangle className="h-3.5 w-3.5" /> {error}
                  </p>
                  {warnings.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {warnings.map((w) => (
                        <li key={w} className="text-[11.5px] leading-relaxed text-white/45">
                          • {w}
                        </li>
                      ))}
                    </ul>
                  )}
                  {preview && (
                    <pre className="mt-2 max-h-32 overflow-auto rounded-lg bg-ink-950/60 p-2 text-[10.5px] leading-relaxed text-white/35">
                      {preview}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </Panel>

          {/* how it works */}
          <Panel className="p-5">
            <SectionHead eyebrow="Pipeline" title="What happens to your paper" />
            <ol className="mt-4 space-y-3">
              {[
                { icon: FileUp, t: 'Text extraction', d: 'PDF text layer, Word body text, or OCR for photos and scans.' },
                { icon: ScanLine, t: 'Question detection', d: 'Numbered items, options (A/B/C/D, roman), marks, blanks and true/false prompts.' },
                { icon: Sparkles, t: 'Answer key merge', d: 'Inline "Ans:" lines and a global answer-key block are mapped to the right question.' },
                { icon: CheckCircle2, t: 'Panel import', d: 'Every question lands in your bank with a timer, points, options and an edit + push button.' }
              ].map((s, i) => (
                <li key={s.t} className="flex gap-3">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-white/55 ring-1 ring-inset ring-white/10">
                    <s.icon className="h-3.5 w-3.5" />
                  </span>
                  <div>
                    <p className="text-[12.5px] font-medium text-white/85">
                      {i + 1}. {s.t}
                    </p>
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-white/40">{s.d}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
              <p className="text-[11px] leading-relaxed text-white/40">
                <span className="text-white/70">Tips:</span> number every question (1., 2) or Q1)), keep options on their
                own lines, and put the key either after each question or in one “Answer Key:” block at the end.
              </p>
            </div>
          </Panel>
        </div>

        {/* papers list */}
        <div>
          <SectionHead
            eyebrow="Library"
            title="Imported papers"
            sub="Open a paper to see all of its questions with timer, push and edit controls."
            action={<Badge tone="violet">{papers?.length ?? 0} papers</Badge>}
          />
          <div className="mt-4">
            {!papers ? (
              <Panel className="p-6">
                <Loading label="Loading paper library" />
              </Panel>
            ) : papers.length === 0 ? (
              <Panel className="p-8 text-center">
                <p className="text-[13px] font-medium text-white/80">No papers imported yet</p>
                <p className="mx-auto mt-1.5 max-w-sm text-[12px] leading-relaxed text-white/40">
                  Upload your first question paper above — the extracted questions appear instantly in the panel.
                </p>
              </Panel>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {papers.map((paper) => {
                  const meta = KIND_META[paper.kind] ?? KIND_META.text;
                  const Icon = meta.icon;
                  return (
                    <Panel key={paper.id} hover className="group p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-start gap-2.5">
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-white/60 ring-1 ring-inset ring-white/10">
                            <Icon className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <p className="line-clamp-2 text-[13px] font-medium leading-snug text-white">{paper.name}</p>
                            <p className="mt-0.5 truncate text-[10.5px] text-white/35">{paper.fileName}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => remove(paper)}
                          className="rounded-lg p-1.5 text-white/20 transition hover:bg-white/[0.06] hover:text-ember-400"
                          aria-label="Delete paper"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <Badge tone="violet">{paper.questionCount} questions</Badge>
                        <Badge tone={paper.stats.averageConfidence >= 0.85 ? 'mint' : 'amber'}>
                          {Math.round(paper.stats.averageConfidence * 100)}% confident
                        </Badge>
                        {paper.ocrUsed && <Badge tone="sky">OCR</Badge>}
                        {paper.examTitle && <Badge tone="lime">session live</Badge>}
                      </div>

                      <p className="mt-2.5 text-[10.5px] text-white/30">
                        {paper.uploadedByName} · {fmtRelative(paper.uploadedAt)} ·{' '}
                        {(paper.sizeBytes / 1024).toFixed(0)} KB
                      </p>

                      <Link
                        href={`/admin/papers/${paper.id}`}
                        className="mt-3 flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[12.5px] text-white/70 transition hover:border-aurora-400/40 hover:text-white"
                      >
                        Open workbench <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                    </Panel>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
