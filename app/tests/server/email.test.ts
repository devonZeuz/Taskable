import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, beforeEach } from 'vitest';

async function loadEmailModule() {
  const modulePath = path.resolve(process.cwd(), 'server/src/email.js');
  const moduleUrl = `${pathToFileURL(modulePath).href}?t=${Date.now()}_${Math.random()}`;
  return import(moduleUrl);
}

describe('email delivery service', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.EMAIL_PROVIDER = 'test';
    process.env.EMAIL_FROM = 'Tareva <no-reply@testable.local>';
    process.env.APP_BASE_URL = 'http://localhost:5173';
    process.env.EMAIL_SANDBOX_MODE = 'false';
    process.env.EMAIL_TEST_LOG_PATH = '';
  });

  it('queues verification email in test mailbox', async () => {
    const emailModule = await loadEmailModule();
    emailModule.clearTestMailbox();

    const result = await emailModule.sendVerificationEmail({
      to: 'qa@example.com',
      name: 'QA User',
      token: 'verify-token-123',
    });

    expect(result.queued).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.provider).toBe('test');

    const mailbox = emailModule.getTestMailboxSnapshot();
    expect(mailbox).toHaveLength(1);
    expect(mailbox[0].to).toBe('qa@example.com');
    expect(mailbox[0].template).toBe('verify-email');
    expect(mailbox[0].actionUrl).toContain('verifyToken=verify-token-123');
  });

  it('queues password reset email in test mailbox', async () => {
    const emailModule = await loadEmailModule();
    emailModule.clearTestMailbox();

    const result = await emailModule.sendPasswordResetEmail({
      to: 'qa@example.com',
      name: 'QA User',
      token: 'reset-token-456',
    });

    expect(result.queued).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.provider).toBe('test');

    const mailbox = emailModule.getTestMailboxSnapshot();
    expect(mailbox).toHaveLength(1);
    expect(mailbox[0].template).toBe('password-reset');
    expect(mailbox[0].actionUrl).toContain('resetToken=reset-token-456');
  });

  it('exposes provider configuration for runbooks', async () => {
    const emailModule = await loadEmailModule();
    const config = emailModule.getEmailDeliveryConfig();

    expect(config.provider).toBe('test');
    expect(config.from).toContain('Tareva');
    expect(config.appBaseUrl).toBe('http://localhost:5173');
  });

  it('fails fast when provider request times out', async () => {
    process.env.EMAIL_PROVIDER = 'sendgrid';
    process.env.SENDGRID_API_KEY = 'test-key';
    process.env.EMAIL_PROVIDER_TIMEOUT_MS = '15';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        signal?.addEventListener(
          'abort',
          () => {
            reject(new DOMException('Aborted', 'AbortError'));
          },
          { once: true }
        );
      })) as typeof fetch;

    try {
      const emailModule = await loadEmailModule();
      await expect(
        emailModule.sendVerificationEmail({
          to: 'qa@example.com',
          name: 'QA User',
          token: 'verify-token-timeout',
        })
      ).rejects.toThrow('timed out');
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.EMAIL_PROVIDER_TIMEOUT_MS;
      delete process.env.SENDGRID_API_KEY;
    }
  });
});
