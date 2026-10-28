import type { Exam, Paper, Question, Response } from '../shared/types';
import { parseQuestionPaper } from './extract';
import { gradeAnswer } from '../shared/grade';
import { hashPassword } from './auth';
import { isProd } from './config';
import { DEMO_ACCOUNT_EMAILS } from './demoAccounts';
import { store, uid } from './store';
import { persist } from './mongo';

const author = 'usr_admin';

function q(partial: Omit<Question, 'id' | 'createdAt' | 'createdBy'>): Question {
  return { ...partial, id: uid('q_'), createdAt: Date.now() - Math.random() * 6.4e9, createdBy: author };
}

function mcq(
  prompt: string,
  options: string[],
  correct: number,
  topic: string,
  difficulty: Question['difficulty'],
  points: number,
  timerSeconds: number,
  explanation: string
): Question {
  return q({
    type: 'mcq',
    prompt,
    topic,
    difficulty,
    options,
    correctOptionIndex: correct,
    acceptedAnswers: [],
    points,
    timerSeconds,
    explanation
  });
}

function tf(prompt: string, correct: boolean, topic: string, points: number, timerSeconds: number, explanation: string) {
  return q({
    type: 'truefalse',
    prompt,
    topic,
    difficulty: 'easy',
    options: ['True', 'False'],
    correctOptionIndex: correct ? 0 : 1,
    acceptedAnswers: [],
    points,
    timerSeconds,
    explanation
  });
}

function text(
  type: 'fill' | 'short' | 'long',
  prompt: string,
  acceptedAnswers: string[],
  topic: string,
  difficulty: Question['difficulty'],
  points: number,
  timerSeconds: number,
  explanation: string
): Question {
  return q({
    type,
    prompt,
    topic,
    difficulty,
    options: [],
    correctOptionIndex: null,
    acceptedAnswers,
    points,
    timerSeconds,
    explanation
  });
}


const SAMPLE_PAPER_TEXT = `ST. XAVIER'S COLLEGE OF SCIENCE
Unit Test 2 — Cell Biology (BIO-211)
Time: 45 minutes                                Max Marks: 25
Instructions: Attempt all questions. Marks are indicated against each question.

1. Which organelle is the primary site of ATP synthesis in a eukaryotic cell? [2 marks]
   A) Ribosome
   B) Mitochondrion
   C) Golgi apparatus
   D) Lysosome

2. During which phase of mitosis do sister chromatids separate and move to opposite poles? [2 marks]
   A) Prophase
   B) Metaphase
   C) Anaphase
   D) Telophase

3. Osmosis is the movement of water across a semi-permeable membrane from a region of higher water potential to lower water potential. State whether this statement is true or false. [1 mark]

4. The organelle responsible for packaging and secreting proteins out of the cell is the ______. [2 marks]

5. Explain why the fluid mosaic model describes the plasma membrane better than the earlier sandwich model. [4 marks]

6. Describe the complete process of aerobic respiration, naming each stage, the site where it occurs and the net ATP yield per glucose molecule. [10 marks]

7. A cell with 24 chromosomes undergoes meiosis. Calculate the number of chromosomes in each daughter cell after meiosis I and after meiosis II. [4 marks]

Answer Key: 1-B, 2-C, 3-True, 4-Golgi apparatus, 7-12 after meiosis I and 12 after meiosis II
`;

/**
 * Seeds one already-imported paper so the upload → extract → panel flow is
 * visible immediately, and doubles as a regression fixture for the parser.
 */
