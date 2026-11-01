import type { QuestionType } from '../shared/types';
import { countWords, defaultMinAnswerWords, TYPE_LABEL } from '../shared/grade';

/**
 * Question-paper parser.
 *
 * Turns raw text pulled out of a PDF / DOCX / OCR'd image into structured,
 * import-ready questions. Deliberately heuristic (papers are wildly
 * inconsistent), so every item carries a confidence score and review notes,
 * and the paper gets warnings for whatever the teacher should double-check.
 *
 * What it reads:
 *   • question numbers: 1. · 1) · Q1 · Q.1 · Question 1: (numbering may restart per section)
 *   • section headings ("SECTION B - Short Answer Questions (2 marks each)") and
 *     general instructions ("Questions 1 to 10 carry 1 mark each", "Section A
 *     has 20 MCQs carrying 1 mark each"). Both set the format and the marks of
 *     the questions they cover.
 *   • options: A) · (a) · a. · [a] · (1) · (i), one per line or inline, with ✓ or *
 *     marking the right one. (a)/(b) parts that are questions themselves
 *     ("(a) Define osmosis. [2]") stay in the prompt as sub-parts.
 *   • marks: [2 marks] · (2 Marks) · (2M) · [Marks: 2] · (2) · (2+3) · (5×2=10) ·
 *     "... 3 marks" · ½ mark, and a right-hand marks column
 *   • answer keys: "Ans: B" lines (multi-line for written answers), "(Ans: ...)"
 *     inline, ✓ on an option, or an "Answer Key" block (one per section is fine)
 *   • word limits ("in about 50 words") → the word floor for full marks
 */

export type MarksSource = 'question' | 'subparts' | 'instructions' | 'section' | 'default';

export interface ParsedQuestion {
  number: number;
  prompt: string;
  type: QuestionType;
  options: string[];
  correctOptionIndex: number | null;
  acceptedAnswers: string[];
  points: number;
  /** Where `points` came from. `default` means the paper did not state marks for it. */
  marksSource: MarksSource;
  /** Short / long only: words an answer needs before it can earn full marks (0 = brief is fine). */
  minAnswerWords: number;
  explanation: string;
  timerSeconds: number;
  confidence: 'high' | 'medium' | 'low';
  notes: string[];
  raw: string;
  /** The section heading the question sat under, when the paper had one. */
  section: string | null;
}

export interface ParseResult {
  questions: ParsedQuestion[];
  warnings: string[];
  stats: {
    detected: number;
    withOptions: number;
    withAnswers: number;
    averageConfidence: number;
    totalMarks: number;
    marksFromPaper: number;
  };
  meta: { title: string | null; timeLimit: string | null; maxMarks: string | null };
}

// Limits shared with the API validator, so an imported question can always be re-saved.
const MAX_PROMPT_CHARS = 10_000;
const MAX_ANSWER_CHARS = 1_000;
const MAX_ACCEPTED = 50;
const MAX_OPTIONS = 8;

// ── line patterns ─────────────────────────────────────────────
/** "1." "1)" "Q1" "Q.1" "Q 1:" "Question 1" — a "." followed by a digit is a decimal, not a number. */
const QUESTION_START =
  /^\s*(?:Q(?:ues(?:tion)?)?\s*\.?\s*(?:no\.?\s*)?(\d{1,3})\s*(?:[.):\-–](?!\d))?|(\d{1,3})\s*[.):\-–](?!\d))\s*(.+)$/i;
/** "Ans: B" · "Ans. B" · "Answer - True" · "Correct answer: (c)" · "Solution: ..." (not "Answer the following") */
const ANSWER_LINE =
  /^\s*(?:ans(?:wer)?|correct\s+(?:answer|option)|model\s+answer|solution|sol)\s*(?:[:\-–=)]|\.(?=\s*\S))\s*(.*)$/i;
/** "[Ans: B]" / "(Answer: Golgi body)" anywhere in a line. */
const INLINE_ANSWER = /[\(\[]\s*(?:ans(?:wer)?|correct\s+answer)\s*[:.\-–=]\s*([^)\]]{1,300}?)\s*[\)\]]/i;
const EXPLANATION_LINE = /^\s*(?:explanation|expl\.)\s*[:\-–]\s*(.*)$/i;
/** Page furniture, bare page numbers and ruled answer lines ("________"). */
const NOISE =
  /^(?:page\s*\d+(?:\s*(?:of|\/)\s*\d+)?|\d+\s*\|\s*page|-\s*\d+\s*-|\d{1,3}|https?:\/\/\S+|www\.\S+|[-_=*~.•\s]{4,}|p\.?\s*t\.?\s*o\.?|\(?\s*turn\s+over\s*\)?)$/i;
/** A running header / footer carries a page number ("Computer Fundamentals | Max. Marks: 100 Page 1 of 5", "… | Advanced Test Page 3"). */
const PAGE_CUE = /\bpage\s*\d{1,3}\s*(?:of|\/)\s*\d{1,3}\b|\|\s*page\s*\d{1,3}\b|\|.*\bpage\s*\d{1,3}\s*$|^page\s*\d{1,3}\b/i;
const PAPER_END = /^\W*(?:end\s+of\s+(?:the\s+)?(?:question\s+)?paper|the\s+end|all\s+the\s+best|best\s+of\s+luck)\W*$/i;

/**
 * Lines that are never part of a question. A footer is dropped whole (it often
 * repeats "Max. Marks: 100", which would otherwise become a question's marks).
 */
function isNoiseLine(line: string): boolean {
  if (!line) return false;
  if (NOISE.test(line) || PAPER_END.test(line)) return true;
  return PAGE_CUE.test(line) && line.split(/\s+/).length <= 16;
}
/** A heading on its own ("General Instructions:"); numbered lines after it are instructions, not questions. */
const INSTRUCTIONS_HEAD = /^(?:general\s+|important\s+)?instructions?\s*(?:for\s+(?:the\s+)?(?:candidates?|students?)\s*)?[:\-–]?\s*$/i;
/** "Marking Scheme (Topic-wise…)", "Blueprint", "Marks distribution": a table of numbered rows follows. */
const SCHEME_HEAD =
  /^(?:marking\s+scheme|marks?\s+(?:distribution|scheme)|blue[\s-]?print|weightage|question\s+distribution|syllabus\s+coverage)\b/i;
const INSTRUCTION_CUE =
  /\b(?:question\s+paper|this\s+paper|all\s+questions|questions?\s+(?:nos?\.?|numbers?)|sections?\b|compulsory|internal\s+choice|carry|carries|carrying|allowed|permitted|calculators?|attempt|read\s+the\s+(?:following\s+)?instructions|use\s+of|log\s+tables?|marks\s+are)\b/i;

/** "SECTION A" … "SECTION L" · "Section - B" · "PART II" · "Part 3" */
const SECTION_LABEL = /^(?:section|part)\s*[-–:.]?\s*(?:([A-Z])|([IVX]{1,4})|(\d{1,2}))(?=$|[\s.:)\-–(])/i;
/** "Section A has 20 MCQs ..." is an instruction sentence, not a heading. */
const SECTION_SENTENCE =
  /^(?:section|part)\s*[-–:.]?\s*\S+\s+(?:has|have|contains?|consists?|comprises?|is|are|carr(?:y|ies)|will|shall|of|includes?|should|must)\b/i;

const SECTION_TYPES: { type: QuestionType | 'objective'; re: RegExp }[] = [
  {
    type: 'truefalse',
    re: /\btrue\s*(?:or|\/|and|-)\s*false\b|\bcorrect\s+or\s+incorrect\b|\bright\s+or\s+wrong\b|\bT\s*\/\s*F\b/i
  },
  {
    type: 'fill',
    re: /\bfill\s*(?:in|up)?\s*(?:the\s*)?blanks?\b|\bfill[\s-]*ups?\b|\bcomplete\s+the\s+(?:following\s+)?(?:sentences?|statements?)\b/i
  },
  {
    type: 'mcq',
    re: /\bmultiple[\s-]*choice\b|\bmcqs?\b|\bchoose\s+the\s+(?:correct|right|best|most\s+appropriate|appropriate)\b|\bselect\s+the\s+(?:correct|right|best)\b|\btick\s+the\s+(?:correct|right)\b/i
  },
  {
    type: 'long',
    re: /\blong[\s-]*answer\b|\b(?:la|l\.a\.)[\s-]*type\b|\bessay[\s-]*type\b|\bdescriptive\b|\banswer\s+in\s+detail\b|\bdetailed\s+answers?\b|\blong\s+questions?\b/i
  },
  {
    type: 'short',
    re: /\bvery\s+short[\s-]*answer\b|\bshort[\s-]*answer\b|\b(?:v\.?s\.?a|s\.?a)[\s-]*type\b|\bshort\s+questions?\b|\banswer\s+(?:in\s+)?(?:one|a)\s+(?:word|sentence)\b|\banswer\s+briefly\b|\bbrief\s+answers?\b|\bone[\s-]word\s+answers?\b/i
  },
  { type: 'objective', re: /\bobjective[\s-]*(?:type)?\s*questions?\b|\bobjective\s+type\b/i }
];

/** Per-question marks stated for a group: "2 marks each", "each carries 2 marks", "carrying 1 mark each". */
const MARKS_EACH =
  /(\d{1,3}(?:\.\d{1,2})?)\s*marks?\s*(?:each|for\s+each|per\s+question|apiece)\b|\beach\s+(?:question\s+|one\s+)?(?:carries|carry|is\s+of|of|worth|has)\s+(\d{1,3}(?:\.\d{1,2})?)\s*marks?|\bcarr(?:y|ies|ying)\s+(\d{1,3}(?:\.\d{1,2})?)\s*marks?\s+each|\b(\d{1,3}(?:\.\d{1,2})?)[\s-]*marks?\s+questions?\b/i;
