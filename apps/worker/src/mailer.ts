/**
 * Ethereal SMTP Mailer
 * On first call, creates an Ethereal test account and logs the preview URL.
 * Ethereal captures all sent emails — nothing actually reaches a real inbox.
 */
import nodemailer, { type Transporter, type SentMessageInfo } from 'nodemailer';
import { workerConfig } from './config.js';

let transporter: Transporter | null = null;
let etherealTestUrl: string | null = null;

async function createEtherealTransporter(): Promise<Transporter> {
  console.log('[Mailer] No SMTP credentials configured — creating Ethereal test account...');
  const testAccount = await nodemailer.createTestAccount();
  etherealTestUrl = `https://ethereal.email/login`;
  console.log('[Mailer] ✅ Ethereal test account created:');
  console.log(`         Username: ${testAccount.user}`);
  console.log(`         Password: ${testAccount.pass}`);
  console.log(`         Preview:  ${etherealTestUrl}`);

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

export interface SendResult {
  messageId: string;
  previewUrl: string | null;
}

export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
}): Promise<SendResult> {
  const mailer = await getMailTransporter();

  const info: SentMessageInfo = await mailer.sendMail({
    from: workerConfig.SMTP_FROM,
    to: options.to,
    subject: options.subject,
    html: options.html,
  });

  // nodemailer.getTestMessageUrl returns the Ethereal preview link (null if not Ethereal)
  const previewUrl = nodemailer.getTestMessageUrl(info) || null;

  if (previewUrl) {
    console.log(`[Mailer] 📧 Email preview URL: ${previewUrl}`);
  }

  return {
    messageId: info.messageId as string,
    previewUrl: typeof previewUrl === 'string' ? previewUrl : null,
  };
}
