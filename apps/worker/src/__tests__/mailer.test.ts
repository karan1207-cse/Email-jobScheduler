/**
 * Unit tests for SMTP Mailer Module (Milestone 5)
 *
 * Verifies:
 * 1. Successful send returns messageId and Ethereal previewUrl.
 * 2. MIME plain-text fallback generation from HTML.
 * 3. Detection of SMTP recipient rejection (info.rejected) and error throw.
 * 4. Transporter injection and reset for testing.
 * 5. Credential leakage prevention (no passwords logged).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import nodemailer, { type Transporter } from 'nodemailer';
import {
  sendEmail,
  SmtpRecipientRejectedError,
  setMailTransporter,
  resetMailTransporter,
  getMailTransporter,
  setMailerAccountCache,
  ETHEREAL_ACCOUNT_KEY,
} from '../mailer.js';
import type { Redis } from 'ioredis';

describe('SMTP Mailer Module (Milestone 5)', () => {
  let mockSendMail: ReturnType<typeof vi.fn>;
  let mockTransporter: Transporter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMail = vi.fn().mockResolvedValue({
      messageId: '<test-message-123@reachinbox.test>',
      accepted: ['recipient@example.com'],
      rejected: [],
      response: '250 OK: message accepted',
    });

    mockTransporter = {
      sendMail: mockSendMail,
    } as unknown as Transporter;

    setMailTransporter(mockTransporter);
  });

  afterEach(() => {
    resetMailTransporter();
  });

  describe('sendEmail', () => {
    it('should successfully send an email with HTML and auto-generated plain-text fallback', async () => {
      const result = await sendEmail({
        to: 'recipient@example.com',
        subject: 'Weekly Report',
        html: '<p>Hello <strong>World</strong>!</p>',
      });

      expect(mockSendMail).toHaveBeenCalledOnce();
      expect(mockSendMail).toHaveBeenCalledWith({
        from: expect.any(String),
        to: 'recipient@example.com',
        subject: 'Weekly Report',
        html: '<p>Hello <strong>World</strong>!</p>',
        text: 'Hello World!', // Tags stripped for fallback
      });

      expect(result.messageId).toBe('<test-message-123@reachinbox.test>');
    });

    it('should preserve custom plain-text when explicitly provided', async () => {
      await sendEmail({
        to: 'recipient@example.com',
        subject: 'Custom Text',
        html: '<h1>Title</h1>',
        text: 'Custom plain text version',
      });

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Custom plain text version',
          html: '<h1>Title</h1>',
        })
      );
    });

    it('should attach the decoded file content to the SMTP message', async () => {
      await sendEmail({
        to: 'recipient@example.com',
        subject: 'Attachment test',
        html: '<p>See attached.</p>',
        attachments: [{
          filename: 'notes.txt',
          contentType: 'text/plain',
          contentBase64: Buffer.from('hello').toString('base64'),
        }],
      });

      expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
        attachments: [{
          filename: 'notes.txt',
          contentType: 'text/plain',
          content: Buffer.from('hello'),
        }],
      }));
    });

    it('should throw SmtpRecipientRejectedError when SMTP server rejects the recipient', async () => {
      mockSendMail.mockResolvedValueOnce({
        messageId: '<rejected-123@reachinbox.test>',
        accepted: [],
        rejected: ['recipient@example.com'],
        response: '550 5.1.1 User unknown',
      });

      await expect(
        sendEmail({
          to: 'recipient@example.com',
          subject: 'Bounce Test',
          html: '<p>Testing bounce</p>',
        })
      ).rejects.toThrow(SmtpRecipientRejectedError);

      try {
        await sendEmail({
          to: 'recipient@example.com',
          subject: 'Bounce Test',
          html: '<p>Testing bounce</p>',
        });
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(SmtpRecipientRejectedError);
        const rejection = err as SmtpRecipientRejectedError;
        expect(rejection.recipient).toBe('recipient@example.com');
        expect(rejection.rejectionDetails).toEqual(['recipient@example.com']);
      }
    });

    it('should extract preview URL when nodemailer.getTestMessageUrl returns one', async () => {
      const spyGetTestMessageUrl = vi
        .spyOn(nodemailer, 'getTestMessageUrl')
        .mockReturnValue('https://ethereal.email/message/test456');

      const result = await sendEmail({
        to: 'recipient@example.com',
        subject: 'Preview Test',
        html: '<p>Testing preview</p>',
      });

      expect(result.previewUrl).toBe('https://ethereal.email/message/test456');
      spyGetTestMessageUrl.mockRestore();
    });

    it('should return previewUrl as null when nodemailer.getTestMessageUrl returns false', async () => {
      const spyGetTestMessageUrl = vi
        .spyOn(nodemailer, 'getTestMessageUrl')
        .mockReturnValue(false);

      const result = await sendEmail({
        to: 'recipient@example.com',
        subject: 'Production Send',
        html: '<p>Production content</p>',
      });

      expect(result.previewUrl).toBeNull();
      spyGetTestMessageUrl.mockRestore();
    });

    it('should propagate raw SMTP network/transport errors', async () => {
      mockSendMail.mockRejectedValueOnce(new Error('Connection timeout to SMTP server'));

      await expect(
        sendEmail({
          to: 'recipient@example.com',
          subject: 'Timeout Test',
          html: '<p>Timeout</p>',
        })
      ).rejects.toThrow('Connection timeout to SMTP server');
    });
  });

  describe('Transporter Lifecycle & Credential Safety', () => {
    it('should allow setting and resetting the transporter', async () => {
      setMailTransporter(mockTransporter);
      expect(await getMailTransporter()).toBe(mockTransporter);

      resetMailTransporter();
      // After reset, calling getMailTransporter initializes either configured or ethereal
      // We spy on nodemailer.createTransport
      const spyCreateTransport = vi.spyOn(nodemailer, 'createTransport').mockReturnValue(mockTransporter);
      const transporter = await getMailTransporter();
      expect(transporter).toBeDefined();
      spyCreateTransport.mockRestore();
    });

    it('should not log credentials when creating Ethereal accounts', async () => {
      resetMailTransporter();
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const spyCreateAccount = vi.spyOn(nodemailer, 'createTestAccount').mockResolvedValueOnce({
        user: 'test_user@ethereal.email',
        pass: 'super_secret_password_123',
        smtp: { host: 'smtp.ethereal.email', port: 587, secure: false },
        imap: { host: 'imap.ethereal.email', port: 993, secure: true },
        pop3: { host: 'pop3.ethereal.email', port: 995, secure: true },
        web: 'https://ethereal.email',
      });

      const spyCreateTransport = vi.spyOn(nodemailer, 'createTransport').mockReturnValue(mockTransporter);

      await getMailTransporter();

      const loggedStrings = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(loggedStrings).not.toContain('super_secret_password_123');
      expect(loggedStrings).toContain('test_user@ethereal.email');

      consoleSpy.mockRestore();
      spyCreateAccount.mockRestore();
      spyCreateTransport.mockRestore();
    });
  });

  describe('Ethereal inbox and sender identity', () => {
    const account = {
      user: 'shared_inbox@ethereal.email',
      pass: 'pw',
      smtp: { host: 'smtp.ethereal.email', port: 587, secure: false },
      imap: { host: 'imap.ethereal.email', port: 993, secure: true },
      pop3: { host: 'pop3.ethereal.email', port: 995, secure: true },
      web: 'https://ethereal.email',
    };

    function memoryRedis(initial?: string) {
      const store = new Map<string, string>(initial ? [[ETHEREAL_ACCOUNT_KEY, initial]] : []);
      return {
        store,
        get: vi.fn(async (k: string) => store.get(k) ?? null),
        set: vi.fn(async (k: string, v: string) => (store.has(k) ? null : (store.set(k, v), 'OK'))),
        del: vi.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
      };
    }

    beforeEach(() => {
      resetMailTransporter();
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(nodemailer, 'createTransport').mockReturnValue(mockTransporter);
    });

    afterEach(() => {
      setMailerAccountCache(null);
      vi.restoreAllMocks();
    });

    it('creates one Ethereal account for concurrent first sends and caches it in Redis', async () => {
      const redis = memoryRedis();
      setMailerAccountCache(redis as unknown as Redis);
      const create = vi.spyOn(nodemailer, 'createTestAccount').mockResolvedValue(account);

      await Promise.all([1, 2, 3, 4, 5].map(() => getMailTransporter()));

      expect(create).toHaveBeenCalledOnce();
      expect(JSON.parse(redis.store.get(ETHEREAL_ACCOUNT_KEY)!).user).toBe(account.user);
    });

    it('reuses the cached inbox after a worker restart instead of creating a new one', async () => {
      const redis = memoryRedis(JSON.stringify({ user: account.user, pass: 'pw', smtp: account.smtp }));
      setMailerAccountCache(redis as unknown as Redis);
      const create = vi.spyOn(nodemailer, 'createTestAccount');

      await getMailTransporter();

      expect(create).not.toHaveBeenCalled();
      expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({
        auth: { user: account.user, pass: 'pw' },
      }));
    });

    it('sends From the sender on Ethereal, so each sender is visible in the inbox', async () => {
      vi.spyOn(nodemailer, 'createTestAccount').mockResolvedValue(account);
      await sendEmail({
        to: 'recipient@example.com', subject: 's', html: '<p>x</p>',
        sender: { email: 'alice@sender.test', name: 'Alice' },
      });
      expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
        from: { name: 'Alice', address: 'alice@sender.test' },
        replyTo: undefined,
      }));
    });

    it('keeps the relay From and puts the sender in Reply-To on a real SMTP relay', async () => {
      setMailTransporter(mockTransporter);
      await sendEmail({
        to: 'recipient@example.com', subject: 's', html: '<p>x</p>',
        sender: { email: 'alice@sender.test', name: null },
      });
      expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
        from: expect.any(String),
        replyTo: { name: 'alice@sender.test', address: 'alice@sender.test' },
      }));
    });

    it('drops an expired Ethereal inbox on EAUTH so the next attempt creates a fresh one', async () => {
      const redis = memoryRedis();
      setMailerAccountCache(redis as unknown as Redis);
      const create = vi.spyOn(nodemailer, 'createTestAccount').mockResolvedValue(account);
      mockSendMail.mockRejectedValueOnce(Object.assign(new Error('Invalid login'), { code: 'EAUTH' }));

      await expect(sendEmail({ to: 'recipient@example.com', subject: 's', html: 'x' })).rejects.toThrow('Invalid login');
      expect(redis.store.has(ETHEREAL_ACCOUNT_KEY)).toBe(false);

      await sendEmail({ to: 'recipient@example.com', subject: 's', html: 'x' });
      expect(create).toHaveBeenCalledTimes(2);
    });
  });
});