/** "(10 × 1 = 10)": question count × marks each = total. */
const MARKS_PRODUCT = /(\d{1,3})\s*[x×*]\s*(\d{1,3}(?:\.\d{1,2})?)\s*=\s*(\d{1,4}(?:\.\d{1,2})?)/i;
const MARKS_SINGLE =
  /[\(\[\{]\s*(\d{1,3}(?:\.\d{1,2})?)\s*marks?\s*[\)\]\}]|\bmarks?\s*[:=\-]\s*(\d{1,3}(?:\.\d{1,2})?)\b|[\(\[\{]\s*(?:total\s+)?marks?\s*[:=\-]?\s*(\d{1,3}(?:\.\d{1,2})?)\s*[\)\]\}]/i;
/** "Questions 1 to 10 ..." · "Q. 21-26 ..." · "Q1-Q10 ..." */
const RANGE_RULE =
  /\b(?:questions?|ques|qs?)\.?\s*(?:nos?\.?|numbers?)?\s*(\d{1,3})\s*(?:to|-|–|through|till|upto)\s*(?:q\.?\s*)?(\d{1,3})\b([^.;]*)/gi;
const SECTION_RULE = /\bsection\s*[-–]?\s*([A-Z])\b([\s\S]{0,300}?)(?=\bsection\s*[-–]?\s*[A-Z]\b|$)/gi;
/** "Attempt any FIVE out of the following six": only that many questions count toward the total. */
const ATTEMPT_ANY = /\b(?:attempt|answer|do)\s+any\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i;
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

function attemptCount(text: string): number | null {
  const m = ATTEMPT_ANY.exec(text);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS.indexOf(m[1].toLowerCase());
  return n > 0 ? n : null;
}

/** Right-hand marks column ("What is osmosis? 2"). Trusted only when most questions show one. */
const COLUMN_MARKS = /(?<=[?.!:)\]_])\s+(\d{1,2}(?:\.5)?)\s*$/;
/** After a question mark (or a True/False cue) a trailing small number is marks even without a paper-wide column. */
const QUESTION_MARK_MARKS = /(?<=\?|\bfalse|\bT\s*\/\s*F)\s+(\d{1,2}(?:\.5)?)\s*$/i;

/** True / false wording inside a question. */
const TF_CUE =
  /\btrue\s*(?:or|\/)\s*false\b|\bstate\s+(?:whether|if)\b[^.?]*\b(?:true|false|correct|incorrect)\b|\bcorrect\s+or\s+incorrect\b|\bwrite\s+['"]?t['"]?\s+(?:for\s+true\s+)?(?:or|and)\s+['"]?f\b/i;
const TF_CUE_UPPER = /\bT\s*\/\s*F\b/;
const TF_TAIL =
  /\s*(?:[\(\[]\s*(?:true\s*(?:or|\/)\s*false|T\s*\/\s*F)\s*[\)\]]|[-–:]\s*(?:true\s*(?:or|\/)\s*false|T\s*\/\s*F)\s*\??)\s*\.?$/i;

/** Blanks: underscores, dotted or dashed gaps. Empty brackets are weaker (they are also answer boxes). */
const STRONG_BLANK = /_{2,}|\.{4,}|(?:^|\s)-{4,}(?:\s|$)/;
const WEAK_BLANK = /\(\s*\)|\[\s*\]|\.{3}\s*$/;

/** Wording that asks for an extended answer. */
const LONG_CUE =
  /\b(?:derive|prove|show\s+that|explain\s+in\s+detail|describe\s+in\s+detail|discuss|elaborate|essay|critically|compare\s+and\s+contrast|write\s+(?:short\s+)?notes?\s+on|describe|with\s+(?:the\s+help\s+of\s+)?(?:a\s+)?(?:neat\s+)?(?:well[\s-])?(?:labell?ed\s+)?diagrams?)\b/i;

/** Option-style items that are really sub-questions. */
const SUBQUESTION_START =
  /^(?:define|explain|describe|state|write|give|list|name|what|why|how|when|where|which|who|discuss|draw|differentiate|distinguish|compare|calculate|find|derive|prove|show|mention|illustrate|justify|elaborate|enumerate|outline|identify|classify|evaluate|solve|determine|construct|simplify|prepare|suggest|analyse|analyze|examine|account)\b/i;

export function normaliseText(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/[\u2714\u2611\u2705]/g, '\u2713')
    .replace(/\u2022|\u25cf|\u25aa|\u00b7/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/(\d)\s*\u00bd/g, '$1.5')
    .replace(/\u00bd/g, '0.5')
    // "[1/2]", "1⁄2 mark": half marks written as a fraction
    .replace(/\[\s*1\s*[\/\u2044]\s*2\s*\]/g, '[0.5]')
    .replace(/\b1\s*[\/\u2044]\s*2(?=\s*marks?\b)/gi, '0.5')
    .replace(/\f/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
}

function cleanLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

/** Marks snapped to the nearest quarter (papers use ¼, ½ and ¾ marks), or null outside 0 < n ≤ 100. */
function toPoints(raw: string | number | undefined | null): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 100) return null;
  const snapped = Math.round(n * 4) / 4;
  return snapped > 0 ? snapped : null;
}

function isSectionLabelHeading(line: string): boolean {
  return SECTION_LABEL.test(line) && !SECTION_SENTENCE.test(line);
}

// ── option markers ────────────────────────────────────────────
type MarkerKind = 'letter' | 'number' | 'roman';
interface Marker {
  kind: MarkerKind;
  ordinal: number;
  start: number;
  end: number;
  /**
   * Written straight after a word ("…quantities and(b) They…"): two-column PDFs
   * glue the right-hand option onto the left one, and the next line then
   * continues the LEFT option.
   */
  glued: boolean;
}

const ROMANS = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii'];
// "(b)" counts even when glued to the previous word; the other forms need a space before them.
const MARKER_RE =
  /\(\s*([a-h])\s*\)|(?:^|(?<=[\s,;]))(?:\[\s*([a-h])\s*\]|([a-h])\s*\)|([a-h])[.:](?=\s)|\(\s*([1-8])\s*\)|\(\s*(viii|vii|vi|iv|v|i{1,3})\s*\)|(viii|vii|vi|iv|v|i{1,3})[.)](?=\s))/gi;

function scanMarkers(line: string): Marker[] {
  const markers: Marker[] = [];
  const dash = /^([a-h])\s*[-–]\s+/i.exec(line);
  if (dash) {
    markers.push({ kind: 'letter', ordinal: dash[1].toLowerCase().charCodeAt(0) - 97, start: 0, end: dash[0].length, glued: false });
  }
  for (const m of line.matchAll(MARKER_RE)) {
    const start = m.index ?? 0;
    if (dash && start < dash[0].length) continue;
    const end = start + m[0].length;
    const glued = start > 0 && /[A-Za-z0-9]/.test(line[start - 1]);
    const letter = m[1] ?? m[2] ?? m[3] ?? m[4];
    if (letter) markers.push({ kind: 'letter', ordinal: letter.toLowerCase().charCodeAt(0) - 97, start, end, glued });
    else if (m[5]) markers.push({ kind: 'number', ordinal: Number(m[5]) - 1, start, end, glued });
    else markers.push({ kind: 'roman', ordinal: ROMANS.indexOf((m[6] ?? m[7] ?? '').toLowerCase()), start, end, glued });
  }
  return markers;
}

function leadingMarker(line: string): Marker | null {
  const first = scanMarkers(line)[0];
  if (!first || first.start !== 0) return null;
  // "a: [0.75 M]" is the wrapped end of a question ("… It is / a: [0.75 M]"), not option (a):
  // a real option has words after its marker.
  const rest = line.slice(first.end).replace(TRAILING_MARKS, '').trim();
  return /[\p{L}\p{N}]/u.test(rest) ? first : null;
}

/** Markers of one kind counting up from `from`; other markers stay inside the option text. */
function sequentialRun(markers: Marker[], kind: MarkerKind, from: number): Marker[] {
  const run: Marker[] = [];
  for (const m of markers) {
    if (m.kind === kind && m.ordinal === from + run.length) run.push(m);
  }
  return run;
}

function segmentsOf(line: string, run: Marker[]): string[] {
  return run.map((m, i) => line.slice(m.end, run[i + 1]?.start ?? line.length).trim());
}

function markerLabel(kind: MarkerKind | null, ordinal: number): string {
  if (kind === 'roman') return ROMANS[ordinal] ?? String(ordinal + 1);
  if (kind === 'number') return String(ordinal + 1);
  return String.fromCharCode(97 + ordinal);
}

// ── marks ─────────────────────────────────────────────────────
interface MarksHit {
  points: number;
  cleaned: string;
  strength: 'explicit' | 'bare';
}

const N = String.raw`\d{1,3}(?:\.\d{1,2})?`;
const sumOf = (expr: string) => expr.split('+').reduce((total, part) => total + Number(part.trim()), 0);

