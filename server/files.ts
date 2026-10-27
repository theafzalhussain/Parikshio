import path from 'node:path';
import os from 'node:os';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import type { PaperKind } from '../shared/types';

export interface TextExtraction {
  kind: PaperKind;
  text: string;
  ocrUsed: boolean;
  pages?: number;
  warnings: string[];
  durationMs: number;
}

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB

const IMAGE_EXT = /\.(png|jpe?g|webp|bmp|tiff?)$/i;

export function kindForFile(fileName: string, mime = ''): PaperKind | null {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.pdf' || mime === 'application/pdf') return 'pdf';
  if (ext === '.docx' || mime.includes('officedocument.wordprocessingml')) return 'docx';
  if (IMAGE_EXT.test(ext) || mime.startsWith('image/')) return 'image';
  if (ext === '.txt' || ext === '.md' || mime.startsWith('text/')) return 'text';
  return null;
}

/**
 * Lazily created, reused Tesseract worker for image / photo question papers.
 * Language data is fetched once and cached on disk.
 */
let ocrWorker: Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>> | null = null;

async function getOcrWorker() {
  if (ocrWorker) return ocrWorker;
  const { createWorker } = await import('tesseract.js');
  ocrWorker = await createWorker('eng', 1, {
    cachePath: path.join(os.tmpdir(), 'axiom-tesseract'),
    // keep the worker quiet in server logs
    logger: () => undefined
  });
  return ocrWorker;
}

/**
 * PDF text extraction.
 * pdfjs-dist rebuilds real lines from glyph positions (which the parser needs),
 * and pdf-parse stays as a fallback for the handful of PDFs pdfjs rejects.
 */
async function extractPdfModern(buffer: Buffer): Promise<{ text: string; pages: number }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    isEvalSupported: false,
    verbosity: 0
  }).promise;

  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const rows = new Map<number, { x: number; text: string }[]>();
    for (const raw of content.items as unknown[]) {
      const item = raw as { str?: string; transform?: number[] };
      if (typeof item.str !== 'string' || !item.transform) continue;
      const y = Math.round(item.transform[5] / 2) * 2; // tolerate sub-pixel baseline jitter
      const bucket = rows.get(y) ?? [];
      bucket.push({ x: item.transform[4], text: item.str });
      rows.set(y, bucket);
    }
    const ordered = [...rows.entries()].sort((a, b) => b[0] - a[0]);
    pages.push(
      ordered
        .map(([, items]) =>
          items
            .sort((a, b) => a.x - b.x)
            .map((i) => i.text)
            .join('')
            .replace(/\s+$/, '')
        )
        .filter((line) => line.trim())
        .join('\n')
    );
    page.cleanup();
  }
  await doc.destroy();
  return { text: pages.join('\n\n'), pages: doc.numPages };
}

async function extractPdf(buffer: Buffer): Promise<TextExtraction> {
  const started = Date.now();
  const warnings: string[] = [];
  let text = '';
  let pages: number | undefined;

  try {
    const modern = await extractPdfModern(buffer);
    text = modern.text;
    pages = modern.pages;
  } catch {
    try {
      const data = await pdfParse(buffer);
      text = data.text ?? '';
      pages = data.numpages;
      warnings.push('Parsed with the fallback PDF reader — check line breaks in the extracted questions.');
    } catch (err) {
      warnings.push(
        `This PDF could not be read (${(err as Error).message.slice(0, 90)}). Export it again as PDF, or upload page images (OCR) instead.`
      );
    }
  }

  const meaningful = text.replace(/\s/g, '').length;
  if (meaningful < 60) {
    warnings.push(
      'This PDF has almost no text layer — it looks like a scan or photos. Upload the page images instead (OCR will run) or paste the questions as text.'
    );
  }
  return { kind: 'pdf', text, ocrUsed: false, pages, warnings, durationMs: Date.now() - started };
}

async function extractDocx(buffer: Buffer): Promise<TextExtraction> {
  const started = Date.now();
  const result = await mammoth.extractRawText({ buffer });
  const warnings: string[] = [];
  if ((result.value ?? '').replace(/\s/g, '').length < 40) {
    warnings.push('No readable text found in this document. If it contains images of a paper, upload the images instead.');
  }
  return {
    kind: 'docx',
    text: result.value ?? '',
    ocrUsed: false,
    warnings,
    durationMs: Date.now() - started
  };
}

async function extractImage(buffer: Buffer, fileName: string): Promise<TextExtraction> {
  const started = Date.now();
  const warnings: string[] = [];
  try {
    const worker = await getOcrWorker();
    const { data } = await worker.recognize(buffer);
    const text = data.text ?? '';
    if (text.replace(/\s/g, '').length < 30) {
      warnings.push('OCR could not read much from this image. Try a sharper scan, better lighting, or paste the text.');
    } else {
      warnings.push('Text was read with OCR — check numbers, symbols and equations carefully before pushing.');
    }
    return {
      kind: 'image',
      text,
      ocrUsed: true,
      warnings,
      durationMs: Date.now() - started
    };
  } catch (err) {
    warnings.push(
      `OCR engine unavailable (${(err as Error).message.slice(0, 80)}). Copy the text from your paper and use the "Paste text" tab instead.`
    );
    return {
      kind: 'image',
      text: '',
      ocrUsed: true,
      warnings,
      durationMs: Date.now() - started
    };
  }
}

export async function extractTextFromFile(
  buffer: Buffer,
  fileName: string,
  mime = ''
): Promise<TextExtraction> {
  const kind = kindForFile(fileName, mime);
  if (!kind) {
    return {
      kind: 'text',
      text: '',
      ocrUsed: false,
      warnings: [`Unsupported file type for "${fileName}". Upload a PDF, DOCX, image (PNG/JPG) or plain text file.`],
      durationMs: 0
    };
  }
  if (kind === 'pdf') return extractPdf(buffer);
  if (kind === 'docx') return extractDocx(buffer);
  if (kind === 'image') return extractImage(buffer, fileName);
  return {
    kind: 'text',
    text: buffer.toString('utf8'),
    ocrUsed: false,
    warnings: [],
    durationMs: 0
  };
}

export const SUPPORTED_LABEL = 'PDF · DOCX · PNG/JPG · TXT';
