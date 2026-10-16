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
} from '../mailer.js';

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
});
