import { config } from './config';

/**
 * Transactional email via Brevo (https://www.brevo.com).
 *
 * The only mail this app sends today is the password-reset link. Brevo is
 * reached over its REST API (no SMTP, no extra dependency) using a single
 * account-level API key, so the same key can be shared across projects.
 *
 * Sending is enabled only when BREVO_API_KEY and BREVO_SENDER_EMAIL are set
 * (see config.brevo.enabled). When disabled the caller falls back to the
 * dev console link, so local development keeps working with no email account.
 */

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

export interface SendResult {
  ok: boolean;
  /** Short reason when ok === false — logged server-side, never shown to users. */
  error?: string;
}

interface BrevoPayload {
  sender: { name: string; email: string };
  to: { email: string; name?: string }[];
  subject: string;
  htmlContent: string;
  textContent: string;
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

  const name = (toName || '').trim() || 'there';
  const safeName = escapeHtml(name);
  const safeUrl = escapeHtml(resetUrl);
  const brand = escapeHtml(config.brevo.senderName);
  const minutes = Math.round(config.passwordResetTtlMs / 60000);
  const year = new Date().getFullYear();

  // Table-based, inline-styled layout for consistent rendering across email
  // clients (Gmail, Outlook, Apple Mail). Light surface with the Parikshio
  // purple→lime brand accents.
  const htmlContent = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>Reset your ${brand} password</title>
  </head>
  <body style="margin:0;padding:0;background:#eef1f5;">
    <!-- preheader (hidden) -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:#eef1f5;">
      Reset your ${brand} password — this link expires in ${minutes} minutes.
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                 style="max-width:520px;background:#ffffff;border-radius:18px;overflow:hidden;
                        box-shadow:0 1px 3px rgba(16,24,40,0.08);font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

            <!-- Brand header -->
            <tr>
              <td style="background:linear-gradient(135deg,#7C5CFF 0%,#9E82FF 45%,#CBFF3D 140%);padding:28px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="vertical-align:middle;">
                      <span style="display:inline-block;width:38px;height:38px;border-radius:11px;
                                   background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.35);
                                   text-align:center;line-height:38px;color:#ffffff;font-size:20px;
                                   font-weight:700;">A</span>
                    </td>
                    <td style="vertical-align:middle;padding-left:12px;">
                      <span style="display:block;color:#ffffff;font-size:15px;font-weight:600;
                                   letter-spacing:0.14em;text-transform:uppercase;">${brand}</span>
                      <span style="display:block;color:rgba(255,255,255,0.75);font-size:9px;
                                   font-weight:500;letter-spacing:0.28em;text-transform:uppercase;margin-top:3px;">
                        assessment os
                      </span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="padding:36px 32px 8px;">
                <h1 style="margin:0 0 6px;font-size:21px;line-height:1.3;color:#101828;font-weight:700;">
                  Reset your password
                </h1>
                <p style="margin:14px 0 0;font-size:14px;line-height:1.65;color:#475467;">
                  Hi ${safeName}, we received a request to reset the password for your
                  ${brand} account. Click the button below to choose a new one.
                </p>
              </td>
            </tr>

            <!-- Button -->
            <tr>
              <td align="center" style="padding:28px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:12px;background:#7C5CFF;">
                      <a href="${safeUrl}"
                         style="display:inline-block;padding:13px 32px;font-size:14px;font-weight:600;
                                color:#ffffff;text-decoration:none;border-radius:12px;">
                        Reset password
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Expiry note -->
            <tr>
              <td style="padding:0 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                       style="background:#f5f3ff;border:1px solid #e9e4ff;border-radius:12px;">
                  <tr>
                    <td style="padding:12px 16px;font-size:12.5px;line-height:1.6;color:#6941c6;">
                      🔒 This link expires in <strong>${minutes} minutes</strong> and can be used only once.
                      For your security, using it signs out every other device.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Fallback link -->
            <tr>
              <td style="padding:22px 32px 4px;">
                <p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:#667085;">
                  If the button doesn't work, copy and paste this link into your browser:
                </p>
                <a href="${safeUrl}" style="font-size:12px;line-height:1.6;color:#7C5CFF;word-break:break-all;">
                  ${safeUrl}
                </a>
              </td>
            </tr>

            <!-- Divider + ignore note -->
            <tr>
              <td style="padding:20px 32px 0;">
                <div style="height:1px;background:#eaecf0;"></div>
                <p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:#98a2b3;">
                  Didn't request this? You can safely ignore this email — your password stays unchanged.
                </p>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:24px 32px 32px;">
                <p style="margin:0;font-size:11px;line-height:1.6;color:#b4bcc8;">
                  © ${year} ${brand} · Assessment OS<br>
                  This is an automated message — please do not reply.
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const textContent =
    `Hi ${name},\n\n` +
    `We received a request to reset your ${config.brevo.senderName} password.\n` +
    `Open this link to choose a new one (expires in ${minutes} minutes, single use):\n\n` +
    `${resetUrl}\n\n` +
    `Using it signs out every other device.\n\n` +
    `Didn't request this? Ignore this email — your password stays unchanged.\n\n` +
    `© ${year} ${config.brevo.senderName} · Assessment OS`;

  return sendViaBrevo({
    sender: { name: config.brevo.senderName, email: config.brevo.senderEmail },
    to: [{ email: toEmail, name }],
    subject: `Reset your ${config.brevo.senderName} password`,
    htmlContent,
    textContent
  });
}
