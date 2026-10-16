/**
 * BullMQ Job Type Definitions
 */

export interface EmailJobData {
  emailId: string;
  recipient: string;
  subject: string;
  body: string;
  scheduledTime: string; // ISO-8601
  attemptOverride?: number; // For manual re-queues from outbox recovery
}

export const EMAIL_JOB_NAME = 'send-email' as const;