const MARK_PATTERNS: {
  re: RegExp;
  value: (m: RegExpExecArray) => number | null;
  strength: MarksHit['strength'];
  guard?: RegExp;
}[] = [
  // (5 × 2 = 10) on a question → the total after "="
  {
    re: new RegExp(String.raw`[\(\[\{]\s*\d{1,3}\s*[x×*]\s*${N}\s*=\s*(\d{1,4}(?:\.\d{1,2})?)\s*(?:marks?)?\s*[\)\]\}]`, 'i'),
    value: (m) => toPoints(m[1]),
    strength: 'explicit'
  },
  // [2 marks] · (2 Marks) · {1.5 mark} · (2 pts)
  {
    re: new RegExp(String.raw`[\(\[\{]\s*(${N})\s*(?:marks?|mks?|pts?|points?)\.?\s*[\)\]\}]`, 'i'),
    value: (m) => toPoints(m[1]),
    strength: 'explicit'
  },
  // [Marks: 2] · (Marks 2)
  {
    re: new RegExp(String.raw`[\(\[\{]\s*marks?\s*[:=\-]?\s*(${N})\s*[\)\]\}]`, 'i'),
    value: (m) => toPoints(m[1]),
    strength: 'explicit'
  },
  // [0.75 M] · [2M] anywhere; (2 M) needs a capital M so "(5 m)" stays a length
  { re: new RegExp(String.raw`\[\s*(${N})\s*[Mm]\.?\s*\]`), value: (m) => toPoints(m[1]), strength: 'explicit' },
  { re: new RegExp(String.raw`[\(\{]\s*(${N})\s*M\.?\s*[\)\}]`), value: (m) => toPoints(m[1]), strength: 'explicit' },
  // Marks: 2 · Marks = 2
  { re: new RegExp(String.raw`\bmarks?\s*[:=]\s*(${N})\b`, 'i'), value: (m) => toPoints(m[1]), strength: 'explicit' },
  // (2+3) · [1+1+2] at the end: marks per sub-part
  {
    re: /(?<=^|[\s?.!:;,_])[\(\[\{]\s*(\d{1,2}(?:\.\d)?(?:\s*\+\s*\d{1,2}(?:\.\d)?)+)\s*(?:marks?)?\s*[\)\]\}]\s*\.?$/i,
    value: (m) => toPoints(sumOf(m[1])),
    strength: 'explicit'
  },
  // (2M) · [3 M] at the end
  {
    re: /(?<=^|[\s?.!:;,_])[\(\[\{]\s*(\d{1,2}(?:\.\d)?)\s*[Mm]\s*[\)\]\}]\s*\.?$/,
    value: (m) => toPoints(m[1]),
    strength: 'explicit'
  },
  // "... 3 marks" · "... - 2 Marks." at the end (but not "scored 45 marks")
  {
    re: new RegExp(String.raw`(?<=^|[\s\-–|,;:.?!_])(${N})\s*(?:marks?|mks?|pts?)\.?\s*$`, 'i'),
    value: (m) => toPoints(m[1]),
    strength: 'explicit',
    guard: /\b(?:out\s+of|of|scored?|scores|obtain(?:ed|s)?|got|gets|get|secured?|secures|total(?:\s+of)?)\s*$/i
  },
  // bare (2) · [3] · {4} at the end of a question line ("f(2)" does not count)
  {
    re: /(?<=^|[\s?.!:;,_])[\(\[\{]\s*(\d{1,2}(?:\.\d{1,2})?)\s*[\)\]\}]\s*\.?$/,
    value: (m) => toPoints(m[1]),
    strength: 'bare'
  },
  // "[1]" glued to the last word ("generation of[1]"): square brackets are marks, not maths
  {
    re: /[\[\{]\s*(\d{1,2}(?:\.\d{1,2})?)\s*[\]\}]\s*\.?$/,
    value: (m) => toPoints(m[1]),
    strength: 'bare'
  }
];

/** A marks annotation at the very end of a line, e.g. "[1]", "[0.75 M]" or "(2 marks)". */
const TRAILING_MARKS = /\s*[\(\[\{]\s*\d{1,3}(?:\.\d{1,2})?\s*(?:marks?|mks?|m)?\.?\s*[\)\]\}]\s*$/i;

/**
 * Joins a wrapped line onto the previous one, keeping a marks annotation at
 * the end: "…generation of[1]" + "computers?" → "…generation of computers? [1]".
 */
function joinWrapped(prev: string, next: string): string {
  const marks = TRAILING_MARKS.exec(prev);
  if (!marks) return `${prev.trim()} ${next.trim()}`;
  return `${prev.slice(0, marks.index).trim()} ${next.trim()} ${marks[0].trim()}`;
}

function removeSpan(text: string, start: number, length: number): string {
  return `${text.slice(0, start)} ${text.slice(start + length)}`
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s\-–|:,;]+$/, '')
    .trim();
}

function extractMarks(text: string, allowBare: boolean): MarksHit | null {
  for (const pattern of MARK_PATTERNS) {
    if (pattern.strength === 'bare' && !allowBare) continue;
    const m = pattern.re.exec(text);
    if (!m) continue;
    if (pattern.guard && pattern.guard.test(text.slice(0, m.index))) continue;
    const points = pattern.value(m);
    if (points === null) continue;
    return { points, cleaned: removeSpan(text, m.index, m[0].length), strength: pattern.strength };
  }
  return null;
}

// ── wrapped lines ─────────────────────────────────────────────
/** Re-join hyphenated words and wrapped sentences ("station-\nary" → "stationary"). */
function joinWrappedLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    const next = line.trim();
    // "…generation of[1]" still wraps onto "computers?": judge the text before the marks
    const prevCore = prev === undefined ? '' : prev.replace(TRAILING_MARKS, '').trim();
    if (prev !== undefined && /[\[\(\{]\s*\d{1,3}(?:\.\d{1,2})?\s*$/.test(prev) && /^(?:m|marks?)?\.?\s*[\]\)\}]/i.test(next)) {
      // "[2" + "M]": a marks bracket split across two lines
      out[out.length - 1] = `${prev.trimEnd()} ${next}`;
    } else if (prev !== undefined && /[a-z]-$/.test(prev) && /^[a-z]/.test(next)) {
      out[out.length - 1] = prev.replace(/-$/, '') + next;
    } else if (
      prev !== undefined &&
      prevCore &&
      !/[.!?:;)\]]$/.test(prevCore) &&
      /^[a-z(,]/.test(next) &&
      next.length > 2 &&
      !leadingMarker(next) &&
      // option lines keep their wrapped tails apart, so the tail can go to the right option
      !leadingMarker(prev.trim()) &&
      !ANSWER_LINE.test(next) &&
      !EXPLANATION_LINE.test(next)
    ) {
      // wrapped sentence inside a paragraph
      out[out.length - 1] = joinWrapped(prev, next);
    } else {
      out.push(line);
    }
  }
  return out;
}

// ── sections and instructions ─────────────────────────────────
interface GroupRule {
  typeHint: QuestionType | null;
  objective: boolean;
  marksEach: number | null;
  product: [number, number] | null;
  single: number | null;
  text: string;
}

interface Section extends GroupRule {
  label: string | null;
  lines: string[];
  /** Instruction text about this section found elsewhere (general instructions). */
  inheritedText: string;
  blockCount: number;
}

function sectionTypeOf(text: string): { type: QuestionType | null; objective: boolean } | null {
  for (const { type, re } of SECTION_TYPES) {
    if (!re.test(text)) continue;
    // "T/F" counts only in capitals, so a stray "t/f" inside a sentence is ignored
    if (type === 'truefalse' && !/true|false|correct|right/i.test(text) && !TF_CUE_UPPER.test(text)) continue;
    return type === 'objective' ? { type: null, objective: true } : { type, objective: false };
  }
  return null;
}

function groupRuleFrom(text: string): GroupRule {
  const kind = sectionTypeOf(text);
  const each = MARKS_EACH.exec(text);
  const product = MARKS_PRODUCT.exec(text);
  const single = each || product ? null : MARKS_SINGLE.exec(text);
  return {
    typeHint: kind?.type ?? null,
    objective: kind?.objective ?? false,
    marksEach: each ? toPoints(each[1] ?? each[2] ?? each[3] ?? each[4]) : null,
    product: product ? [Number(product[1]), Number(product[2])] : null,
    single: single ? toPoints(single[1] ?? single[2] ?? single[3]) : null,
    text
  };
}

/**
 * `strong` headings may interrupt a question block even when they start like
 * an option ("II. SHORT ANSWER QUESTIONS"); weak cues only count between questions.
 */
function sectionHeadingStrength(line: string, inBlock: boolean): 'strong' | 'weak' | null {
  if (isSectionLabelHeading(line)) return 'strong';
  if (/^[\(\[].*[\)\]]$/.test(line)) return null; // "(True/False)" is an answer cue, not a heading
  if (ANSWER_LINE.test(line) || line.split(/\s+/).length > 24) return null;
  // A table header ("Topic MCQ Fill T / F Short Long Marks") names several formats at once.
  const formats = [/\bmcqs?\b|multiple\s+choice/i, /\bfill\b/i, /\bT\s*\/\s*F\b|true\s*(?:or|\/)\s*false/i, /\bshort\b/i, /\blong\b/i];
  if (formats.filter((re) => re.test(line)).length >= 3) return null;
  // A marking-scheme row ("A Multiple Choice Questions Q1 to Q50 50") describes a range; it is not a heading.
  RANGE_RULE.lastIndex = 0;
  if (RANGE_RULE.test(line)) {
    RANGE_RULE.lastIndex = 0;
    return null;
  }
  if (MARKS_EACH.test(line) && /\b(?:questions?|following|all)\b/i.test(line)) return 'strong';
  if (!sectionTypeOf(line)) return null;
  const letters = line.replace(/[^A-Za-z]/g, '');
  const allCaps = letters.length >= 6 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.75;
  if (allCaps || /\bquestions\b/i.test(line)) return 'strong';
  const cue =
    /\b(?:each|following|blanks|statements|sentences|marks?)\b/i.test(line) ||
    /:\s*$/.test(line) ||
    (!inBlock && /^(?:[IVX]{1,4}|[A-H])[.)]\s/.test(line));
  return cue ? 'weak' : null;
}

