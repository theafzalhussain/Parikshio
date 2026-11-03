import { CONTACT_EMAIL, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/site';

/** Search + AI crawlers: intent matches how institutes actually look for this. */
export const SEO_TITLE =
  'Free Online Exam Software for Schools, Colleges & Institutes | Parikshio';

export const SEO_KEYWORDS = [
  'free online exam software',
  'online exam platform for schools',
  'online test for colleges',
  'institute online exam',
  'live exam software India',
  'online assessment platform',
  'conduct online test free',
  'school online exam',
  'college online exam software',
  'coaching institute mock test',
  'auto grading exam software',
  'OCR question paper upload',
  'live quiz for classroom',
  'Google Classroom exam',
  SITE_NAME.toLowerCase()
];

export const FAQ_ITEMS = [
  {
    question: 'Is Parikshio free for schools, colleges and institutes?',
    answer:
      'Yes. Schools, colleges, universities and coaching institutes can run live and self-paced online exams on Parikshio without students installing an app.'
  },
  {
    question: 'Who is Parikshio for?',
    answer:
      'Parikshio is built for universities, colleges, schools and coaching institutes that need a live exam: a join code, a server-synced timer, auto-grading, and analytics.'
  },
  {
    question: 'How do students join an exam?',
    answer:
      'Students open parikshio.tech, enter the exam code, and the question appears on their phone, tablet or laptop. Nothing to install.'
  },
  {
    question: 'How do faculty get an account?',
    answer:
      'Students sign up on their own. Faculty and administrator accounts are created by the institute so only authorised staff can write and push questions.'
  }
];

export function softwareJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${SITE_URL}/#org`,
        name: SITE_NAME,
        url: SITE_URL,
        email: CONTACT_EMAIL,
        logo: `${SITE_URL}/opengraph-image.png`
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        url: SITE_URL,
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        publisher: { '@id': `${SITE_URL}/#org` },
        inLanguage: 'en-IN'
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${SITE_URL}/#app`,
        name: SITE_NAME,
        url: SITE_URL,
        applicationCategory: 'EducationalApplication',
        operatingSystem: 'Web',
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'INR'
        },
        description: SITE_DESCRIPTION,
        featureList: [
          'Live push exams',
          'Self-paced question sets',
          'Server-synced timers',
          'Instant auto-grading',
          'AI evaluation for written answers',
          'Paper upload with OCR',
          'Google Classroom sync',
          'Live leaderboard'
        ],
        audience: {
          '@type': 'EducationalAudience',
          educationalRole: 'teacher'
        }
      },
      {
        '@type': 'FAQPage',
        '@id': `${SITE_URL}/#faq`,
        mainEntity: FAQ_ITEMS.map((item) => ({
          '@type': 'Question',
          name: item.question,
          acceptedAnswer: { '@type': 'Answer', text: item.answer }
        }))
      }
    ]
  };
}
