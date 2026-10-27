import type { QuestionType } from '../shared/types';

/**
 * Question-paper parser.
 *
 * Turns raw text pulled out of a PDF / DOCX / OCR'd image into structured,
 * import-ready questions. Deliberately heuristic (papers are wildly
 * inconsistent) — every item carries a confidence score and review notes so
 * the teacher can fix the few lines the machine got wrong.
 */

export interface ParsedQuestion {
  number: number;
  prompt: string;
  type: QuestionType;
  options: string[];
  correctOptionIndex: number | null;
  acceptedAnswers: string[];
  points: number;
  timerSeconds: number;
  confidence: 'high' | 'medium' | 'low';
  notes: string[];
  raw: string;
}

export interface ParseResult {
  questions: ParsedQuestion[];
  warnings: string[];
  stats: {
    detected: number;
    withOptions: number;
    withAnswers: number;
    averageConfidence: number;
  };
  meta: { title: string | null; timeLimit: string | null; maxMarks: string | null };
}

const OPTION_LETTER = /^\s*[\(\[]?\s*([a-hA-H])\s*[\)\].:\-–]\s+(.+)$/;
const ROMAN = /^\s*[\(\[]?\s*(i{1,3}|iv|v|vi{0,3})\s*[\)\].:\-–]\s+(.+)$/i;
const QUESTION_START =
  /^\s*(?:Q(?:uestion)?\s*[\.:\-]?\s*)?(\d{1,3})\s*[\.\)\:\-–]\s*(.+)$/i;
const ANSWER_LINE =
  /^\s*(?:ans(?:wer)?|correct\s*(?:answer|option)|sol(?:ution)?)\s*[:\-–\.]?\s*(.+)$/i;
const MARKS = /(?:[\(\[]\s*(\d{1,3})\s*(?:marks?|mks?|pts?|points?)\s*[\)\]]|\(\s*(\d{1,3})\s*\)\s*$|\b(\d{1,3})\s*(?:marks?|mks?)\b)/i;
const NOISE =
  /^(?:page\s*\d+(?:\s*(?:of|\/)\s*\d+)?|\d+\s*\|\s*page|https?:\/\/\S+|www\.\S+)$/i;

const LONG_HINT =
  /\b(derive|prove|show\s+that|explain\s+in\s+detail|discuss|describe\s+the|calculate|determine\s+the|evaluate|justify|illustrate|design|write\s+short\s+notes)\b/i;

export function normaliseText(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2022|\u25cf|\u25aa|\u00b7/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\f/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
}

function cleanLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

/** Re-join words hyphenated across a line break ("station-\nary" → "stationary"). */
function joinHyphenated(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev !== undefined && /[a-z]-$/.test(prev) && /^[a-z]/.test(line.trim())) {
      out[out.length - 1] = prev.replace(/-$/, '') + line.trim();
    } else if (prev !== undefined && prev.trim() && !/[.!?:;)\]]$/.test(prev.trim()) && /^[a-z(,]/.test(line.trim()) && line.trim().length > 2 && !OPTION_LETTER.test(line)) {
      // wrapped sentence inside a paragraph
      out[out.length - 1] = `${prev.trim()} ${line.trim()}`;
    } else {
      out.push(line);
    }
  }
  return out;
}

