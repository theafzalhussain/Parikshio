import { config } from './config';

/**
 * Transactional email via Brevo (https://www.brevo.com).
 *
 * Three emails are sent, all in the same branded frame:
 *   • the password-reset link, to the account holder;
 *   • a contact-form message, to the team inbox (reply-to is the sender);
 *   • a "we received your message" copy, to the person who wrote in.
 *
 * Brevo is reached over its REST API (no SMTP, no extra dependency) using a
 * single account-level API key, so the same key can be shared across projects.
 *
 * Sending is enabled only when BREVO_API_KEY and BREVO_SENDER_EMAIL are set
 * (see config.brevo.enabled). When disabled the caller falls back to the
 * dev console link, so local development keeps working with no email account.
 */

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

/** Product name in email headings and subjects. The From name is BREVO_SENDER_NAME. */
const BRAND = 'Parikshio';
const SITE_DOMAIN = 'parikshio.tech';
const SITE_URL = `https://${SITE_DOMAIN}`;

export interface SendResult {
  ok: boolean;
  /** Short reason when ok === false — logged server-side, never shown to users. */
  error?: string;
}

interface BrevoPayload {
  sender: { name: string; email: string };
  to: { email: string; name?: string }[];
  /** Replies go here instead of the sender — used for contact-form messages. */
  replyTo?: { email: string; name?: string };
  subject: string;
  htmlContent: string;
  textContent: string;
  /** Labels shown in Brevo's logs, to tell the three emails apart. */
  tags?: string[];
}

async function sendViaBrevo(payload: BrevoPayload): Promise<SendResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': config.brevo.apiKey,
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (res.ok) return { ok: true };
    // Brevo returns a JSON error body ({ code, message }) on failure.
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string; code?: string };
      if (body?.message) detail = `${body.code ?? res.status}: ${body.message}`;
    } catch {
      /* non-JSON body — keep the status code */
    }
    return { ok: false, error: detail };
  } catch (err) {
    const reason = (err as Error).name === 'AbortError' ? 'request timed out' : (err as Error).message;
    return { ok: false, error: reason };
  } finally {
    clearTimeout(timeout);
  }
}

/** True when email delivery is configured. */
export function emailEnabled(): boolean {
  return config.brevo.enabled;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Header values (subject, display names) must stay on one line. */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function sender() {
  return { name: config.brevo.senderName, email: config.brevo.senderEmail };
}

/** A reply to a no-reply sender goes nowhere; any other sender is a real inbox. */
function senderTakesReplies(): boolean {
  return !/^(no-?reply|do-?not-?reply|mailer-daemon)@/i.test(config.brevo.senderEmail);
}

/** "Dr. Meera Sharma" → "Meera"; anything unusual falls back to a neutral greeting. */
function greetingName(name: string): string {
  const cleaned = oneLine(name).replace(/^(Dr|Prof|Mr|Mrs|Ms|Mx)\.?\s+/i, '');
  const first = cleaned.split(/\s+/)[0] ?? '';
  return first || 'there';
}

function formatReceivedAt(ts: number): string {
  return `${new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(ts))} IST`;
}

/** A mailto: link that cannot smuggle extra headers in through the address. */
function mailtoHref(email: string, subject: string): string {
  const at = email.lastIndexOf('@');
  const address = at > 0 ? `${encodeURIComponent(email.slice(0, at))}@${encodeURIComponent(email.slice(at + 1))}` : '';
  return `mailto:${address}?subject=${encodeURIComponent(subject)}`;
}

// ── building blocks (every argument is already-escaped HTML) ─────────────
const FONT = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function paragraph(html: string, top = 14): string {
  return `<p style="margin:${top}px 0 0;font-size:14px;line-height:1.65;color:#475467;">${html}</p>`;
}

/** Gold call-to-action, as on the reset email. */
function button(href: string, label: string): string {
  return `
            <tr>
              <td align="center" style="padding:28px 32px 6px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:12px;background:#CBA054;">
                      <a href="${href}"
                         style="display:inline-block;padding:13px 32px;font-size:14px;font-weight:600;
                                color:#0A0F1D;text-decoration:none;border-radius:12px;">
                        ${label}
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`;
}

/** Cream note box with a gold edge (the reset email's expiry note). */
function noteBox(html: string, top = 22): string {
  return `
            <tr>
              <td style="padding:${top}px 32px 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                       style="background:#fbf6ea;border:1px solid #f1e3c2;border-radius:12px;">
                  <tr>
                    <td style="padding:12px 16px;font-size:12.5px;line-height:1.6;color:#80612f;">
                      ${html}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`;
}

/** Small-caps label followed by label/value rows and, optionally, the message itself. */
function detailsSection(title: string, rows: [string, string][], messageHtml?: string, afterMessage = ''): string {
  const htmlRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 0;width:104px;vertical-align:top;font-size:12px;color:#667085;">${label}</td>` +
        `<td style="padding:6px 0;font-size:13.5px;line-height:1.5;color:#101828;">${value}</td></tr>`
    )
    .join('');
  return `
            <tr>
              <td style="padding:26px 32px 4px;">
                <p style="margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#98a2b3;">
                  ${title}
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${htmlRows}</table>
                ${
                  messageHtml === undefined
                    ? ''
                    : `<div style="margin-top:12px;border:1px solid #eaecf0;border-left:3px solid #DFB873;border-radius:12px;
                                padding:14px 16px;font-size:14px;line-height:1.65;color:#101828;background:#fcfcfd;">
                    ${messageHtml}
                  </div>`
                }
                ${afterMessage}
              </td>
            </tr>`;
}

