/**
 * SMTP Mailer Module — Milestone 5
 *
 * Handles SMTP delivery with:
 * 1. Configured SMTP transport (production/staging) or Ethereal test account (development).
 * 2. MIME multipart delivery (HTML body + plain-text fallback).
 * 3. Recipient acceptance verification (checks info.rejected).
 * 4. Safe Ethereal preview URL generation without credential leakage.
 * 5. Dependency-injectable transporter for unit testing.
 */
import nodemailer, { type Transporter, type SentMessageInfo } from 'nodemailer';
import { workerConfig } from './config.js';

let transporter: Transporter | null = null;
let etherealTestUrl: string | null = null;

/**
 * Custom error thrown when the SMTP relay accepts the connection
 * but explicitly rejects the recipient address (e.g. 550 User unknown).
 */
export class SmtpRecipientRejectedError extends Error {
  constructor(public readonly recipient: string, public readonly rejectionDetails?: unknown) {
    super(`SMTP rejected recipient: ${recipient}`);
    this.name = 'SmtpRecipientRejectedError';
  }
}

async function createEtherealTransporter(): Promise<Transporter> {
  console.log('[Mailer] No custom SMTP credentials — creating Ethereal test account...');
  const testAccount = await nodemailer.createTestAccount();
  etherealTestUrl = `https://ethereal.email/login`;
  console.log('[Mailer] ✅ Ethereal test account created:');
  console.log(`         Account: ${testAccount.user}`);
  console.log(`         Host:    ${testAccount.smtp.host}:${testAccount.smtp.port}`);
  console.log(`         Portal:  ${etherealTestUrl}`);

  return nodemailer.createTransport({
    host: testAccount.smtp.host,
    port: testAccount.smtp.port,
    secure: testAccount.smtp.secure,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });
}

export async function getMailTransporter(): Promise<Transporter> {
  if (transporter) return transporter;

  if (workerConfig.SMTP_HOST && workerConfig.SMTP_USER && workerConfig.SMTP_PASS) {
    // Use configured SMTP (production/staging)
    transporter = nodemailer.createTransport({
      host: workerConfig.SMTP_HOST,
      port: workerConfig.SMTP_PORT,
      secure: workerConfig.SMTP_PORT === 465,
      auth: {
        user: workerConfig.SMTP_USER,
        pass: workerConfig.SMTP_PASS,
      },
    });
    console.log(`[Mailer] Using configured SMTP: ${workerConfig.SMTP_HOST}:${workerConfig.SMTP_PORT}`);
  } else {
    // Fallback to Ethereal for local dev/test
    transporter = await createEtherealTransporter();
  }

  return transporter;
}

export function setMailTransporter(custom: Transporter | null): void {
  transporter = custom;
}

export function resetMailTransporter(): void {
  transporter = null;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface SendResult {
  messageId: string;
  previewUrl: string | null;
}

export async function sendEmail(options: SendEmailOptions): Promise<SendResult> {
  const mailer = await getMailTransporter();

  // Strip basic HTML tags for plain text fallback if text not provided
  const textContent = options.text ?? options.html.replace(/<[^>]*>/g, '').trim();

  const info: SentMessageInfo = await mailer.sendMail({
    from: workerConfig.SMTP_FROM,
    to: options.to,
    subject: options.subject,
    text: textContent,
    html: options.html,
  });

  // Verify recipient acceptance by the SMTP server
  if (Array.isArray(info.rejected) && info.rejected.length > 0 && info.rejected.includes(options.to)) {
    throw new SmtpRecipientRejectedError(options.to, info.rejected);
  }

  // nodemailer.getTestMessageUrl returns the Ethereal preview link (null if not Ethereal)
  const previewUrl = nodemailer.getTestMessageUrl(info) || null;

  return {
    messageId: info.messageId as string,
    previewUrl: typeof previewUrl === 'string' ? previewUrl : null,
  };
}
