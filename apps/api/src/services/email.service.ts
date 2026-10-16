import crypto from 'node:crypto';
import type { Email, EmailStatus } from '@prisma/client';
import type { EmailDto, PaginatedResponse } from '@reachinbox/shared';
import { getPrismaClient } from '../db/prisma.js';
import { ConflictError, NotFoundError } from '../middleware/errorHandler.js';
import type { CreateEmailDto, UpdateEmailDto, ListEmailsQuery } from '../validations/email.schema.js';

// ==============================================================================
// Development User Scoping (Milestone 2 Limitation)
// ==============================================================================
// Full Google OAuth authentication is deferred to Milestone 4.
// For Milestone 2 local development, a deterministic seeded development user
// enforces proper ownership relationships without insecure client-supplied IDs.
export const DEV_DEFAULT_USER = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'dev@reachinbox.local',
  displayName: 'ReachInbox Local Developer',
};

export async function ensureDevUser(): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.user.upsert({
    where: { id: DEV_DEFAULT_USER.id },
    update: {},
    create: {
      id: DEV_DEFAULT_USER.id,
      email: DEV_DEFAULT_USER.email,
      displayName: DEV_DEFAULT_USER.displayName,
    },
  });
}

function computeFingerprint(payload: { recipient: string; subject: string; body: string }): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      recipient: payload.recipient.trim().toLowerCase(),
      subject: payload.subject.trim(),
      body: payload.body,
    }))
    .digest('hex');
}

function mapToDto(email: Email): EmailDto {
  return {
    id: email.id,
    userId: email.userId,
    recipient: email.recipient,
    subject: email.subject,
    body: email.body,
    status: email.status as EmailDto['status'],
    scheduledTime: email.scheduledTime ? email.scheduledTime.toISOString() : null,
    sentAt: email.sentAt ? email.sentAt.toISOString() : null,
    idempotencyKey: email.idempotencyKey,
    attemptCount: email.attemptCount,
    lastError: email.lastError,
    createdAt: email.createdAt.toISOString(),
    updatedAt: email.updatedAt.toISOString(),
  };
}

export interface CreateEmailResult {
  email: EmailDto;
  isReplay: boolean;
}

export async function createDraftEmail(
  input: CreateEmailDto,
  idempotencyKey?: string
): Promise<CreateEmailResult> {
  const prisma = getPrismaClient();
  await ensureDevUser();

  const trimmedKey = idempotencyKey?.trim() || null;
  const fingerprint = computeFingerprint(input);

  // Idempotency check with transactional isolation
  if (trimmedKey) {
    const existing = await prisma.email.findUnique({
      where: {
        userId_idempotencyKey: {
          userId: DEV_DEFAULT_USER.id,
          idempotencyKey: trimmedKey,
        },
      },
    });

    if (existing) {
      if (existing.requestFingerprint === fingerprint) {
        // Legitimate retry of identical payload
        return {
          email: mapToDto(existing),
          isReplay: true,
        };
      }

      // Re-use of key with differing request payload
      throw new ConflictError(
        `Idempotency key '${trimmedKey}' was already used with a different request payload.`
      );
    }
  }

  // Persist new draft email
  try {
    const created = await prisma.email.create({
      data: {
        userId: DEV_DEFAULT_USER.id,
        recipient: input.recipient.trim(),
        subject: input.subject.trim(),
        body: input.body,
        status: 'DRAFT',
        idempotencyKey: trimmedKey,
        requestFingerprint: trimmedKey ? fingerprint : null,
      },
    });

    return {
      email: mapToDto(created),
      isReplay: false,
    };
  } catch (err: unknown) {
    // Handle concurrent insertion race condition where key was inserted between check and create
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002') {
      const concurrentExisting = await prisma.email.findUnique({
        where: {
          userId_idempotencyKey: {
            userId: DEV_DEFAULT_USER.id,
            idempotencyKey: trimmedKey!,
          },
        },
      });

      if (concurrentExisting) {
        if (concurrentExisting.requestFingerprint === fingerprint) {
          return {
            email: mapToDto(concurrentExisting),
            isReplay: true,
          };
        }
        throw new ConflictError(
          `Idempotency key '${trimmedKey}' was already used with a different request payload.`
        );
      }
    }
    throw err;
  }
}

export async function listEmails(
  query: ListEmailsQuery
): Promise<PaginatedResponse<EmailDto>> {
  const prisma = getPrismaClient();
  await ensureDevUser();

  const { page, limit, status } = query;
  const skip = (page - 1) * limit;

  const where = {
    userId: DEV_DEFAULT_USER.id,
    ...(status ? { status: status as EmailStatus } : {}),
  };

  const [records, total] = await Promise.all([
    prisma.email.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.email.count({ where }),
  ]);

  return {
    data: records.map(mapToDto),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

export async function getEmailById(id: string): Promise<EmailDto> {
  const prisma = getPrismaClient();
  await ensureDevUser();

  const record = await prisma.email.findFirst({
    where: {
      id,
      userId: DEV_DEFAULT_USER.id,
    },
  });

  if (!record) {
    throw new NotFoundError(`Email record with ID '${id}' was not found.`);
  }

  return mapToDto(record);
}

export async function updateDraftEmail(
  id: string,
  updates: UpdateEmailDto
): Promise<EmailDto> {
  const prisma = getPrismaClient();
  await ensureDevUser();

  const existing = await prisma.email.findFirst({
    where: {
      id,
      userId: DEV_DEFAULT_USER.id,
    },
  });

  if (!existing) {
    throw new NotFoundError(`Email record with ID '${id}' was not found.`);
  }

  if (existing.status !== 'DRAFT') {
    throw new ConflictError(
      `Cannot update email with status '${existing.status}'. Only emails in 'DRAFT' status can be modified.`
    );
  }

  const updated = await prisma.email.update({
    where: { id },
    data: {
      ...(updates.recipient ? { recipient: updates.recipient.trim() } : {}),
      ...(updates.subject ? { subject: updates.subject.trim() } : {}),
      ...(updates.body !== undefined ? { body: updates.body } : {}),
    },
  });

  return mapToDto(updated);
}

export async function deleteDraftEmail(id: string): Promise<void> {
  const prisma = getPrismaClient();
  await ensureDevUser();

  const existing = await prisma.email.findFirst({
    where: {
      id,
      userId: DEV_DEFAULT_USER.id,
    },
  });

  if (!existing) {
    throw new NotFoundError(`Email record with ID '${id}' was not found.`);
  }

  if (existing.status !== 'DRAFT') {
    throw new ConflictError(
      `Cannot delete email with status '${existing.status}'. Only emails in 'DRAFT' status can be deleted.`
    );
  }

  await prisma.email.delete({
    where: { id },
  });
}