function seedSamplePaper(): void {
  const parsed = parseQuestionPaper(SAMPLE_PAPER_TEXT);
  if (!parsed.questions.length) return;

  const paperId = uid('pap_');
  const name = 'Unit Test 2 — Cell Biology (uploaded PDF)';
  const created: Question[] = parsed.questions.map((q, index) => ({
    id: uid('q_'),
    type: q.type,
    prompt: q.prompt,
    topic: 'Cell Biology',
    difficulty: q.points >= 8 ? 'hard' : q.points >= 4 ? 'medium' : 'easy',
    options: q.options,
    correctOptionIndex: q.correctOptionIndex,
    acceptedAnswers: q.acceptedAnswers,
    points: q.points,
    timerSeconds: q.timerSeconds,
    explanation: '',
    createdBy: author,
    createdAt: Date.now() - 36 * 3600 * 1000 + index * 1000,
    sourcePaperId: paperId,
    sourcePaperName: name,
    sourceIndex: q.number || index + 1
  }));

  store.questions.push(...created);
  created.forEach((question) =>
    persist('questions', question as unknown as { id: string } & Record<string, unknown>)
  );

  const paper: Paper = {
    id: paperId,
    name,
    fileName: 'cell-biology-unit-test-2.pdf',
    kind: 'pdf',
    sizeBytes: 184_320,
    uploadedBy: author,
    uploadedByName: 'Dr. Meera Sharma',
    uploadedAt: Date.now() - 36 * 3600 * 1000,
    meta: parsed.meta,
    stats: parsed.stats,
    warnings: parsed.warnings,
    previewText: SAMPLE_PAPER_TEXT.slice(0, 4000),
    textLength: SAMPLE_PAPER_TEXT.length,
    ocrUsed: false,
    questionIds: created.map((q) => q.id)
  };
  store.papers.push(paper);
  persist('papers', paper as unknown as { id: string } & Record<string, unknown>);
}

