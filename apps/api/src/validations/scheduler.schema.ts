import { z } from 'zod';

export const scheduleEmailSchema = z.object({
  scheduledTime: z
    .string({ required_error: 'scheduledTime is required' })
    .datetime({ message: 'scheduledTime must be a valid ISO-8601 datetime string (e.g. 2025-12-01T10:00:00Z)' }),
}).strict();

export type ScheduleEmailInput = z.infer<typeof scheduleEmailSchema>;
