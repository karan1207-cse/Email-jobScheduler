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

import type { Redis } from 'ioredis';

let transporter: Transporter | null = null;
let pendingTransporter: Promise<Transporter> | null = null;
let usingEthereal = false;
let accountCache: Redis | null = null;

/** Redis key holding the shared Ethereal test inbox used by every worker. */
export const ETHEREAL_ACCOUNT_KEY = 'reachinbox:ethereal:test-account';
const ETHEREAL_LOGIN_URL = 'https://ethereal.email/login';

interface EtherealAccount {
  user: string;
  pass: string;
  smtp: { host: string; port: number; secure: boolean };
}

/**
 * Lets the mailer keep one Ethereal inbox in Redis, so worker restarts and
 * extra worker instances keep delivering into the same inbox you are logged into.
 */
export function setMailerAccountCache(redis: Redis | null): void {
  accountCache = redis;
}

export function isUsingEthereal(): boolean {
  return usingEthereal;
}

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

async function loadOrCreateEtherealAccount(): Promise<EtherealAccount> {
  if (accountCache) {
    try {
      const cached = await accountCache.get(ETHEREAL_ACCOUNT_KEY);
      if (cached) return JSON.parse(cached) as EtherealAccount;
    } catch (err) {
      console.warn('[Mailer] Could not read cached Ethereal account:', err instanceof Error ? err.message : err);
    }
  }

  console.log('[Mailer] No custom SMTP credentials — creating Ethereal test account...');
  const created = await nodemailer.createTestAccount();
  const account: EtherealAccount = {
    user: created.user,
    pass: created.pass,
    smtp: { host: created.smtp.host, port: created.smtp.port, secure: created.smtp.secure },
  };

  if (accountCache) {
    try {
      // NX: if another worker stored an account first, use that one instead.
      const stored = await accountCache.set(ETHEREAL_ACCOUNT_KEY, JSON.stringify(account), 'NX');
      if (!stored) {
        const winner = await accountCache.get(ETHEREAL_ACCOUNT_KEY);
        if (winner) return JSON.parse(winner) as EtherealAccount;
      }
    } catch (err) {
      console.warn('[Mailer] Could not cache Ethereal account:', err instanceof Error ? err.message : err);
    }
  }
  return account;
}

async function createEtherealTransporter(): Promise<Transporter> {
  const account = await loadOrCreateEtherealAccount();
  // The password is never logged. Each sent email's preview link is stored and
  // shown in the dashboard; for a fixed inbox you can log into, create one at
  // ethereal.email and set SMTP_HOST/SMTP_USER/SMTP_PASS.
  console.log('[Mailer] ✅ Using Ethereal test inbox:');
  console.log(`         Account: ${account.user}`);
  console.log(`         Host:    ${account.smtp.host}:${account.smtp.port}`);
  console.log(`         Portal:  ${ETHEREAL_LOGIN_URL}`);

  usingEthereal = true;
  return nodemailer.createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    auth: {
      user: account.user,
      pass: account.pass,
    },
  });
}

export async function getMailTransporter(): Promise<Transporter> {
  if (transporter) return transporter;

  if (workerConfig.SMTP_HOST && workerConfig.SMTP_USER && workerConfig.SMTP_PASS) {
    // Use configured SMTP (production/staging)
    usingEthereal = workerConfig.SMTP_HOST.includes('ethereal.email');
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
    // Fallback to Ethereal for local dev/test. Concurrent jobs share one
    // in-flight setup instead of each creating its own test account.
    pendingTransporter ??= createEtherealTransporter().finally(() => { pendingTransporter = null; });
    transporter = await pendingTransporter;
  }

  return transporter;
}

export function setMailTransporter(custom: Transporter | null): void {
  transporter = custom;
}

export function resetMailTransporter(): void {
  transporter = null;
  usingEthereal = false;
}

export interface SendEmailOptions {
  to: string;
  /** Sender identity. Used as From on Ethereal; as Reply-To on a real relay. */
  sender?: { email: string; name?: string | null };
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{ filename: string; contentType: string; contentBase64: string }>;
}

export interface SendResult {
  messageId: string;
  previewUrl: string | null;
}

export async function sendEmail(options: SendEmailOptions): Promise<SendResult> {
  const mailer = await getMailTransporter();

  // Strip basic HTML tags for plain text fallback if text not provided
  const textContent = options.text ?? options.html.replace(/<[^>]*>/g, '').trim();

  // Ethereal accepts any From address, so each sender's emails show their own
  // identity there. Real relays usually only allow the authenticated From, so
  // the sender goes into Reply-To instead.
  const senderAddress = options.sender
    ? { name: options.sender.name || options.sender.email, address: options.sender.email }
    : null;
  const useSenderAsFrom = Boolean(senderAddress && usingEthereal);

  let info: SentMessageInfo;
  try {
    info = await mailer.sendMail({
      from: useSenderAsFrom ? senderAddress! : workerConfig.SMTP_FROM,
      replyTo: senderAddress && !useSenderAsFrom ? senderAddress : undefined,
      to: options.to,
      subject: options.subject,
      text: textContent,
      html: options.html,
      attachments: options.attachments?.map((attachment) => ({
        filename: attachment.filename,
        contentType: attachment.contentType,
        content: Buffer.from(attachment.contentBase64, 'base64'),
      })),
    });
  } catch (err) {
    // An expired Ethereal inbox fails auth; drop it so the next attempt creates a fresh one.
    if (usingEthereal && (err as { code?: string })?.code === 'EAUTH') {
      transporter = null;
      usingEthereal = false;
      await accountCache?.del(ETHEREAL_ACCOUNT_KEY).catch(() => 0);
    }
    throw err;
  }

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
