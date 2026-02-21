import fs from 'node:fs';
import path from 'node:path';

const isProduction = process.env.NODE_ENV === 'production';
const EMAIL_PROVIDER = String(process.env.EMAIL_PROVIDER || (isProduction ? 'disabled' : 'console'))
  .trim()
  .toLowerCase();
const EMAIL_FROM = (process.env.EMAIL_FROM || 'Taskable <no-reply@taskable.local>').trim();
function pickAppBaseUrl() {
  const candidates = [
    process.env.BASE_URL,
    process.env.APP_BASE_URL,
    process.env.CLIENT_ORIGIN,
    'http://localhost:5173',
  ]
    .map((value) =>
      String(value || '')
        .trim()
        .replace(/\/+$/, '')
    )
    .filter(Boolean);

  for (const candidate of candidates) {
    try {
      return new URL(candidate).toString().replace(/\/+$/, '');
    } catch {
      // Ignore invalid URL candidates and continue fallback chain.
    }
  }

  return 'http://localhost:5173';
}

const APP_BASE_URL = pickAppBaseUrl();
const EMAIL_API_KEY = String(process.env.EMAIL_API_KEY || '').trim();
const SENDGRID_API_KEY = String(process.env.SENDGRID_API_KEY || EMAIL_API_KEY).trim();
const POSTMARK_SERVER_TOKEN = String(
  process.env.POSTMARK_SERVER_TOKEN || (EMAIL_PROVIDER === 'postmark' ? EMAIL_API_KEY : '')
).trim();
const POSTMARK_MESSAGE_STREAM = String(process.env.POSTMARK_MESSAGE_STREAM || 'outbound').trim();
const EMAIL_SANDBOX_MODE = process.env.EMAIL_SANDBOX_MODE === 'true';
const EMAIL_TEST_LOG_PATH = String(process.env.EMAIL_TEST_LOG_PATH || '').trim();

const testMailbox = [];

function ensureDirectoryForFile(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function makeActionUrl(pathname, tokenParamName, token) {
  const url = new URL(pathname, APP_BASE_URL);
  url.searchParams.set(tokenParamName, token);
  return url.toString();
}

function buildVerificationTemplate({ name, token }) {
  const verificationUrl = makeActionUrl('/', 'verifyToken', token);
  const safeName = (name || 'there').trim() || 'there';
  const subject = 'Verify your Taskable account';
  const text = [
    `Hi ${safeName},`,
    '',
    'Welcome to Taskable. Verify your email to complete account setup.',
    '',
    `Verification link: ${verificationUrl}`,
    '',
    'If the app asks for a token manually, use this value:',
    token,
    '',
    'If you did not create this account, you can ignore this email.',
  ].join('\n');
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#14161a;line-height:1.5;">
      <p>Hi ${escapeHtml(safeName)},</p>
      <p>Welcome to Taskable. Verify your email to complete account setup.</p>
      <p><a href="${verificationUrl}" target="_blank" rel="noreferrer noopener">Verify email</a></p>
      <p>If the app asks for a token manually, use this value:</p>
      <pre style="background:#f3f4f7;padding:10px;border-radius:8px;font-size:13px;">${escapeHtml(token)}</pre>
      <p>If you did not create this account, you can ignore this email.</p>
    </div>
  `;
  return {
    subject,
    text,
    html,
    actionUrl: verificationUrl,
    template: 'verify-email',
  };
}

function buildPasswordResetTemplate({ name, token }) {
  const resetUrl = makeActionUrl('/', 'resetToken', token);
  const safeName = (name || 'there').trim() || 'there';
  const subject = 'Reset your Taskable password';
  const text = [
    `Hi ${safeName},`,
    '',
    'A password reset was requested for your Taskable account.',
    '',
    `Reset link: ${resetUrl}`,
    '',
    'If the app asks for a token manually, use this value:',
    token,
    '',
    'If you did not request this reset, you can ignore this email.',
  ].join('\n');
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#14161a;line-height:1.5;">
      <p>Hi ${escapeHtml(safeName)},</p>
      <p>A password reset was requested for your Taskable account.</p>
      <p><a href="${resetUrl}" target="_blank" rel="noreferrer noopener">Reset password</a></p>
      <p>If the app asks for a token manually, use this value:</p>
      <pre style="background:#f3f4f7;padding:10px;border-radius:8px;font-size:13px;">${escapeHtml(token)}</pre>
      <p>If you did not request this reset, you can ignore this email.</p>
    </div>
  `;
  return {
    subject,
    text,
    html,
    actionUrl: resetUrl,
    template: 'password-reset',
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function sendWithSendgrid(message) {
  if (!SENDGRID_API_KEY) {
    throw new Error('SENDGRID_API_KEY is missing.');
  }

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: message.to }] }],
      from: { email: extractEmailAddress(EMAIL_FROM), name: extractDisplayName(EMAIL_FROM) },
      subject: message.subject,
      content: [
        { type: 'text/plain', value: message.text },
        { type: 'text/html', value: message.html },
      ],
      mail_settings: EMAIL_SANDBOX_MODE
        ? {
            sandbox_mode: { enable: true },
          }
        : undefined,
    }),
  });

  if (!response.ok) {
    const payload = await safeJson(response);
    throw new Error(
      `SendGrid failed (${response.status}) ${payload ? JSON.stringify(payload) : ''}`
    );
  }
}

