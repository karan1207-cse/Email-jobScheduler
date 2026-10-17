import { z } from 'zod';

const emailAttachmentSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(255),
  size: z.number().int().positive().max(5 * 1024 * 1024),
  contentBase64: z.string().min(1).max(7 * 1024 * 1024).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
}).strict().refine((file) => {
  const padding = file.contentBase64.endsWith('==') ? 2 : file.contentBase64.endsWith('=') ? 1 : 0;
  return Math.floor(file.contentBase64.length * 3 / 4) - padding === file.size;
}, 'Attachment size does not match its contents');

export const emailStatusEnum = z.enum([
  'DRAFT',
  'SCHEDULED',
  'PROCESSING',
  'SENT',
  'FAILED',
  'CANCELLED',
]);

export const createEmailSchema = z.object({
  recipient: z
    .string({ required_error: 'Recipient email address is required' })
    .trim()
    .email('Invalid recipient email address format')
    .max(320, 'Recipient email address must not exceed 320 characters'),
  subject: z
    .string({ required_error: 'Email subject is required' })
    .trim()
    .min(1, 'Subject cannot be empty')
    .max(500, 'Subject must not exceed 500 characters'),
  body: z
    .string({ required_error: 'Email body is required' })
    .min(1, 'Body cannot be empty')
    .max(50000, 'Body must not exceed 50,000 characters'),
  attachments: z.array(emailAttachmentSchema).max(5, 'You can attach up to 5 files').optional().default([])
    .refine((files) => files.reduce((sum, file) => sum + file.size, 0) <= 8 * 1024 * 1024, 'Attachments must total 8 MB or less'),
}).strict();

export const updateEmailSchema = z.object({
  recipient: z
    .string()
    .trim()
    .email('Invalid recipient email address format')
    .max(320, 'Recipient email address must not exceed 320 characters')
    .optional(),
  subject: z
    .string()
    .trim()
    .min(1, 'Subject cannot be empty')
    .max(500, 'Subject must not exceed 500 characters')
    .optional(),
  body: z
    .string()
    .min(1, 'Body cannot be empty')
    .max(50000, 'Body must not exceed 50,000 characters')
    .optional(),
}).strict().refine((data) => data.recipient !== undefined || data.subject !== undefined || data.body !== undefined, {
  message: 'At least one editable field (recipient, subject, body) must be provided for update',
});

export const listEmailsQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'Page must be a positive integer greater than or equal to 1').default(1),
  limit: z.coerce.number().int().min(1).max(100, 'Limit cannot exceed 100').default(10),
  status: emailStatusEnum.optional(),
});

export const idParamSchema = z.object({
  id: z.string().uuid('ID must be a valid UUID'),
});

export type CreateEmailDto = z.infer<typeof createEmailSchema>;
export type UpdateEmailDto = z.infer<typeof updateEmailSchema>;
export type ListEmailsQuery = z.infer<typeof listEmailsQuerySchema>;