export function seedIfEmpty(): void {
  if (isProd) return;
  if (store.users.length > 0) return;

  const now = Date.now();
  const users = [
    { name: 'Dr. Meera Sharma', email: DEMO_ACCOUNT_EMAILS.admin, role: 'admin' as const, org: 'Axiom Institute of Technology', password: 'admin123' },
    { name: 'Faculty · Rohan Deshpande', email: DEMO_ACCOUNT_EMAILS.faculty, role: 'admin' as const, org: 'Axiom Institute of Technology', password: 'admin123' },
    { name: 'Aarav Mehta', email: DEMO_ACCOUNT_EMAILS.aarav, role: 'student' as const, org: 'CSE · Semester 5', password: 'student123' },
    { name: 'Zoya Khan', email: DEMO_ACCOUNT_EMAILS.zoya, role: 'student' as const, org: 'CSE · Semester 5', password: 'student123' },
    { name: 'Rohan Iyer', email: DEMO_ACCOUNT_EMAILS.rohan, role: 'student' as const, org: 'ECE · Semester 5', password: 'student123' },
    { name: 'Ananya Rao', email: DEMO_ACCOUNT_EMAILS.ananya, role: 'student' as const, org: 'CSE · Semester 5', password: 'student123' },
    { name: 'Kabir Singh', email: DEMO_ACCOUNT_EMAILS.kabir, role: 'student' as const, org: 'MECH · Semester 3', password: 'student123' },
    { name: 'Diya Nair', email: DEMO_ACCOUNT_EMAILS.diya, role: 'student' as const, org: 'ECE · Semester 3', password: 'student123' },
    { name: 'Ishaan Verma', email: DEMO_ACCOUNT_EMAILS.ishaan, role: 'student' as const, org: 'CSE · Semester 3', password: 'student123' },
    { name: 'Vivaan Gupta', email: DEMO_ACCOUNT_EMAILS.vivaan, role: 'student' as const, org: 'IT · Semester 5', password: 'student123' }
  ].map((u) => ({
    id: u.role === 'admin' ? uid('usr_') : uid('stu_'),
    name: u.name,
    email: u.email,
    role: u.role,
    org: u.org,
    passwordHash: hashPassword(u.password),
    createdAt: now - 90 * 24 * 3600 * 1000
  }));

  // Stable admin id so question ownership stays consistent
  users[0].id = author;
  store.users = users;
  users.forEach((u) => persist('users', u as unknown as { id: string } & Record<string, unknown>));

  const questions: Question[] = [
    mcq(
      'A particle is confined to an infinite potential well of width L. Which expression gives the energy of the n-th stationary state?',
      ['Eₙ = n²π²ħ² / 2mL²', 'Eₙ = nπħ / 2mL', 'Eₙ = n²ħ² / 2mL', 'Eₙ = nħω / 2'],
      0,
      'Quantum Mechanics',
      'medium',
      10,
      45,
      'Infinite well energy levels scale with n² because the allowed wavelengths are λ = 2L/n.'
    ),
    mcq(
      'Which of the following operators is Hermitian?',
      ['Momentum operator p̂ = −iħ∇', 'Scaling operator 2x', 'Translation by a complex phase', 'Complex conjugation'],
      0,
      'Quantum Mechanics',
      'hard',
      10,
      60,
      'Momentum is an observable, so its operator must be Hermitian — verified by integration by parts.'
    ),
    tf(
      'The Heisenberg uncertainty principle implies that a particle cannot have a simultaneously well-defined position and momentum.',
      true,
      'Quantum Mechanics',
      5,
      20,
      'Δx·Δp ≥ ħ/2 — the two uncertainties are inversely bounded.'
    ),
    q({
      type: 'fill',
      prompt: 'The quantum number that determines the shape of an atomic orbital is called the ______ quantum number.',
      topic: 'Quantum Mechanics',
      difficulty: 'easy',
      options: [],
      correctOptionIndex: null,
      acceptedAnswers: ['azimuthal', 'azimuthal quantum number', 'angular momentum', 'l'],
      points: 5,
      timerSeconds: 30,
      explanation: 'The azimuthal (angular momentum) quantum number l sets orbital shape: s, p, d, f.'
    }),
    text(
      'short',
      'State the physical significance of the wavefunction ψ in the Copenhagen interpretation.',
      ['probability amplitude', 'probability amplitude of finding the particle', 'it gives the probability amplitude'],
      'Quantum Mechanics',
      'medium',
      10,
      75,
      'ψ is the probability amplitude; |ψ|² gives the probability density of finding the particle.'
    ),
    text(
      'long',
      'Derive the time-independent Schrödinger equation starting from the classical energy relation E = p²/2m + V, and explain each substitution you make.',
      [],
      'Quantum Mechanics',
      'hard',
      20,
      240,
      'Substitute E → iħ∂/∂t and p → −iħ∇ into the classical energy relation; the result is the TISE for stationary states.'
    ),

    mcq(
      'What is the average-case time complexity of searching in a balanced binary search tree with n nodes?',
      ['O(log n)', 'O(n)', 'O(n log n)', 'O(1)'],
      0,
      'Data Structures',
      'easy',
      10,
      30,
      'A balanced BST halves the search space at every comparison → O(log n).'
    ),
    mcq(
      'Which data structure is used by a breadth-first search of a graph?',
      ['Queue', 'Stack', 'Priority queue', 'Heap'],
      0,
      'Data Structures',
      'easy',
      10,
      30,
      'BFS processes vertices in discovery order → FIFO queue.'
    ),
    tf(
      'A hash table with open addressing guarantees O(1) worst-case lookup time.',
      false,
      'Data Structures',
      5,
      25,
      'Open addressing is O(1) on average; the worst case is O(n) under heavy collisions.'
    ),
    q({
      type: 'fill',
      prompt: 'In a max-heap, the largest element always resides at index ______ (0-based array representation).',
      topic: 'Data Structures',
      difficulty: 'easy',
      options: [],
      correctOptionIndex: null,
      acceptedAnswers: ['0', 'zero'],
      points: 5,
      timerSeconds: 20,
      explanation: 'The heap property puts the maximum at the root, which is index 0.'
    }),
    text(
      'short',
      'Why does a linked list allow O(1) insertion at the head while an array does not?',
      ['because inserting at head only changes pointers', 'no shifting required', 'pointer reassignment'],
      'Data Structures',
      'medium',
      10,
      60,
      'Head insertion only rewires two pointers; arrays must shift every element.'
    ),

    mcq(
      'If a train covers 240 km in 3 hours, what is its average speed in m/s?',
      ['22.2 m/s', '20 m/s', '80 m/s', '24 m/s'],
      0,
      'Quantitative Aptitude',
      'easy',
      10,
      40,
      '240 km / 3 h = 80 km/h = 80 × 1000 / 3600 ≈ 22.2 m/s.'
    ),
    mcq(
      'A sum doubles in 8 years at simple interest. In how many years will it become 4 times?',
      ['24 years', '16 years', '32 years', '20 years'],
      0,
      'Quantitative Aptitude',
      'medium',
      10,
      75,
      'SI doubles the principal every 8 years, so 4× needs 3 doublings = 24 years.'
    ),
    tf(
      'If all A are B and some B are C, then some A are definitely C.',
      false,
      'Logical Reasoning',
      5,
      30,
      'The overlapping B may exclude A entirely, so the conclusion does not follow.'
    ),
    q({
      type: 'fill',
      prompt: 'Complete the series: 2, 6, 12, 20, 30, ______',
      topic: 'Logical Reasoning',
      difficulty: 'easy',
      options: [],
      correctOptionIndex: null,
      acceptedAnswers: ['42', 'forty two', 'forty-two'],
      points: 5,
      timerSeconds: 25,
      explanation: 'Differences increase by 2: 2→6→12→20→30→42.'
    }),
    text(
      'short',
      'A shopkeeper marks up an item by 40% and then offers a 25% discount. What is his net profit percentage?',
      ['5%', '5', 'five percent', '5 percent'],
      'Quantitative Aptitude',
      'medium',
      10,
      90,
      '1.4 × 0.75 = 1.05 → 5% net profit.'
    ),
    text(
      'long',
      'A team of 6 workers can finish a project in 12 days. After 4 days, 2 workers leave. Explain step by step how the remaining work is completed and on which day the project finishes.',
      [],
      'Quantitative Aptitude',
      'hard',
      20,
      210,
      'Total work = 72 worker-days. 4 days × 6 = 24 done, 48 remain for 4 workers → 12 more days → day 16.'
    ),
    text(
      'short',
      'Define normalisation in a relational database and state one anomaly it removes.',
      ['normalisation', 'normalization', 'reduces redundancy'],
      'Database Systems',
      'medium',
      10,
      70,
      'Normalisation organises attributes to reduce redundancy; it removes update/insert/delete anomalies.'
    ),
    q({
      type: 'fill',
      prompt: 'In Big-O notation, binary search over a sorted array of 1024 elements takes at most ______ comparisons.',
      topic: 'Algorithms',
      difficulty: 'medium',
      options: [],
      correctOptionIndex: null,
      acceptedAnswers: ['10', 'ten', '11'],
      points: 5,
      timerSeconds: 35,
      explanation: 'log₂(1024) = 10 → at most 10–11 comparisons.'
    })
  ];

  store.questions = questions;
  questions.forEach((question) =>
    persist('questions', question as unknown as { id: string } & Record<string, unknown>)
  );

  const pick = (...prompts: string[]) =>
    prompts
      .map((p) => questions.find((question) => question.prompt.startsWith(p))?.id)
      .filter((id): id is string => !!id);

  const examLive: Exam = {
    id: uid('exm_'),
    code: 'QM4LIVE',
    title: 'Quantum Foundations — Live Sprint',
    subject: 'Physics · Unit 4',
    adminId: author,
    adminName: 'Dr. Meera Sharma',
    status: 'live',
    questionIds: pick(
      'A particle is confined',
      'Which of the following operators',
      'The Heisenberg uncertainty',
      'The quantum number that determines',
      'State the physical significance',
      'Derive the time-independent'
    ),
    createdAt: now - 2 * 3600 * 1000,
    current: { questionId: '', pushedAt: 0, endsAt: 0, locked: false }
  };
  examLive.current = {
    questionId: examLive.questionIds[2],
    pushedAt: now - 12_000,
    endsAt: now + 48_000,
    locked: false
  };

  const examDsa: Exam = {
    id: uid('exm_'),
    code: 'DSA2026',
    title: 'Data Structures — Rapid Round',
    subject: 'CSE · Semester 5',
    adminId: author,
    adminName: 'Dr. Meera Sharma',
    status: 'live',
    questionIds: pick(
      'What is the average-case time complexity',
      'Which data structure is used by a breadth-first',
      'A hash table with open addressing',
      'In a max-heap, the largest element',
      'Why does a linked list allow'
    ),
    createdAt: now - 26 * 3600 * 1000,
    current: null
  };

  const examAptitude: Exam = {
    id: uid('exm_'),
    code: 'APTSETA',
    title: 'Aptitude Mock — Set A',
    subject: 'Placement Prep',
    adminId: author,
    adminName: 'Faculty · Rohan Deshpande',
    status: 'ended',
    questionIds: pick(
      'If a train covers 240 km',
      'A sum doubles in 8 years',
      'If all A are B and some B are C',
      'Complete the series',
      'A shopkeeper marks up an item'
    ),
    createdAt: now - 3 * 24 * 3600 * 1000,
    endedAt: now - 3 * 24 * 3600 * 1000 + 45 * 60 * 1000,
    current: null
  };

  store.exams = [examLive, examDsa, examAptitude];
  store.exams.forEach((exam) => persist('exams', exam as unknown as { id: string } & Record<string, unknown>));

  // ── Simulated history for analytics + a lively live leaderboard ──
  const students = store.users.filter((u) => u.role === 'student');
  const skill: Record<string, number> = {
    'Aarav Mehta': 0.86,
    'Zoya Khan': 0.78,
    'Rohan Iyer': 0.64,
    'Ananya Rao': 0.92,
    'Kabir Singh': 0.55,
    'Diya Nair': 0.71,
    'Ishaan Verma': 0.68,
    'Vivaan Gupta': 0.6
  };

  const simulate = (exam: Exam, questionCount: number, pushWindow: number) => {
    const responses: Response[] = [];
    const targets = exam.questionIds.slice(0, questionCount);
    students.forEach((student, sIdx) => {
      targets.forEach((questionId, qIdx) => {
        if (Math.random() > 0.93) return; // occasional skip
        const question = store.questions.find((x) => x.id === questionId);
        if (!question) return;
        const correctChance = skill[student.name] ?? 0.6;
        const willBeCorrect = Math.random() < correctChance;
        const answer =
          question.type === 'mcq' || question.type === 'truefalse'
            ? String(
                willBeCorrect
                  ? question.correctOptionIndex ?? 0
                  : ((question.correctOptionIndex ?? 0) + 1) % question.options.length
              )
            : willBeCorrect
              ? question.acceptedAnswers[0] ?? 'answered'
              : 'not sure about this one';
        const latencyMs = Math.round(
          pushWindow * (0.18 + Math.random() * 0.6) + sIdx * 350 + qIdx * 500
        );
        const graded = gradeAnswer(question, answer);
        const submittedAt = exam.createdAt + qIdx * 120_000 + latencyMs;
        responses.push({
          id: uid('rsp_'),
          examId: exam.id,
          questionId,
          studentId: student.id,
          studentName: student.name,
          answer,
          submittedAt,
          latencyMs,
          grade: graded.grade,
          awarded: graded.awarded,
          manual: false
        });
      });
    });
    store.responses.push(...responses);
    responses.forEach((r) => persist('responses', r as unknown as { id: string } & Record<string, unknown>));
  };

  simulate(examAptitude, 5, 40_000);

  // Live exam: Q1 and Q2 are already delivered, so the control room opens with a
  // populated feed and the analytics have something real to read.
  const liveResponses: Response[] = [];
  const delivered = examLive.questionIds.slice(0, 2);
  delivered.forEach((questionId, qIdx) => {
    const question = store.questions.find((x) => x.id === questionId);
    if (!question) return;
    students.slice(0, 7).forEach((student, idx) => {
      if (idx === 6 && qIdx === 1) return; // one student skipped Q2
      const skillChance = (skill[student.name] ?? 0.6) - 0.06;
      const willBeCorrect = Math.random() < skillChance;
      const answer =
        question.type === 'mcq' || question.type === 'truefalse'
          ? String(
              willBeCorrect
                ? question.correctOptionIndex ?? 0
                : ((question.correctOptionIndex ?? 0) + 1 + (idx % (question.options.length - 1))) %
                    question.options.length
            )
          : willBeCorrect
            ? question.acceptedAnswers[0] ?? 'answered'
            : 'not sure about this one';
      const latencyMs = 4_000 + idx * 1_900 + qIdx * 3_400 + Math.round(Math.random() * 2_000);
      const graded = gradeAnswer(question, answer);
      liveResponses.push({
        id: uid('rsp_'),
        examId: examLive.id,
        questionId,
        studentId: student.id,
        studentName: student.name,
        answer,
        submittedAt: now - 120_000 + qIdx * 60_000 + latencyMs,
        latencyMs,
        grade: graded.grade,
        awarded: graded.awarded,
        manual: false
      });
    });
  });
  store.responses.push(...liveResponses);
  liveResponses.forEach((r) =>
    persist('responses', r as unknown as { id: string } & Record<string, unknown>)
  );

  seedSamplePaper();
}