async function sendWithPostmark(message) {
  if (!POSTMARK_SERVER_TOKEN) {
    throw new Error('POSTMARK_SERVER_TOKEN is missing.');
  }

  const response = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': POSTMARK_SERVER_TOKEN,
    },
    body: JSON.stringify({
      From: EMAIL_FROM,
      To: message.to,
      Subject: message.subject,
      TextBody: message.text,
      HtmlBody: message.html,
      MessageStream: POSTMARK_MESSAGE_STREAM || 'outbound',
      TrackOpens: false,
    }),
  });

  if (!response.ok) {
    const payload = await safeJson(response);
    throw new Error(
      `Postmark failed (${response.status}) ${payload ? JSON.stringify(payload) : ''}`
    );
  }
}

function extractEmailAddress(value) {
  const match = value.match(/<([^>]+)>/);
  if (match?.[1]) return match[1].trim();
  return value.trim();
}

function extractDisplayName(value) {
  const match = value.match(/^([^<]+)</);
  if (match?.[1]) return match[1].trim().replace(/^"|"$/g, '');
  return 'Taskable';
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function writeTestLog(entry) {
  if (!EMAIL_TEST_LOG_PATH) return;
  ensureDirectoryForFile(EMAIL_TEST_LOG_PATH);
  fs.appendFileSync(EMAIL_TEST_LOG_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
}

async function deliverEmail(message) {
  const deliveryRecord = {
    id: `eml_${Math.random().toString(36).slice(2, 10)}`,
    provider: EMAIL_PROVIDER,
    to: message.to,
    subject: message.subject,
    template: message.template,
    actionUrl: message.actionUrl,
    createdAt: new Date().toISOString(),
  };

  if (EMAIL_PROVIDER === 'disabled') {
    return {
      queued: false,
      skipped: true,
      provider: EMAIL_PROVIDER,
    };
  }

  if (EMAIL_PROVIDER === 'console') {
    console.info(
      `[email] queued provider=${EMAIL_PROVIDER} template=${message.template} to=${message.to}`
    );
    return {
      queued: true,
      skipped: false,
      provider: EMAIL_PROVIDER,
    };
  }

  if (EMAIL_PROVIDER === 'test') {
    const entry = {
      ...deliveryRecord,
      text: message.text,
      html: message.html,
      metadata: message.metadata ?? {},
    };
    testMailbox.push(entry);
    if (testMailbox.length > 200) {
      testMailbox.splice(0, testMailbox.length - 200);
    }
    writeTestLog(entry);
    return {
      queued: true,
      skipped: false,
      provider: EMAIL_PROVIDER,
    };
  }

  if (EMAIL_PROVIDER === 'sendgrid') {
    await sendWithSendgrid(message);
    return {
      queued: true,
      skipped: false,
      provider: EMAIL_PROVIDER,
    };
  }

  if (EMAIL_PROVIDER === 'postmark') {
    await sendWithPostmark(message);
    return {
      queued: true,
      skipped: false,
      provider: EMAIL_PROVIDER,
    };
  }

  throw new Error(`Unsupported EMAIL_PROVIDER "${EMAIL_PROVIDER}".`);
}

export async function sendVerificationEmail({ to, name, token, metadata }) {
  const template = buildVerificationTemplate({ name, token });
  return deliverEmail({
    to,
    ...template,
    metadata: metadata ?? {},
  });
}

export async function sendPasswordResetEmail({ to, name, token, metadata }) {
  const template = buildPasswordResetTemplate({ name, token });
  return deliverEmail({
    to,
    ...template,
    metadata: metadata ?? {},
  });
}

export function getEmailDeliveryConfig() {
  return {
    provider: EMAIL_PROVIDER,
    from: EMAIL_FROM,
    appBaseUrl: APP_BASE_URL,
    sandboxMode: EMAIL_SANDBOX_MODE,
    testLogPathEnabled: Boolean(EMAIL_TEST_LOG_PATH),
  };
}

export function getTestMailboxSnapshot() {
  return testMailbox.map((entry) => ({ ...entry }));
}

export function clearTestMailbox() {
  testMailbox.length = 0;
}

export function __internalTemplates() {
  return {
    buildVerificationTemplate,
    buildPasswordResetTemplate,
  };
}