interface RangeRule {
  from: number;
  to: number;
  marks: number | null;
  typeHint: QuestionType | null;
  text: string;
}

function rangeRulesFrom(text: string): RangeRule[] {
  const rules: RangeRule[] = [];
  for (const m of text.matchAll(RANGE_RULE)) {
    const from = Number(m[1]);
    const to = Number(m[2]);
    if (!(from >= 1 && to >= from && to - from < 200)) continue;
    const tail = m[3] ?? '';
    // Only "… carry 1 mark each" sets marks per question; "Q51 to Q75 | 14 Marks" is a section total.
    const each = MARKS_EACH.exec(tail);
    const marks = each ? [each[0], each[1] ?? each[2] ?? each[3] ?? each[4]] : null;
    rules.push({ from, to, marks: marks ? toPoints(marks[1]) : null, typeHint: sectionTypeOf(tail)?.type ?? null, text: m[0] });
  }
  return rules;
}

/** "Section A has 20 MCQs carrying 1 mark each." in the general instructions. */
function sectionRulesFrom(text: string): Map<string, GroupRule> {
  const rules = new Map<string, GroupRule>();
  for (const m of text.matchAll(SECTION_RULE)) {
    const label = m[1].toUpperCase();
    if (!rules.has(label)) rules.set(label, groupRuleFrom(m[0]));
  }
  return rules;
}

/** "I. MULTIPLE CHOICE ..." / "B) Short answer ..." label a section without the word "Section". */
const HEADING_PREFIX = /^([IVX]{1,4}|[A-H])[.)]\s/;

function newSection(heading: string): Section {
  const label = SECTION_LABEL.exec(heading);
  const prefix = label ? null : HEADING_PREFIX.exec(heading);
  return {
    label: label ? (label[1] ?? label[2] ?? label[3] ?? '').toUpperCase() : prefix ? prefix[1].toUpperCase() : null,
    lines: [heading],
    inheritedText: '',
    blockCount: 0,
    ...groupRuleFrom('')
  };
}

function finaliseSection(section: Section, byLabel: Map<string, GroupRule>): void {
  const own = groupRuleFrom(section.lines.join(' '));
  const inherited = section.label ? byLabel.get(section.label) : undefined;
  const ownMarks = own.marksEach !== null || own.product !== null || own.single !== null;
  section.text = own.text;
  section.inheritedText = inherited?.text ?? '';
  section.typeHint = own.typeHint ?? inherited?.typeHint ?? null;
  section.objective = own.objective || (!own.typeHint && !!inherited?.objective);
  section.marksEach = ownMarks ? own.marksEach : inherited?.marksEach ?? null;
  section.product = ownMarks ? own.product : inherited?.product ?? null;
  section.single = ownMarks ? own.single : inherited?.single ?? null;
}

/** Marks per question implied by a section heading, given how many questions it holds. */
function sectionMarks(section: Section): number | null {
  if (section.marksEach) return section.marksEach;
  if (section.product) {
    const [a, b] = section.product;
    // "10 × 1 = 10" is count × marks; some papers write marks × count. With a
    // choice ("attempt any FOUR of five", 4 × 5 = 20) the count is the number to attempt.
    const count = attemptCount(section.text) ?? section.blockCount;
    if (count === a) return toPoints(b);
    if (count === b && count !== a) return toPoints(a);
    return toPoints(b);
  }
  if (section.single) {
    // "(2 marks)" next to "Short answer questions" means each; "(20 marks)" is the section total.
    if (section.single >= 10 || /\btotal\b/i.test(section.text)) {
      if (!section.blockCount) return null;
      const each = section.single / section.blockCount;
      return Math.round(each * 2) === each * 2 ? toPoints(each) : null;
    }
    return section.single;
  }
  return null;
}

// ── splitting ─────────────────────────────────────────────────
interface RawBlock {
  number: number;
  lines: string[];
  section: Section | null;
}

/**
 * Splits the paper into per-question blocks, section headings and the preamble.
 *
 * Front matter is kept out of the questions: a "General Instructions" list or a
 * "Marking Scheme" table is numbered too ("1. All questions are compulsory",
 * "1. Introduction … 6 2 1 1 1 12.5"), so after such a heading numbered lines
 * stay in the preamble until a section heading or a line that reads like a
 * question. `dropFrontMatter` later removes any that still slipped through.
 */
function splitPaper(lines: string[]): { blocks: RawBlock[]; preamble: string[]; sections: Section[] } {
  const blocks: RawBlock[] = [];
  const preamble: string[] = [];
  const sections: Section[] = [];
  let current: RawBlock | null = null;
  let section: Section | null = null;
  let collecting: Section | null = null;
  let freshSection = false;
  let expected = 1;
  let frontMode: 'instructions' | 'scheme' | null = null;
  let numberedInstructions = 0;
  let lastInstruction = 0;

  for (const rawLine of lines) {
    const line = cleanLine(rawLine);
    if (!line || isNoiseLine(line)) continue;

    // "General Instructions" / "Marking Scheme" start front matter wherever they appear.
    const frontHead = INSTRUCTIONS_HEAD.test(line) ? 'instructions' : SCHEME_HEAD.test(line) ? 'scheme' : null;
    if (frontHead) {
      if (current) blocks.push(current);
      current = null;
      collecting = null;
      frontMode = frontHead;
      numberedInstructions = 0;
      lastInstruction = 0;
      preamble.push(line);
      continue;
    }

    const start = QUESTION_START.exec(line);
    if (start) {
      const n = Number(start[1] ?? start[2]);
      const rest = start[3].trim();
      // "Q 1-10 carry 1 mark each" is an instruction about a range, not question 1
      const isRange = /^(?:to|-|–|through)\s*(?:q\.?\s*)?\d/i.test(rest);
      let handled = false;
      if (!isRange && frontMode) {
        // A numbered line under "General Instructions" stays an instruction unless it reads like a
        // question (ends with "?", has a blank or a True/False cue) or numbering starts again at 1.
        const tfQuestion = (TF_CUE.test(rest) || TF_CUE_UPPER.test(rest)) && !INSTRUCTION_CUE.test(rest);
        const questionLike =
          /\?\s*$/.test(rest) ||
          STRONG_BLANK.test(rest) ||
          tfQuestion ||
          (TRAILING_MARKS.test(rest) && !INSTRUCTION_CUE.test(rest));
        const continuesList = numberedInstructions > 0 && n === lastInstruction + 1;
        // Marking-scheme rows are numbered topics followed by figures; they are never questions.
        const instructionLike = !questionLike && (frontMode === 'scheme' || INSTRUCTION_CUE.test(rest) || continuesList);
        if (instructionLike && !(n === 1 && numberedInstructions > 0)) {
          numberedInstructions++;
          lastInstruction = n;
          preamble.push(rest);
          handled = true;
        } else {
          frontMode = null;
          expected = n;
        }
      }
      if (handled) continue;
      const restart = n === 1 && (current === null || freshSection || expected > 4);
      const sequential = n === expected || n === expected + 1 || restart;
      if (!isRange && sequential && rest.length > 3) {
        if (current) blocks.push(current);
        current = { number: n, lines: [rest], section };
        if (section) section.blockCount++;
        collecting = null;
        freshSection = false;
        expected = n + 1;
        continue;
      }
    }

    const inBlock = current !== null;
    // "Part 1: Types of Computers" inside SECTION A is a topic line: the questions stay in SECTION A.
    if (section?.label && /^[A-Z]$/.test(section.label) && /^(?:part|unit|chapter|topic)\s*[-–:.]?\s*\d{1,2}\b/i.test(line)) {
      if (current) blocks.push(current);
      current = null;
      continue;
    }
    const optionLike = inBlock && leadingMarker(line) !== null;
    const strength = sectionHeadingStrength(line, inBlock);
    if (strength && (!optionLike || strength === 'strong') && !(optionLike && /^[\(\[]/.test(line))) {
      if (current) blocks.push(current);
      current = null;
      frontMode = null;
      section = newSection(line);
      sections.push(section);
      collecting = section;
      freshSection = true;
      continue;
    }

    if (current) current.lines.push(line);
    else if (collecting) collecting.lines.push(line);
    else preamble.push(line);
  }
  if (current) blocks.push(current);
  return { blocks, preamble, sections };
}

// ── answer key block ──────────────────────────────────────────
const KEY_HEADER = /^\s*(?:answer\s*keys?|answers|key\s+to\s+(?:the\s+)?questions|key)\s*(?:[:\-–]\s*|\s+(?=\(?\d)|$)/i;
const KEY_PAIR = /(?:^|(?<=[\s,;(]))(?:Q\.?\s*)?(\d{1,3})\s*(?:\.(?!\d)|[-):–=])\s*/gi;
const KEY_COMPACT_LINE = /^(?:\s*\d{1,3}\s+\(?[a-h]\)?(?=\s|$))+\s*$/i;
const KEY_COMPACT_PAIR = /(\d{1,3})\s+\(?([a-h])\)?(?=\s|$)/gi;

function cleanKeyValue(value: string): string {
  return value
    .trim()
    .replace(/[,;]+$/, '')
    .replace(/^\(\s*([a-h])\s*\)$/i, '$1')
    .trim();
}

interface KeyScope {
  /** Section label the key was filed under ("A", "II"), when it had one. */
  label: string | null;
  map: Map<number, string>;
}

interface AnswerKey {
  /** One scope per section / numbering run, in paper order. */
  scopes: KeyScope[];
  remaining: string[];
  entries: number;
}

/** "Section B:" · "PART II" · "II." / "B)" directly before an entry, inside the key block. */
const KEY_SCOPE_PREFIX = /^(?:[IVX]{1,4}|[A-H])[.)]\s*(?=\(?\d|$)/;

/**
 * Pulls "Answer Key: 1-A, 2-B ..." out of the paper. Keys count upward inside a
 * scope; a section heading (or numbering that restarts at 1) opens the next
 * scope, so papers whose sections each restart at 1 still map correctly.
 * Lines that are not new entries continue the previous answer (written keys).
 */
function extractAnswerKey(lines: string[]): AnswerKey {
  const scopes: KeyScope[] = [{ label: null, map: new Map() }];
  const remaining: string[] = [];
  let inKeyBlock = false;
  let last = 0;
  let lastKey = 0;
  let entries = 0;
  let gridNumbers: number[] | null = null;

  const scope = () => scopes[scopes.length - 1].map;
  const nextScope = (label: string | null) => {
    if (scope().size) scopes.push({ label, map: new Map() });
    else scopes[scopes.length - 1].label = label;
    last = 0;
    lastKey = 0;
  };
  const record = (n: number, value: string) => {
    scope().set(n, value);
    last = n;
    lastKey = n;
    entries++;
  };
  const append = (text: string) => {
    const t = text.trim();
    if (t && lastKey && scope().has(lastKey)) scope().set(lastKey, `${scope().get(lastKey)}\n${t}`);
  };

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!inKeyBlock) {
      const header = KEY_HEADER.exec(line);
      if (!header) {
        remaining.push(rawLine);
        continue;
      }
      inKeyBlock = true;
      line = line.slice(header[0].length).trim();
    }
    if (!line || isNoiseLine(line)) continue;

    // Grid keys: a row of question numbers, then a row with one answer under each.
    //   1 2 3 4 5 …       b a d c c …
    if (/^\d{1,3}(?:\s+\d{1,3})+$/.test(line)) {
      gridNumbers = line.split(/\s+/).map(Number);
      continue;
    }
    if (gridNumbers) {
      const numbers = gridNumbers;
      gridNumbers = null;
      const answers = line.split(/\s+/);
      if (answers.length === numbers.length) {
        if (numbers[0] === 1 && last > 0) nextScope(null);
        numbers.forEach((n, i) => {
          if (n > 0 && n < 500) record(n, answers[i]);
        });
        continue;
      }
    }

    const labelled = isSectionLabelHeading(line) ? SECTION_LABEL.exec(line) : null;
    const prefixed = labelled ? null : KEY_SCOPE_PREFIX.exec(line);
    if (labelled || prefixed) {
      const label = labelled ? labelled[1] ?? labelled[2] ?? labelled[3] ?? '' : prefixed![0].replace(/[.)\s]/g, '');
      nextScope(label.toUpperCase() || null);
      line = line.slice((labelled ?? prefixed)![0].length).replace(/^[\s:.\-–)]+/, '').trim();
      if (!line) continue;
    }

    if (KEY_COMPACT_LINE.test(line)) {
      // "1 b 2 c 3 a"
      for (const m of line.matchAll(KEY_COMPACT_PAIR)) {
        const n = Number(m[1]);
        if (n === 1 && last >= 2) nextScope(null);
        if (n > last) record(n, m[2].toUpperCase());
      }
      continue;
    }

    const pairs = [...line.matchAll(KEY_PAIR)].map((m) => ({
      n: Number(m[1]),
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length
    }));
    if (pairs[0]?.start === 0 && pairs[0].n === 1 && last >= 2) nextScope(null); // numbering restarted
    const accepted: typeof pairs = [];
    let floor = last;
    for (const p of pairs) {
      if (p.n > floor && p.n < 500) {
        accepted.push(p);
        floor = p.n;
      }
    }
    if (!accepted.length) {
      append(line);
      continue;
    }
    if (accepted[0].start > 0) append(line.slice(0, accepted[0].start));
    accepted.forEach((p, i) => {
      const next = accepted[i + 1];
      const raw = line.slice(p.end, next?.start ?? line.length);
      // A trailing "," / ";" separates entries on one line; at the end of a line it may be part of a written answer.
      const value = next ? cleanKeyValue(raw) : raw.trim().replace(/^\(\s*([a-h])\s*\)$/i, '$1');
      if (value) record(p.n, value);
    });
  }
  return { scopes: scopes.filter((s) => s.map.size > 0), remaining, entries };
}

