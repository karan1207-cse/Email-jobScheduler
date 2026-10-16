/**
 * ReachInbox Shared Contracts and Types
 */

// ==============================================================================
// Health Check Contracts
// ==============================================================================
export type ServiceStatus = 'up' | 'down';
export type SystemStatus = 'healthy' | 'unhealthy' | 'degraded';

export interface DependencyHealth {
  status: ServiceStatus;
  latencyMs?: number;
  message?: string;
}

export interface HealthCheckServices {
  database: DependencyHealth;
  redis: DependencyHealth;
}

export interface HealthCheckResponse {
  status: SystemStatus;
  timestamp: string;
  uptime: number;
  services: HealthCheckServices;
}

export interface ApiRootResponse {
  name: string;
  version: string;
  status: string;
  description: string;
  timestamp: string;
}

// ==============================================================================
// Email & Data Model Contracts (Milestone 2)
// ==============================================================================
export type EmailStatus = 'DRAFT' | 'SCHEDULED' | 'PROCESSING' | 'SENT' | 'FAILED' | 'CANCELLED';

export interface EmailDto {
  id: string;
  userId: string;
  recipient: string;
  subject: string;
  body: string;
  status: EmailStatus;
  scheduledTime?: string | null;
  sentAt?: string | null;
  idempotencyKey?: string | null;
  attemptCount: number;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEmailInput {
  recipient: string;
  subject: string;
  body: string;
}

export interface UpdateEmailInput {
  recipient?: string;
  subject?: string;
  body?: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}

export interface ApiErrorResponse {
  error: {
    message: string;
    status: number;
    details?: unknown;
  };
}