function extractMarks(text: string): { points: number | null; cleaned: string } {
  const match = MARKS.exec(text);
  if (!match) return { points: null, cleaned: text };
  const raw = match[1] ?? match[2] ?? match[3];
  const points = raw ? Number(raw) : null;
  const cleaned = text
    .replace(/[\(\[]\s*\d{1,3}\s*(?:marks?|mks?|pts?|points?)\s*[\)\]]/gi, ' ')
    .replace(/\b\d{1,3}\s*(?:marks?|mks?)\b/gi, ' ')
    .replace(/\(\s*\d{1,3}\s*\)\s*$/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { points: points && points > 0 && points <= 100 ? points : null, cleaned };
}

function isTrueFalseOptions(options: string[]): boolean {
  if (options.length !== 2) return false;
  const norm = options.map((o) => o.toLowerCase().replace(/[^a-z]/g, ''));
  return (
    (norm[0].startsWith('true') && norm[1].startsWith('false')) ||
    (norm[0].startsWith('false') && norm[1].startsWith('true'))
  );
}

interface RawBlock {
  number: number;
  lines: string[];
}

/** Split the paper into per-question blocks. */
function splitBlocks(lines: string[]): { blocks: RawBlock[]; preamble: string[] } {
  const blocks: RawBlock[] = [];
  const preamble: string[] = [];
  let current: RawBlock | null = null;
  let expected = 1;

  for (const rawLine of lines) {
    const line = cleanLine(rawLine);
    if (!line) {
      if (current) current.lines.push('');
      continue;
    }
    if (NOISE.test(line)) continue;

    const start = QUESTION_START.exec(line);
    if (start) {
      const n = Number(start[1]);
      const rest = start[2];
      const isSequential = n === expected || n === expected + 1 || (n === 1 && (current === null || expected > 4));
      // A numbered line only opens a question if it is in sequence and has substance
      if (isSequential && rest.trim().length > 3 && !OPTION_LETTER.test(line)) {
        if (current) blocks.push(current);
        current = { number: n, lines: [rest.trim()] };
        expected = n + 1;
        continue;
      }
    }

    if (current) current.lines.push(line);
    else preamble.push(line);
  }
  if (current) blocks.push(current);
  return { blocks, preamble };
}

/** Pull a global "Answer Key: 1-A, 2-B ..." section out of the paper. */
function extractAnswerKey(lines: string[]): {
  map: Map<number, string>;
  remaining: string[];
} {
  const map = new Map<number, string>();
  const remaining: string[] = [];
  let inKeyBlock = false;

  for (const line of lines) {
    const isKeyHeader = /^\s*(answer\s*key|answers?\s*(?:key)?\s*[:\-–]|key\s*[:\-–])/i.test(line);
    if (isKeyHeader || (inKeyBlock && /^\s*(answer\s*key|answers?\s*[:\-–])/i.test(line))) {
      inKeyBlock = true;
    }
    if (!inKeyBlock) {
      remaining.push(line);
      continue;
    }
    if (NOISE.test(line.trim()) || /page\s*\d+\s*(?:of|\/)?\s*\d*/i.test(line)) continue;
    // pairs like "1-A", "2. (b)", "3 - True", "4: azimuthal"
    const pairRe = /(\d{1,3})\s*[-.):–]?\s*(\(?\s*(?:[a-hA-H]|true|false|[^,;\n]{1,48}?)\s*\)?)(?=\s*(?:,|;|\n|$|\d{1,3}\s*[-.):–]))/g;
    let m: RegExpExecArray | null;
    let found = false;
    while ((m = pairRe.exec(line)) !== null) {
      const n = Number(m[1]);
      const value = m[2].replace(/[()]/g, '').trim();
      if (n > 0 && n < 500 && value) {
        map.set(n, value);
        found = true;
      }
    }
    // free-floating letters after a "key:" header, e.g. "1-a 2-c 3-b"
    if (!found) {
      const compact = /(\d{1,3})\s*[-.):–]?\s*([a-hA-H])\b/g;
      let c: RegExpExecArray | null;
      while ((c = compact.exec(line)) !== null) {
        map.set(Number(c[1]), c[2].toUpperCase());
      }
    }
    // keep the line in remaining if it clearly isn't a key (fallback safety)
    if (!found && /[a-z]{4,}/i.test(line.replace(/answer\s*key|answers?/gi, ''))) {
      remaining.push(line);
    }
  }
  return { map, remaining };
}

function optionIndexFromKey(key: string, options: string[]): number | null {
  const trimmed = key.trim();
  const letter = /^[\(\[]?\s*([a-hA-H])\s*[\)\]]?$/.exec(trimmed);
  if (letter) {
    const idx = letter[1].toLowerCase().charCodeAt(0) - 97;
    return idx < options.length ? idx : null;
  }
  const numberIdx = /^[\(\[]?\s*([1-9])\s*[\)\]]?$/.exec(trimmed);
  if (numberIdx) {
    const idx = Number(numberIdx[1]) - 1;
    return idx < options.length ? idx : null;
  }
  if (/^true$/i.test(trimmed)) return options.findIndex((o) => /true/i.test(o));
  if (/^false$/i.test(trimmed)) return options.findIndex((o) => /false/i.test(o));
  // text match against the option bodies
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = norm(trimmed);
  if (target.length >= 3) {
    const exact = options.findIndex((o) => norm(o) === target);
    if (exact >= 0) return exact;
    const partial = options.findIndex((o) => {
      const candidate = norm(o);
      return candidate.length > 3 && (candidate.includes(target) || target.includes(candidate));
    });
    if (partial >= 0) return partial;
  }
  return null;
}