// ── answer-key matching ───────────────────────────────────────
const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const isTrueWord = (s: string) => /^(?:t|true|correct|right|yes)$/.test(normKey(s)) || normKey(s).startsWith('true');
const isFalseWord = (s: string) => /^(?:f|false|incorrect|wrong|no)$/.test(normKey(s)) || normKey(s).startsWith('false');

function isTrueFalseOptions(options: string[]): boolean {
  if (options.length !== 2) return false;
  return (isTrueWord(options[0]) && isFalseWord(options[1])) || (isFalseWord(options[0]) && isTrueWord(options[1]));
}

function textMatch(target: string, options: string[]): number | null {
  const t = normKey(target);
  if (t.length < 2) return null;
  const exact = options.findIndex((o) => normKey(o) === t);
  if (exact >= 0) return exact;
  if (t.length < 3) return null;
  const partial = options.findIndex((o) => {
    const candidate = normKey(o);
    return candidate.length > 3 && (candidate.includes(t) || t.includes(candidate));
  });
  return partial >= 0 ? partial : null;
}

function optionIndexFromKey(key: string, options: string[], kind: MarkerKind | null): number | null {
  const raw = key
    .trim()
    .replace(/^(?:option|choice)\s*[:.\-]?\s*/i, '')
    .replace(/[.;,]+$/, '')
    .trim();
  if (!raw) return null;

  if (kind === 'roman') {
    const roman = /^[\(\[]?\s*(viii|vii|vi|iv|v|i{1,3})\s*[\)\].]?(?:\s+.*)?$/i.exec(raw);
    if (roman) {
      const idx = ROMANS.indexOf(roman[1].toLowerCase());
      if (idx >= 0 && idx < options.length) return idx;
    }
  }

  // "b" · "(b)" · "B." · "b) Mitochondrion" — but "A cell wall" or "Golgi" are text, not letters
  const letter = /^([\(\[])?\s*([a-h])\s*([\)\].:\-–])?\s*(.*)$/i.exec(raw);
  if (letter) {
    const idx = letter[2].toLowerCase().charCodeAt(0) - 97;
    const delimited = !!letter[1] || !!letter[3];
    const rest = letter[4].trim();
    if (!rest && idx < options.length) return idx;
    if (rest && delimited) {
      // "B) Mitochondrion": when the text names a different option, trust the text
      const byText = textMatch(rest, options);
      if (byText !== null && byText !== idx) return byText;
      if (idx < options.length) return idx;
    }
  }

  const numbered = /^[\(\[]?\s*([1-8])\s*[\)\].]?(?:\s+.*)?$/.exec(raw);
  if (numbered) {
    const idx = Number(numbered[1]) - 1;
    if (idx < options.length) return idx;
  }

  if (isTrueFalseOptions(options)) {
    if (isTrueWord(raw)) return options.findIndex(isTrueWord);
    if (isFalseWord(raw)) return options.findIndex(isFalseWord);
  }
  return textMatch(raw, options);
}

/** true / false / null from a key such as "T", "False", "(a)", "Correct", "The statement is true". */
function truthFromKey(key: string, options: string[]): boolean | null {
  const raw = key.trim().replace(/^[\(\[]|[\)\].]+$/g, '').trim();
  if (isTrueWord(raw)) return true;
  if (isFalseWord(raw)) return false;
  const letter = /^([ab])$/i.exec(raw);
  if (letter) {
    const idx = letter[1].toLowerCase() === 'a' ? 0 : 1;
    if (options.length === 2) return isTrueWord(options[idx]) ? true : isFalseWord(options[idx]) ? false : idx === 0;
    return idx === 0;
  }
  const says = /\btrue\b|\bcorrect\b/i.test(raw);
  const denies = /\bfalse\b|\bincorrect\b|\bwrong\b/i.test(raw);
  return says !== denies ? says : null;
}

function stripLabel(key: string): string {
  return key.replace(/^[\(\[]?[a-h][\)\].]\s+/i, '').trim();
}

/**
 * Splits a written model answer into key points, one per line, after
 * re-joining lines that a PDF merely wrapped ("…(eye strain, back" + "pain), …").
 */
function keyPoints(key: string): string[] {
  const points: string[] = [];
  for (const raw of key.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const prev = points[points.length - 1];
    const wrapped = prev !== undefined && (!/[.!?;:]$/.test(prev) || /^[a-z(,+&]/.test(line));
    if (wrapped) points[points.length - 1] = `${prev} ${line}`;
    else points.push(line);
  }
  return points;
}

/** "Golgi apparatus / Golgi body" or "Rutherford or Bohr" → two accepted answers. "1/2" stays one. */
function splitAlternatives(key: string): string[] {
  return key
    .split(/\s+\/\s+|(?<=[a-z])\/(?=[a-z])|\s+or\s+/i)
    .map((a) => a.trim())
    .filter(Boolean);
}

function boundAnswers(answers: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const answer of answers) {
    const clean = answer.replace(/^[-–]\s*/, '').trim().slice(0, MAX_ANSWER_CHARS);
    const k = clean.toLowerCase();
    if (!clean || seen.has(k)) continue;
    seen.add(k);
    out.push(clean);
    if (out.length >= MAX_ACCEPTED) break;
  }
  return out;
}