function dividerNote(html: string): string {
  return `
            <tr>
              <td style="padding:22px 32px 0;">
                <div style="height:1px;background:#eaecf0;"></div>
                <p style="margin:18px 0 0;font-size:12.5px;line-height:1.6;color:#667085;">${html}</p>
              </td>
            </tr>`;
}

function stars(rating: number): string {
  return `<span style="color:#CBA054;letter-spacing:2px;font-size:15px;">${'★'.repeat(rating)}</span><span style="color:#d0d5dd;letter-spacing:2px;font-size:15px;">${'★'.repeat(5 - rating)}</span>&nbsp; <span style="color:#667085;">${rating} / 5</span>`;
}

/**
 * The branded frame shared by every email: midnight header with the gold "P"
 * monogram, white body, quiet footer. Table-based and inline-styled for
 * consistent rendering in Gmail, Outlook and Apple Mail.
 */
function brandedEmail({
  title,
  preheader,
  eyebrow,
  heading,
  intro,
  blocks,
  footer
}: {
  title: string;
  preheader: string;
  /** Small gold pill above the heading, e.g. "contact form". */
  eyebrow?: string;
  heading: string;
  intro: string;
  blocks: string;
  footer: string;
}): string {
  const year = new Date().getFullYear();
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background:#eef1f5;">
    <!-- preheader (hidden) -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:#eef1f5;">
      ${preheader}
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                 style="max-width:520px;background:#ffffff;border-radius:18px;overflow:hidden;
                        box-shadow:0 1px 3px rgba(16,24,40,0.08);font-family:${FONT};">

            <!-- Brand header -->
            <tr>
              <td style="background:#0A0F1D;background-image:linear-gradient(135deg,#1F2A4A 0%,#0A0F1D 70%);padding:28px 32px;border-bottom:3px solid #DFB873;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="vertical-align:middle;width:50px;">
                      <span style="display:inline-block;width:38px;height:38px;border-radius:11px;
                                   background:#141C33;border:1px solid #CBA054;
                                   text-align:center;line-height:38px;color:#EBCF95;font-size:20px;
                                   font-weight:700;font-family:Georgia,'Times New Roman',serif;">P</span>
                    </td>
                    <td style="vertical-align:middle;">
                      <span style="display:block;color:#ffffff;font-size:19px;font-weight:600;
                                   font-family:Georgia,'Times New Roman',serif;">${BRAND}</span>
                      <span style="display:block;color:#DFB873;font-size:9px;
                                   font-weight:500;letter-spacing:0.28em;text-transform:uppercase;margin-top:3px;">
                        live assessment
                      </span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Heading -->
            <tr>
              <td style="padding:36px 32px 0;">
                ${
                  eyebrow
                    ? `<p style="margin:0 0 12px;">
                  <span style="display:inline-block;background:#FBF6EA;border:1px solid #EFE0BF;border-radius:999px;
                               padding:4px 11px;color:#8A6A2F;font-size:10px;font-weight:700;
                               letter-spacing:0.16em;text-transform:uppercase;">${eyebrow}</span>
                </p>`
                    : ''
                }
                <h1 style="margin:0 0 6px;font-size:21px;line-height:1.3;color:#101828;font-weight:700;">
                  ${heading}
                </h1>
                ${intro}
              </td>
            </tr>

            ${blocks}

            <!-- Footer -->
            <tr>
              <td style="padding:26px 32px 32px;">
                <p style="margin:0;font-size:11px;line-height:1.6;color:#98a2b3;">
                  ${footer}
                </p>
                <p style="margin:10px 0 0;font-size:11px;line-height:1.6;color:#b4bcc8;">
                  © ${year} ${BRAND} · Live assessment platform ·
                  <a href="${SITE_URL}" style="color:#b4bcc8;text-decoration:underline;">${SITE_DOMAIN}</a>
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Footer line for emails people may answer. */
function replyFooter(): string {
  return senderTakesReplies()
    ? 'Need help? Reply to this email and it reaches the Parikshio team.'
    : 'This is an automated message — please do not reply.';
}

// ── password reset ────────────────────────────────────────────────

/**
 * Send the password-reset link. `resetUrl` must be an absolute URL that opens
 * the reset page with the single-use token already in the query string.
 */
export async function sendPasswordResetEmail(
  toEmail: string,
  toName: string,
  resetUrl: string
): Promise<SendResult> {
  if (!config.brevo.enabled) {
    return { ok: false, error: 'email not configured' };
  }

  const name = oneLine(toName || '') || 'there';
  const safeUrl = escapeHtml(resetUrl);
  const minutes = Math.round(config.passwordResetTtlMs / 60000);
  const year = new Date().getFullYear();

  const blocks =
    button(safeUrl, 'Reset password') +
    noteBox(
      `🔒 This link expires in <strong>${minutes} minutes</strong> and can be used only once.
                      For your security, using it logs out every other device.`
    ) +
    `
            <!-- Fallback link -->
            <tr>
              <td style="padding:22px 32px 4px;">
                <p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:#667085;">
                  If the button doesn't work, copy and paste this link into your browser:
                </p>
                <a href="${safeUrl}" style="font-size:12px;line-height:1.6;color:#80612f;word-break:break-all;">
                  ${safeUrl}
                </a>
              </td>
            </tr>` +
    dividerNote("Didn't request this? You can safely ignore this email — your password stays unchanged.");

  const htmlContent = brandedEmail({
    title: `Reset your ${BRAND} password`,
    preheader: `Reset your ${BRAND} password — this link expires in ${minutes} minutes.`,
    eyebrow: 'Account security',
    heading: 'Reset your password',
    intro: paragraph(
      `Hi ${escapeHtml(greetingName(name))}, we received a request to reset the password for your
                  ${BRAND} account. Click the button below to choose a new one.`
    ),
    blocks,
    footer: escapeHtml(replyFooter())
  });

  const textContent =
    `Hi ${greetingName(name)},\n\n` +
    `We received a request to reset your ${BRAND} password.\n` +
    `Open this link to choose a new one (expires in ${minutes} minutes, single use):\n\n` +
    `${resetUrl}\n\n` +
    `Using it logs out every other device.\n\n` +
    `Didn't request this? Ignore this email — your password stays unchanged.\n\n` +
    `${replyFooter()}\n\n` +
    `© ${year} ${BRAND} · Live assessment platform · ${SITE_DOMAIN}`;

  return sendViaBrevo({
    sender: sender(),
    to: [{ email: toEmail, name }],
    subject: `Reset your ${BRAND} password`,
    htmlContent,
    textContent,
    tags: ['password-reset']
  });
}

// ── contact form: to the team ─────────────────────────────────────

/** Heading of the team email, by topic. */
const TEAM_HEADING: Record<string, string> = {
  general: 'New message',
  feedback: 'New feedback',
  problem: 'New problem report',
  faculty: 'Faculty access request',
  onboarding: 'Institute enquiry'
};

/**
 * Forward a contact-form message to the team inbox. Reply-to is the sender, so
 * answering from the mail client goes straight to them. Every value from the
 * form is escaped; nothing the sender typed is ever rendered as HTML.
 */
export async function sendContactNotification(input: {
  to: string;
  reference: string;
  topic: string;
  topicLabel: string;
  roleLabel: string;
  name: string;
  email: string;
  org: string;
  message: string;
  rating: number | null;
  signedInAs: string | null;
  receivedAt: number;
}): Promise<SendResult> {
  if (!config.brevo.enabled) {
    return { ok: false, error: 'email not configured' };
  }

  const name = oneLine(input.name);
  const heading = TEAM_HEADING[input.topic] ?? 'New message';
  const received = formatReceivedAt(input.receivedAt);
  const subject = oneLine(`[${BRAND}] ${input.topicLabel} — ${name} (${input.reference})`).slice(0, 180);
  const replyHref = escapeHtml(mailtoHref(input.email, `Re: ${input.topicLabel} (${input.reference})`));

  const rows: [string, string][] = [
    [
      'From',
      `${escapeHtml(name)}<br><a href="${escapeHtml(mailtoHref(input.email, `Re: ${input.topicLabel} (${input.reference})`))}"
         style="color:#80612f;text-decoration:none;">${escapeHtml(input.email)}</a>`
    ],
    ['Topic', escapeHtml(input.topicLabel)],
    ['I am a', escapeHtml(input.roleLabel)],
    ...(input.org ? ([['Institute', escapeHtml(input.org)]] as [string, string][]) : []),
    ...(input.rating ? ([['Rating', stars(input.rating)]] as [string, string][]) : []),
    ['Account', escapeHtml(input.signedInAs ?? 'Not logged in')]
  ];

  const blocks =
    noteBox(
      `Reference <strong style="letter-spacing:0.04em;">${escapeHtml(input.reference)}</strong>
                      &nbsp;·&nbsp; received ${escapeHtml(received)}`
    ) +
    detailsSection('Message details', rows, escapeHtml(input.message).replace(/\n/g, '<br>')) +
    button(replyHref, `Reply to ${escapeHtml(greetingName(name))}`) +
    dividerNote(
      `Replying to this email answers ${escapeHtml(name)} directly. They have already received an automatic confirmation with reference ${escapeHtml(input.reference)}.`
    );

  const htmlContent = brandedEmail({
    title: escapeHtml(`${heading} · ${BRAND}`),
    preheader: escapeHtml(`${input.topicLabel} from ${name} · ${input.reference}`),
    eyebrow: 'Contact form',
    heading: escapeHtml(`${heading} from ${greetingName(name)}`),
    intro: paragraph(
      `${escapeHtml(name)} wrote in through the contact form at ${SITE_DOMAIN}${
        input.org ? ` on behalf of <strong style="color:#101828;">${escapeHtml(input.org)}</strong>` : ''
      }.`
    ),
    blocks,
    footer: 'Sent automatically by the Parikshio contact form.'
  });

  const textRows: [string, string][] = [
    ['Reference', input.reference],
    ['Received', received],
    ['From', `${name} <${input.email}>`],
    ['Topic', input.topicLabel],
    ['I am a', input.roleLabel],
    ...(input.org ? ([['Institute', input.org]] as [string, string][]) : []),
    ...(input.rating ? ([['Rating', `${input.rating} / 5`]] as [string, string][]) : []),
    ['Account', input.signedInAs ?? 'Not logged in']
  ];
  const textContent =
    `${heading} from ${name}\n\n` +
    textRows.map(([label, value]) => `${label}: ${value}`).join('\n') +
    `\n\n${input.message}\n\n— Reply to this email to answer ${name} directly.`;

  return sendViaBrevo({
    sender: sender(),
    to: [{ email: input.to, name: `${BRAND} team` }],
    replyTo: { email: input.email, name },
    subject,
    htmlContent,
    textContent,
    tags: ['contact-team', `topic-${input.topic}`]
  });
}

// ── contact form: copy for the sender ─────────────────────────────

/** What the sender's copy says, by topic. */
const CONFIRMATION_COPY: Record<string, { subject: string; heading: string; line: string }> = {
  general: {
    subject: "We've received your message",
    heading: 'We have your message',
    line: 'Your message has reached the Parikshio team. We will get back to you at this email address soon.'
  },
  feedback: {
    subject: 'Thank you for your feedback',
    heading: 'Thank you for your feedback',
    line: 'Your feedback has reached the Parikshio team and helps us make Parikshio better. If it needs an answer, we will reply to this email address soon.'
  },
  problem: {
    subject: "We've received your problem report",
    heading: 'We are looking into it',
    line: 'Your problem report has reached the Parikshio team. We will look into it and get back to you at this email address soon.'
  },
  faculty: {
    subject: "We've received your faculty access request",
    heading: 'Your request is in',
    line: 'Your request for a faculty account has reached the Parikshio team. We will review it and reply to this email address soon.'
  },
  onboarding: {
    subject: 'Thank you for your interest in Parikshio',
    heading: 'Thank you for reaching out',
    line: 'Your request to bring Parikshio to your institute has reached our team. We will get in touch at this email address soon.'
  }
};

/** The copy of the message in the sender's email is shortened; the team receives it in full. */
const COPY_MAX_CHARS = 1500;

/**
 * Tell the person who used the contact form that their message arrived, with
 * a reference and a copy of what they sent. Reply-to is the team inbox, so a
 * reply adds to the same conversation.
 */
export async function sendContactConfirmation(input: {
  to: string;
  replyTo: string;
  reference: string;
  topic: string;
  topicLabel: string;
  roleLabel: string;
  name: string;
  org: string;
  message: string;
  rating: number | null;
  receivedAt: number;
}): Promise<SendResult> {
  if (!config.brevo.enabled) {
    return { ok: false, error: 'email not configured' };
  }

  const copy = CONFIRMATION_COPY[input.topic] ?? CONFIRMATION_COPY.general!;
  const name = oneLine(input.name) || 'there';
  const hello = greetingName(name);
  const received = formatReceivedAt(input.receivedAt);
  const shortened = input.message.length > COPY_MAX_CHARS;
  const messageCopy = shortened ? `${input.message.slice(0, COPY_MAX_CHARS).trimEnd()}…` : input.message;

  const rows: [string, string][] = [
    ['Topic', escapeHtml(input.topicLabel)],
    ['I am a', escapeHtml(input.roleLabel)],
    ...(input.org ? ([['Institute', escapeHtml(input.org)]] as [string, string][]) : []),
    ...(input.rating ? ([['Rating', stars(input.rating)]] as [string, string][]) : [])
  ];

  const blocks =
    noteBox(
      `Reference <strong style="letter-spacing:0.04em;">${escapeHtml(input.reference)}</strong>
                      &nbsp;·&nbsp; received ${escapeHtml(received)}<br>
                      <span style="color:#a58a5b;">Quote this reference if you write to us about it.</span>`
    ) +
    detailsSection(
      'What you sent us',
      rows,
      escapeHtml(messageCopy).replace(/\n/g, '<br>'),
      shortened
        ? '<p style="margin:8px 0 0;font-size:11.5px;color:#98a2b3;">Shortened here; the team received your full message.</p>'
        : ''
    ) +
    button(SITE_URL, `Open ${BRAND}`) +
    dividerNote(`Want to add something? Reply to this email and it goes straight to the ${BRAND} team.`);

  const htmlContent = brandedEmail({
    title: escapeHtml(`${copy.subject} · ${BRAND}`),
    preheader: escapeHtml(`${copy.line} Reference ${input.reference}.`),
    eyebrow: 'Message received',
    heading: escapeHtml(copy.heading),
    intro: paragraph(`Hi ${escapeHtml(hello)}, thank you for contacting ${BRAND}. ${escapeHtml(copy.line)}`),
    blocks,
    footer: escapeHtml(
      `You received this because this address was entered in the contact form at ${SITE_DOMAIN}. If that wasn't you, you can ignore this email.`
    )
  });

  const textRows: [string, string][] = [
    ['Topic', input.topicLabel],
    ['I am a', input.roleLabel],
    ...(input.org ? ([['Institute', input.org]] as [string, string][]) : []),
    ...(input.rating ? ([['Rating', `${input.rating} / 5`]] as [string, string][]) : [])
  ];
  const textContent =
    `Hi ${hello},\n\n` +
    `Thank you for contacting ${BRAND}. ${copy.line}\n\n` +
    `Reference: ${input.reference} (received ${received})\n\n` +
    `What you sent us\n` +
    textRows.map(([label, value]) => `${label}: ${value}`).join('\n') +
    `\n\n${messageCopy}\n` +
    (shortened ? '(Shortened here; the team received your full message.)\n' : '') +
    `\nWant to add something? Reply to this email and it goes straight to the ${BRAND} team.\n\n` +
    `You received this because this address was entered in the contact form at ${SITE_DOMAIN}. ` +
    `If that wasn't you, you can ignore this email.\n\n` +
    `© ${new Date().getFullYear()} ${BRAND} · Live assessment platform · ${SITE_DOMAIN}`;

  return sendViaBrevo({
    sender: sender(),
    to: [{ email: input.to, name }],
    replyTo: { email: input.replyTo, name: `${BRAND} team` },
    subject: oneLine(`${copy.subject} · ${BRAND}`),
    htmlContent,
    textContent,
    tags: ['contact-confirmation', `topic-${input.topic}`]
  });
}