function inferType(
  prompt: string,
  options: string[],
  points: number,
  hasBlanks: boolean
): QuestionType {
  if (options.length >= 2) return isTrueFalseOptions(options) ? 'truefalse' : 'mcq';
  if (hasBlanks) return 'fill';
  const words = prompt.split(/\s+/).filter(Boolean).length;
  if (points >= 8 || words > 42 || LONG_HINT.test(prompt)) return 'long';
  return 'short';
}

function estimateTimer(type: QuestionType, points: number): number {
  const base: Record<QuestionType, number> = {
    mcq: 45,
    truefalse: 25,
    fill: 30,
    short: 75,
    long: 210
  };
  const typicalPoints: Record<QuestionType, number> = {
    mcq: 4,
    truefalse: 2,
    fill: 2,
    short: 5,
    long: 10
  };
  const scaled = base[type] * (points / typicalPoints[type]);
  return Math.max(20, Math.min(600, Math.round(scaled / 5) * 5));
}

function defaultPoints(type: QuestionType): number {
  if (type === 'long') return 10;
  if (type === 'short') return 5;
  return 2;
}

export function parseQuestionPaper(rawText: string): ParseResult {
  const text = normaliseText(rawText);
  const allLines = text.split('\n');
  const { map: keyMap, remaining } = extractAnswerKey(allLines);
  const lines = joinHyphenated(remaining);
  const { blocks, preamble } = splitBlocks(lines);

  const warnings: string[] = [];
  const questions: ParsedQuestion[] = [];
  let withOptions = 0;
  let withAnswers = 0;
  let confidenceSum = 0;

  for (const block of blocks) {
    const notes: string[] = [];
    const raw = [String(block.number), ...block.lines].join('\n');
    let promptParts: string[] = [];
    const options: string[] = [];
    let keyText: string | null = keyMap.get(block.number) ?? null;
    let marks: number | null = null;

    for (const line of block.lines) {
      if (!line) continue;

      // 1) explicit answer/solution line inside the block
      const ansMatch = ANSWER_LINE.exec(line);
      if (ansMatch) {
        keyText = ansMatch[1].trim();
        continue;
      }

      // 2) option line
      const optMatch = OPTION_LETTER.exec(line);
      if (optMatch && options.length < 8) {
        const letter = optMatch[1].toLowerCase();
        const expectedLetter = String.fromCharCode(97 + options.length);
        if (letter === expectedLetter || options.length === 0) {
          const { points, cleaned } = extractMarks(optMatch[2]);
          if (points && !marks) marks = points;
          options.push(cleaned.trim());
          continue;
        }
      }

      // 3) inline options on a single line: "A) x B) y C) z D) w"
      const inline = line.match(/(?:^|\s)[\(\[]?([a-hA-H])[\)\].]\s+/g);
      if (!options.length && inline && inline.length >= 2) {
        const parts = line.split(/\s*(?=[\(\[]?[a-hA-H][\)\].]\s+)/).filter(Boolean);
        const parsed = parts
          .map((p) => OPTION_LETTER.exec(p.trim()))
          .filter((m): m is RegExpExecArray => !!m);
        if (parsed.length >= 2) {
          parsed.forEach((m) => {
            const { cleaned } = extractMarks(m[2]);
            options.push(cleaned.trim());
          });
          continue;
        }
      }

      // 4) roman-numeral options
      const romanMatch = ROMAN.exec(line);
      if (romanMatch && options.length >= 0) {
        const expectedRoman = ['i', 'ii', 'iii', 'iv', 'v', 'vi'][options.length];
        if (romanMatch[1].toLowerCase() === expectedRoman) {
          options.push(romanMatch[2].trim());
          continue;
        }
      }

      // 5) otherwise it is prompt text
      const { points, cleaned } = extractMarks(line);
      if (points && !marks) marks = points;
      if (cleaned.trim()) promptParts.push(cleaned.trim());
    }

    let prompt = promptParts.join(' ').replace(/\s{2,}/g, ' ').trim();
    prompt = prompt.replace(/^[\-–•]\s*/, '');

    // Trailing "(2)" style marks already stripped above. Drop stray trailing punctuation noise.
    prompt = prompt.replace(/\s+([,.;:])$/, '$1');

    if (!prompt || prompt.length < 3) continue;

    const hasBlanks = /_{3,}|\.{3,}\s*$|\[\s*\]/m.test(prompt);
    const asksTrueFalse =
      options.length < 2 &&
      /\btrue\s*(?:or|\/)\s*false\b|\bstate whether\b[^.]*\btrue\b|\btick\s+(?:true|false)\b/i.test(prompt);
    const type: QuestionType = asksTrueFalse
      ? 'truefalse'
      : inferType(prompt, options, marks ?? defaultPoints('long'), hasBlanks);
    const points = marks ?? defaultPoints(type);

    let correctOptionIndex: number | null = null;
    const acceptedAnswers: string[] = [];
    let explanation = '';

    if (type === 'mcq' || type === 'truefalse') {
      if (keyText) {
        correctOptionIndex = optionIndexFromKey(keyText, type === 'truefalse' && options.length < 2 ? ['True', 'False'] : options);
        if (correctOptionIndex === null) notes.push(`Answer key "${keyText}" could not be matched to an option`);
      } else {
        notes.push('No answer key found — mark the correct option manually');
      }
    } else if (keyText) {
      if (type === 'long') {
        explanation = `Expected answer: ${keyText}`;
        notes.push('Long answer — queued for manual review');
      } else {
        acceptedAnswers.push(keyText.replace(/^[a-hA-H]\s*[\)\].]\s*/, '').trim());
      }
    } else if (type !== 'long') {
      notes.push('No answer key found — add accepted answers for auto-grading');
    }

    const finalOptions =
      type === 'truefalse' && options.length < 2 ? ['True', 'False'] : options;
    if (type === 'truefalse' && correctOptionIndex === null && keyText) {
      correctOptionIndex = /true/i.test(keyText) ? 0 : /false/i.test(keyText) ? 1 : null;
    }

    if (finalOptions.length > 0) withOptions += 1;
    if (keyText) withAnswers += 1;

    const confidence: ParsedQuestion['confidence'] =
      (type === 'mcq' || type === 'truefalse') && correctOptionIndex === null
        ? 'medium'
        : options.length > 0 && !keyText
          ? 'medium'
          : notes.length > 1
            ? 'low'
            : 'high';
    confidenceSum += confidence === 'high' ? 1 : confidence === 'medium' ? 0.6 : 0.3;

    questions.push({
      number: block.number,
      prompt,
      type,
      options: finalOptions,
      correctOptionIndex,
      acceptedAnswers,
      points,
      timerSeconds: estimateTimer(type, points),
      confidence,
      notes: [...notes, ...(explanation ? [explanation] : [])],
      raw
    });
  }

  if (!questions.length) {
    warnings.push(
      'No numbered questions were detected. Make sure each question starts with a number (1., 2) or Q1) — or paste the questions as text.'
    );
  }
  const missingKey = questions.filter((q) => (q.type === 'mcq' || q.type === 'truefalse') && q.correctOptionIndex === null).length;
  if (missingKey) warnings.push(`${missingKey} objective question(s) have no detectable answer key — review the highlighted options.`);
  if (questions.length && withOptions === 0) warnings.push('No options were detected — every item was treated as a written-answer question.');
  if (keyMap.size) warnings.push(`Answer key block found with ${keyMap.size} entries and merged into the questions.`);

  const header = preamble.join(' ');
  const titleMatch = /(mid[- ]?term|final|unit\s*test|model|practice|sample|question\s*paper)[^.\n]{0,60}/i.exec(header);
  const cleanTitle = titleMatch?.[0]
    ?.split(/\b(?:time|maximum|max|instructions?)\b/i)[0]
    .replace(/[\s,:;-]+$/, '')
    .trim();
  const timeMatch = /time\s*[:\-]?\s*([0-9]+\s*(?:hours?|hrs?|minutes?|mins?))/i.exec(header);
  const marksMatch = /max(?:imum)?\s*marks?\s*[:\-]?\s*(\d{1,4})/i.exec(header);

  return {
    questions,
    warnings,
    stats: {
      detected: questions.length,
      withOptions,
      withAnswers,
      averageConfidence: questions.length ? Number((confidenceSum / questions.length).toFixed(2)) : 0
    },
    meta: {
      title: cleanTitle || null,
      timeLimit: timeMatch?.[1]?.trim() ?? null,
      maxMarks: marksMatch?.[1]?.trim() ?? null
    }
  };
}