// ── defaults ──────────────────────────────────────────────────
/** Used only when the paper states no marks for a question (CBSE-style weights). */
function defaultPoints(type: QuestionType): number {
  if (type === 'long') return 5;
  if (type === 'short') return 2;
  return 1;
}

function estimateTimer(type: QuestionType, points: number): number {
  const base: Record<QuestionType, number> = { mcq: 45, truefalse: 25, fill: 30, short: 90, long: 300 };
  const typical: Record<QuestionType, number> = { mcq: 1, truefalse: 1, fill: 1, short: 2, long: 5 };
  // More marks → more time, but not linearly (a 10-mark answer is not 10× a 1-mark one).
  const scaled = base[type] * Math.sqrt(Math.max(0.5, points) / typical[type]);
  return Math.max(20, Math.min(600, Math.round(scaled / 5) * 5));
}

function writtenType(prompt: string, points: number | null, objective: boolean): QuestionType {
  if (objective) return 'short';
  const words = countWords(prompt);
  if (points !== null) {
    if (points >= 5) return 'long';
    if (points <= 3) return 'short';
    return LONG_CUE.test(prompt) || words > 40 ? 'long' : 'short';
  }
  return LONG_CUE.test(prompt) || words > 42 ? 'long' : 'short';
}

// ── one question block ────────────────────────────────────────
interface Item {
  /** Option text as written, kept so a wrapped continuation line can be added later. */
  raw: string;
  text: string;
  /** Explicit marks written on the item ("[2 marks]"). */
  marks: number | null;
  /** A bare "(2)" at the end, only trusted when the items turn out to be sub-parts. */
  bare: number | null;
  bareCleaned: string;
  /** Ticked as the right option (✓, *, "(correct)"). */
  marked: boolean;
}

interface PromptEntry {
  text: string;
  label?: string;
  roman?: Item;
}

const TICK_END = /\s*(?:\u2713|\(\s*(?:correct|right|ans)\s*\)|\[\s*(?:correct|right|ans)\s*\]|\*)\s*$/i;
const TICK_START = /^(?:\u2713|\*)\s*/;

function makeItem(rawText: string): Item {
  const raw = rawText.trim();
  let text = raw;
  let marked = false;
  if (TICK_END.test(text)) {
    marked = true;
    text = text.replace(TICK_END, '');
  }
  if (TICK_START.test(text)) {
    marked = true;
    text = text.replace(TICK_START, '');
  }
  const explicit = extractMarks(text, false);
  if (explicit) text = explicit.cleaned;
  const bare = explicit ? null : extractMarks(text, true);
  return {
    raw,
    text: text.trim(),
    marks: explicit?.points ?? null,
    bare: bare?.points ?? null,
    bareCleaned: bare?.cleaned ?? text.trim(),
    marked
  };
}

/** Stems that ask students to write something for each item: "Write the shortcut keys for: (a) Cut (b) Paste…" */
const WRITE_STEM =
  /^(?:write|give|name|list|define|explain|state|mention|expand|convert|find|answer|solve|calculate|describe|draw|differentiate|distinguish|evaluate|simplify|translate)\b/i;
const CHOICE_STEM =
  /\b(?:which|choose|select|pick|tick|odd\s+(?:one|man)|correct\s+(?:option|answer|alternative|statement|one)|following\s+is|true|false)\b/i;

function looksLikeSubQuestions(items: Item[]): boolean {
  if (items.filter((i) => i.marks !== null).length >= 2) return true;
  const questiony = items.filter((i) => SUBQUESTION_START.test(i.text) || /\?\s*$/.test(i.text)).length;
  return questiony * 2 > items.length;
}

function subpartMarks(items: Item[]): number | null {
  const withMarks = items.filter((o) => (o.marks ?? o.bare) !== null);
  if (withMarks.length < 2 && !(items.length === 1 && withMarks.length === 1)) return null;
  return toPoints(withMarks.reduce((total, o) => total + (o.marks ?? o.bare ?? 0), 0));
}

interface ParsedBlock {
  prompt: string;
  options: Item[];
  optionKind: MarkerKind | null;
  points: number | null;
  marksSource: MarksSource | null;
  answer: string | null;
  explanation: string;
  notes: string[];
}

function parseBlock(block: RawBlock, columnMarks: boolean): ParsedBlock {
  const notes: string[] = [];
  const entries: PromptEntry[] = [];
  const stemMarks: MarksHit[] = [];
  /** Block line each entry of `stemMarks` came from. */
  const stemLines: number[] = [];
  const explanationParts: string[] = [];
  let answerParts: string[] | null = null;
  let options: Item[] = [];
  // Assigned inside `addOptions`, so declared wide to stop narrowing to `null`.
  let optionKind = null as MarkerKind | null;
  let romanCount = 0;
  let stem = '';
  let wrapTarget = 0;
  let mode: 'question' | 'answer' | 'explanation' = 'question';

  const addPrompt = (text: string, lineIndex: number) => {
    let t = text;
    const hit = extractMarks(t, true);
    if (hit) {
      stemMarks.push(hit);
      stemLines.push(lineIndex);
      t = hit.cleaned;
    } else if (lineIndex === 0) {
      const column = (columnMarks ? COLUMN_MARKS : QUESTION_MARK_MARKS).exec(t);
      const points = column ? toPoints(column[1]) : null;
      if (column && points !== null && points <= 20) {
        stemMarks.push({ points, cleaned: '', strength: 'bare' });
        stemLines.push(lineIndex);
        t = t.slice(0, column.index).trim();
      }
    }
    if (t.trim()) entries.push({ text: t.trim() });
  };

  const addRomans = (line: string, run: Marker[]) => {
    for (const segment of segmentsOf(line, run)) {
      const item = makeItem(segment);
      entries.push({ text: item.text, label: ROMANS[romanCount], roman: item });
      romanCount++;
    }
  };

  const addOptions = (line: string, run: Marker[], kind: MarkerKind) => {
    // The stem is everything written before the first option.
    if (!options.length) stem = entries.filter((e) => !e.roman).map((e) => e.text).join(' ');
    const first = options.length;
    for (const segment of segmentsOf(line, run)) if (options.length < MAX_OPTIONS) options.push(makeItem(segment));
    optionKind = kind;
    // A wrapped tail on the next line belongs to the option before a glued marker, else the last one.
    const gluedAt = run.findIndex((m, i) => i > 0 && m.glued);
    wrapTarget = gluedAt > 0 ? Math.min(first + gluedAt - 1, options.length - 1) : options.length - 1;
  };

  lines: for (const [lineIndex, original] of block.lines.entries()) {
    let line = original;
    if (!line) continue;
    // ". (g) Rename (h) Screen shot": stray punctuation in front of a marker
    if (/^[.,;:\-–]+\s*(?=[\(\[]?(?:[a-h]|[1-8]|[ivx]{1,4})[\)\].])/i.test(line)) line = line.replace(/^[.,;:\-–]+\s*/, '');

    if (mode === 'question') {
      const inline = INLINE_ANSWER.exec(line);
      if (inline) {
        answerParts = [inline[1].trim()];
        line = removeSpan(line, inline.index, inline[0].length);
        if (!line) continue;
      }
    }

    // The first line is always the question, even if it starts with "Solution: ..."
    if (lineIndex > 0) {
      const explanation = EXPLANATION_LINE.exec(line);
      if (explanation) {
        mode = 'explanation';
        if (explanation[1].trim()) explanationParts.push(explanation[1].trim());
        continue;
      }
      const answer = ANSWER_LINE.exec(line);
      if (answer && mode !== 'explanation') {
        mode = 'answer';
        answerParts = answer[1].trim() ? [answer[1].trim()] : [];
        continue;
      }
    }
    // Everything after "Ans:" belongs to the answer (written answers run over several lines).
    if (mode === 'answer') {
      (answerParts ?? (answerParts = [])).push(line);
      continue;
    }
    if (mode === 'explanation') {
      explanationParts.push(line);
      continue;
    }

    const markers = scanMarkers(line);
    const lead = markers[0] && markers[0].start === 0 && leadingMarker(line) ? markers[0] : null;

    if (lead && lead.kind !== 'roman' && (optionKind === null || optionKind === lead.kind) && lead.ordinal === options.length) {
      addOptions(line, sequentialRun(markers, lead.kind, options.length), lead.kind);
      continue;
    }
    if (lead && lead.kind === 'roman' && lead.ordinal === romanCount && options.length === 0) {
      addRomans(line, sequentialRun(markers, 'roman', romanCount));
      continue;
    }

    // A line under the options that is not a new option continues the last one:
    // a wrapped option ("…with the relation" / "between each unit and the next."),
    // a nested list under it ("(i) (1021) (ii) (789)"), or a row of subscripts ("2 8 16 10").
    if (options.length > 0 && (!lead || lead.kind !== optionKind)) {
      const continues = /^[a-z]/.test(line) || !/[A-Za-z]/.test(line) || (lead !== null && lead.kind !== optionKind);
      if (continues) {
        const target = Math.min(wrapTarget, options.length - 1);
        options[target] = makeItem(joinWrapped(options[target].raw, line));
        continue;
      }
    }

    if (!lead && options.length === 0) {
      // Inline options after the stem: "Which ...? (a) x (b) y (c) z (d) w"
      for (const kind of ['letter', 'number'] as const) {
        const run = sequentialRun(markers, kind, 0);
        if (run.length < 2) continue;
        const prefix = line.slice(0, run[0].start).trim();
        if (run.length >= 3 || !prefix || /[?:.!_)\]]$/.test(prefix)) {
          if (prefix) addPrompt(prefix, lineIndex);
          addOptions(line, run, kind);
          continue lines;
        }
      }
      const romanRun = sequentialRun(markers, 'roman', 0);
      if (romanRun.length >= 2 && romanCount === 0) {
        const prefix = line.slice(0, romanRun[0].start).trim();
        if (prefix) addPrompt(prefix, lineIndex);
        addRomans(line, romanRun);
        continue;
      }
    }

    addPrompt(line, lineIndex);
  }

  // (a)/(b) items that are questions in their own right are sub-parts, not options,
  // and so are items under a "Write … for:" stem (outside a multiple-choice section).
  const writeStem =
    block.section?.typeHint !== 'mcq' && WRITE_STEM.test(stem.trim()) && !CHOICE_STEM.test(stem);
  let subMarks: number | null = null;
  if (options.length === 1 || (options.length >= 2 && (looksLikeSubQuestions(options) || writeStem))) {
    subMarks = subpartMarks(options);
    const kind = optionKind;
    options.forEach((o, i) => {
      const text = o.marks === null && o.bare !== null && subMarks !== null ? o.bareCleaned : o.text;
      entries.push({ text, label: markerLabel(kind, i) });
    });
    options = [];
    optionKind = null;
  }

  const romanItems = entries.filter((e) => e.roman).map((e) => e.roman as Item);
  if (options.length < 2 && romanItems.length >= 2) {
    if (looksLikeSubQuestions(romanItems)) {
      const romanMarks = subpartMarks(romanItems);
      if (romanMarks !== null) {
        subMarks = subMarks ?? romanMarks;
        for (const e of entries) if (e.roman && e.roman.marks === null && e.roman.bare !== null) e.text = e.roman.bareCleaned;
      }
    } else {
      // (i)…(iv) with no lettered options are the options
      options = romanItems;
      optionKind = 'roman';
      for (let i = entries.length - 1; i >= 0; i--) if (entries[i].roman) entries.splice(i, 1);
    }
  }

  const prompt = entries
    .map((e) => (e.label ? `(${e.label}) ${e.text}` : e.text))
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[-–•]\s*/, '')
    .replace(/\s+([,.;:])$/, '$1')
    .trim();

  // Marks: the question's own annotation, then its sub-parts, then marks written on an option line.
  let points: number | null = null;
  let marksSource: MarksSource | null = null;
  const explicit = stemMarks.filter((h) => h.strength === 'explicit');
  // Marks on the question's own line win; then explicit marks anywhere in the stem.
  const onQuestionLine = stemMarks[stemLines.indexOf(0)];
  const chosen = onQuestionLine ?? explicit[0] ?? stemMarks[0];
  if (chosen) {
    points = chosen.points;
    marksSource = 'question';
    const distinct = [...new Set(explicit.map((h) => h.points))];
    if (distinct.length > 1) notes.push(`Several marks found (${distinct.join(', ')}); used ${points}. Check the total.`);
  } else if (subMarks !== null) {
    points = subMarks;
    marksSource = 'subparts';
  } else if (options.length >= 2) {
    const optionMarks = options.find((o) => o.marks !== null)?.marks ?? null;
    if (optionMarks !== null) {
      points = optionMarks;
      marksSource = 'question';
    }
  }

  const answer: string | null = answerParts && answerParts.length ? answerParts.join('\n').trim() || null : null;
  return {
    prompt: prompt.slice(0, MAX_PROMPT_CHARS),
    options,
    optionKind,
    points,
    marksSource,
    answer,
    explanation: explanationParts.join(' ').trim().slice(0, MAX_PROMPT_CHARS),
    notes
  };
}

/**
 * Last line of defence against front matter that was numbered like a question:
 * a marking-scheme row ("Types of Computers 6 2 3 1 1 12.5") or an instruction
 * ("All questions are compulsory") sitting before the paper's first section.
 * Real questions have options, a blank, a question mark or marks of their own.
 */
function isFrontMatter(block: RawBlock, parsed: ParsedBlock, paperHasSections: boolean): boolean {
  if (parsed.options.length >= 2 || parsed.answer) return false;
  const prompt = parsed.prompt;
  if (/(?:\s\d{1,3}(?:\.\d{1,2})?){3,}\s*$/.test(prompt)) return true; // a row of figures
  if (block.section || !paperHasSections) return false;
  if (parsed.marksSource !== null || /\?\s*$/.test(prompt) || STRONG_BLANK.test(prompt)) return false;
  return INSTRUCTION_CUE.test(prompt) || /\b(?:no\s+negative\s+marking|read\s+(?:each|all|every|the)\s+questions?|carefully)\b/i.test(prompt);
}

/** A right-hand marks column is trusted only when most questions show one. */
function detectColumnMarks(blocks: RawBlock[]): boolean {
  if (blocks.length < 3) return false;
  const hits = blocks.filter((b) => {
    const first = b.lines[0] ?? '';
    return !extractMarks(first, true) && COLUMN_MARKS.test(first);
  }).length;
  return hits >= 3 && hits / blocks.length >= 0.4;
}

function listNumbers(numbers: number[], max = 12): string {
  const shown = numbers.slice(0, max).map((n) => `Q${n}`).join(', ');
  return numbers.length > max ? `${shown} and ${numbers.length - max} more` : shown;
}

// ── entry point ───────────────────────────────────────────────
export function parseQuestionPaper(rawText: string): ParseResult {
  const text = normaliseText(rawText);
  const key = extractAnswerKey(text.split('\n'));
  // Footers go before lines are re-joined, so "Page 2 of 5" never sticks to a question.
  const lines = joinWrappedLines(key.remaining.filter((line) => !isNoiseLine(cleanLine(line))));
  const { blocks, preamble, sections } = splitPaper(lines);

  const preambleText = preamble.join(' ');
  const bySectionLabel = sectionRulesFrom(preambleText);
  sections.forEach((s) => finaliseSection(s, bySectionLabel));
  const paperRanges = rangeRulesFrom(preambleText);
  const sectionRanges = new Map(sections.map((s) => [s, rangeRulesFrom(s.text)] as const));

  // Numbering scopes: a new scope starts whenever numbering goes backwards.
  let scope = 0;
  let previous = 0;
  const scopeOf = blocks.map((b) => {
    if (b.number <= previous) scope++;
    previous = b.number;
    return scope;
  });
  const scopeCount = blocks.length ? scope + 1 : 0;
  const numberCount = new Map<number, number>();
  blocks.forEach((b) => numberCount.set(b.number, (numberCount.get(b.number) ?? 0) + 1));
  const columnMarks = detectColumnMarks(blocks);

  const labelledKeys = key.scopes.some((s) => s.label !== null);
  const keyFor = (index: number, n: number): { value: string | null; ambiguous: boolean } => {
    // A key filed under "Section B" belongs to the questions under the SECTION B heading.
    const label = blocks[index].section?.label ?? null;
    if (labelledKeys && label) {
      const filed = key.scopes.find((s) => s.label === label);
      if (filed) return { value: filed.map.get(n) ?? null, ambiguous: false };
    }
    if (key.scopes.length === scopeCount) return { value: key.scopes[scopeOf[index]]?.map.get(n) ?? null, ambiguous: false };
    const holders = key.scopes.filter((s) => s.map.has(n));
    if (!holders.length) return { value: null, ambiguous: false };
    if (holders.length === 1 && numberCount.get(n) === 1) return { value: holders[0].map.get(n) ?? null, ambiguous: false };
    // Sections were matched by label, so a section with no filed key simply has none.
    if (labelledKeys && label) return { value: null, ambiguous: false };
    return { value: null, ambiguous: true };
  };

  const warnings: string[] = [];
  const questions: ParsedQuestion[] = [];
  const defaulted: number[] = [];
  const mcqWithoutOptions: number[] = [];
  const ambiguousKeys: number[] = [];
  const droppedFrontMatter: number[] = [];
  let withOptions = 0;
  let withAnswers = 0;
  let confidenceSum = 0;
  const sectionPoints = new Map<Section, number[]>();

  blocks.forEach((block, index) => {
    const parsed = parseBlock(block, columnMarks);
    let prompt = parsed.prompt;
    if (!prompt || prompt.length < 3) return;
    if (isFrontMatter(block, parsed, sections.length > 0)) {
      droppedFrontMatter.push(block.number);
      return;
    }

    const section = block.section;
    const rules = [...(section ? sectionRanges.get(section) ?? [] : []), ...(scopeCount === 1 ? paperRanges : [])];
    const range = rules.find((r) => block.number >= r.from && block.number <= r.to) ?? null;
    const notes = [...parsed.notes];

    // ── marks: question → sub-parts → instructions → section → default
    let points = parsed.points;
    let marksSource: MarksSource | null = parsed.marksSource;
    if (points === null && range?.marks) {
      points = range.marks;
      marksSource = 'instructions';
    }
    if (points === null && section) {
      const fromSection = sectionMarks(section);
      if (fromSection) {
        points = fromSection;
        marksSource = 'section';
      }
    }

    // ── format: structure first, then the heading / instructions, then wording and marks
    const optionTexts = parsed.options.map((o) => o.text);
    const hint = range?.typeHint ?? section?.typeHint ?? null;
    const tfCue = TF_CUE.test(prompt) || TF_CUE_UPPER.test(prompt);
    let type: QuestionType;
    if (optionTexts.length >= 2) type = isTrueFalseOptions(optionTexts) ? 'truefalse' : 'mcq';
    else if (tfCue) type = 'truefalse';
    else if (STRONG_BLANK.test(prompt)) type = 'fill';
    else if (hint && hint !== 'mcq') type = hint;
    else if (WEAK_BLANK.test(prompt)) type = 'fill';
    else type = writtenType(prompt, points, section?.objective ?? false);
    if (hint === 'mcq' && optionTexts.length < 2) {
      mcqWithoutOptions.push(block.number);
      notes.push('The paper lists this as multiple choice, but no options were found');
    } else if (hint && hint !== type && optionTexts.length < 2) {
      notes.push(`Section heading says ${TYPE_LABEL[hint]}; detected ${TYPE_LABEL[type]} from the question itself`);
    }

    if (points === null) {
      points = defaultPoints(type);
      marksSource = 'default';
      defaulted.push(block.number);
      notes.push(`Marks not stated in the paper, defaulted to ${points}`);
    }

    if (type === 'truefalse') prompt = prompt.replace(TF_TAIL, '').trim() || prompt;

    // ── answer key: inline answer → answer-key block → ✓ on an option
    const fromKeyBlock = keyFor(index, block.number);
    if (fromKeyBlock.ambiguous && !parsed.answer) {
      ambiguousKeys.push(block.number);
      notes.push(`The answer key has more than one entry for ${block.number}; set the answer by hand`);
    }
    const keyText = parsed.answer ?? fromKeyBlock.value;
    const markedIndexes = parsed.options.map((o, i) => (o.marked ? i : -1)).filter((i) => i >= 0);
    const marked = markedIndexes.length === 1 ? markedIndexes[0] : null;

    let options: string[] = optionTexts;
    let correctOptionIndex: number | null = null;
    let acceptedAnswers: string[] = [];

    if (type === 'mcq') {
      if (keyText) {
        correctOptionIndex = optionIndexFromKey(keyText, optionTexts, parsed.optionKind);
        if (correctOptionIndex === null) notes.push(`Answer key "${keyText.slice(0, 60)}" could not be matched to an option`);
      }
      if (correctOptionIndex === null && marked !== null) correctOptionIndex = marked;
      if (correctOptionIndex === null && !keyText) notes.push('No answer key found; mark the correct option manually');
    } else if (type === 'truefalse') {
      let truth: boolean | null = keyText ? truthFromKey(keyText, optionTexts) : null;
      if (truth === null && marked !== null && optionTexts.length === 2) truth = isTrueWord(optionTexts[marked]);
      if (keyText && truth === null) notes.push(`Answer key "${keyText.slice(0, 60)}" is not True or False`);
      if (!keyText && truth === null) notes.push('No answer key found; pick True or False manually');
      options = ['True', 'False'];
      correctOptionIndex = truth === null ? null : truth ? 0 : 1;
    } else {
      options = [];
      if (keyText) {
        const flat = keyText.replace(/\n/g, ' ').replace(/[,;]+\s*$/, '');
        if (type === 'fill') acceptedAnswers = boundAnswers(splitAlternatives(stripLabel(flat)));
        else if (type === 'short') acceptedAnswers = boundAnswers([stripLabel(flat)]);
        else acceptedAnswers = boundAnswers(keyPoints(keyText).map(stripLabel)); // long: one key point per line
      } else if (type === 'fill') {
        notes.push('No answer key found; add accepted answers for auto-grading');
      } else {
        notes.push('No model answer found; the AI marks from the question alone (or a teacher reviews it)');
      }
    }

    const instructions = [section?.text ?? '', section?.inheritedText ?? '', range?.text ?? ''].join(' ').trim();
    const minAnswerWords = defaultMinAnswerWords({ type, points, prompt, acceptedAnswers }, instructions);

    if (type === 'mcq') withOptions += 1;
    if (keyText || marked !== null) withAnswers += 1;

    let score = 1;
    if ((type === 'mcq' || type === 'truefalse') && correctOptionIndex === null) score -= 0.4;
    if (type === 'fill' && !acceptedAnswers.length) score -= 0.3;
    if (marksSource === 'default') score -= 0.2;
    if (hint === 'mcq' && optionTexts.length < 2) score -= 0.3;
    if (notes.length > 2) score -= 0.1;
    const confidence: ParsedQuestion['confidence'] = score >= 0.85 ? 'high' : score >= 0.55 ? 'medium' : 'low';
    confidenceSum += confidence === 'high' ? 1 : confidence === 'medium' ? 0.6 : 0.3;

    questions.push({
      number: block.number,
      prompt,
      type,
      options,
      correctOptionIndex,
      acceptedAnswers,
      points,
      marksSource: marksSource ?? 'default',
      minAnswerWords,
      explanation: parsed.explanation,
      timerSeconds: estimateTimer(type, points),
      confidence,
      notes,
      raw: [String(block.number), ...block.lines].join('\n'),
      section: section ? section.text.slice(0, 160) : null
    });
    if (section) sectionPoints.set(section, [...(sectionPoints.get(section) ?? []), points]);
  });

  // ── paper-level review hints
  const header = preambleText;
  const titleMatch =
    /(mid[- ]?term|final|unit\s*test|model|practice|sample|question\s*paper|annual|half[- ]yearly|pre[- ]board)[^.\n]{0,60}/i.exec(header);
  const cleanTitle = titleMatch?.[0]
    ?.split(/\b(?:time|maximum|max|instructions?|m\.\s*m)\b/i)[0]
    .replace(/[\s,:;-]+$/, '')
    .trim();
  const timeMatch = /time\s*(?:allowed)?\s*[:\-]?\s*([0-9.]+\s*(?:hours?|hrs?|minutes?|mins?))/i.exec(header);
  const marksMatch = /(?:max(?:imum)?\.?\s*marks?|m\.\s*m\.?|total\s+marks|full\s+marks)\s*[:\-]?\s*(\d{1,4})/i.exec(header);
  const totalMarks = questions.reduce((total, q) => total + q.points, 0);

  if (!questions.length) {
    warnings.push(
      'No numbered questions were detected. Make sure each question starts with a number (1., 2) or Q1) — or paste the questions as text.'
    );
  }
  const missingKey = questions.filter(
    (q) =>
      ((q.type === 'mcq' || q.type === 'truefalse') && q.correctOptionIndex === null) ||
      (q.type === 'fill' && q.acceptedAnswers.length === 0)
  );
  if (missingKey.length && withAnswers === 0) {
    warnings.push(
      `This file has no answer key, so ${missingKey.length} MCQ / True-False / fill-in question(s) cannot be graded yet (${listNumbers(missingKey.map((q) => q.number))}). ` +
        'Add an "Answer Key" section at the end of the paper (for example: Answer Key: 1-c, 2-d, 11-hardware, 16-False) and upload again, or set each answer with Edit.'
    );
  } else if (missingKey.length) {
    warnings.push(
      `${missingKey.length} MCQ / True-False / fill-in question(s) have no detectable answer key (${listNumbers(missingKey.map((q) => q.number))}). Set the answer with Edit before publishing.`
    );
  }
  if (defaulted.length) {
    warnings.push(
      `Marks were not stated for ${listNumbers(defaulted)}, so default points were used (1 objective, 2 short, 5 long). Check them before publishing.`
    );
  }
  if (mcqWithoutOptions.length) {
    warnings.push(`${listNumbers(mcqWithoutOptions)} sit under a multiple-choice heading, but no options were found. Add the options.`);
  }
  if (ambiguousKeys.length) {
    warnings.push(
      `The answer key could not be matched for ${listNumbers([...new Set(ambiguousKeys)])} because question numbers repeat. Set those answers by hand.`
    );
  }
  // "Attempt any FIVE of six": a student answers only that many, so the paper's
  // maximum is compared with the marks a student can actually attempt.
  let attemptable = totalMarks;
  const choices: string[] = [];
  for (const [section, points] of sectionPoints) {
    const count = attemptCount(section.text);
    if (!count || count >= points.length) continue;
    const kept = [...points].sort((a, b) => b - a).slice(0, count);
    attemptable -= points.reduce((t, p) => t + p, 0) - kept.reduce((t, p) => t + p, 0);
    choices.push(`${section.label ? `Section ${section.label}` : 'a section'}: ${count} of ${points.length}`);
  }
  const statedMax = marksMatch ? Number(marksMatch[1]) : null;
  if (statedMax && questions.length && Math.abs(statedMax - attemptable) > 0.01) {
    const choiceNote = choices.length ? ` (${attemptable} counting only the questions to attempt: ${choices.join(', ')})` : '';
    warnings.push(
      `Extracted questions add up to ${totalMarks} marks${choiceNote}, but the paper says ${statedMax}. Check for missed questions, internal choices ("OR") or wrong marks.`
    );
  }
  if (questions.length && withOptions === 0 && !questions.some((q) => q.type === 'truefalse')) {
    warnings.push('No options were detected, so every item was treated as a written-answer or fill-in question.');
  }
  if (key.entries) warnings.push(`Answer key block found with ${key.entries} entries and merged into the questions.`);
  if (droppedFrontMatter.length) {
    warnings.push(
      `Skipped ${droppedFrontMatter.length} numbered line(s) from the instructions / marking scheme that are not questions.`
    );
  }

  return {
    questions,
    warnings,
    stats: {
      detected: questions.length,
      withOptions,
      withAnswers,
      averageConfidence: questions.length ? Number((confidenceSum / questions.length).toFixed(2)) : 0,
      totalMarks,
      marksFromPaper: questions.filter((q) => q.marksSource !== 'default').length
    },
    meta: {
      title: cleanTitle || null,
      timeLimit: timeMatch?.[1]?.trim() ?? null,
      maxMarks: marksMatch?.[1]?.trim() ?? null
    }
  };
}
