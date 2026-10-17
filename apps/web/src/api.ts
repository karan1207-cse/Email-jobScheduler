import type { HealthCheckResponse, ApiRootResponse, EmailDto, PaginatedResponse } from '@reachinbox/shared';

// API base URL configured via Vite environment variables
export const API_BASE_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:5000';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  picture?: string | null;
}

/**
 * Health & Telemetry
 */
export async function fetchApiRoot(): Promise<ApiRootResponse> {
  const response = await fetch(`${API_BASE_URL}/`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`API returned HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json() as Promise<ApiRootResponse>;
}

export async function fetchApiHealth(): Promise<HealthCheckResponse> {
  const response = await fetch(`${API_BASE_URL}/health`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'include',
  });
  if (response.status === 200 || response.status === 503) {
    return response.json() as Promise<HealthCheckResponse>;
  }
  throw new Error(`API health check failed with HTTP ${response.status}: ${response.statusText}`);
}

/**
 * Authentication (Milestone 6)
 */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/me`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'include',
    });
    if (response.status === 401) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Failed to fetch current user (HTTP ${response.status})`);
    }
    return (await response.json()) as AuthUser;
  } catch (err) {
    console.warn('[API] Could not fetch current user:', err);
    return null;
  }
}

export async function loginWithEmail(email: string, password?: string): Promise<AuthUser> {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => null);
    throw new Error(errBody?.error?.message || `Login failed (HTTP ${response.status})`);
  }

  const data = await response.json();
  return data.user as AuthUser;
}

export async function logoutUser(): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/auth/logout`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Logout failed (HTTP ${response.status})`);
  }
}

export async function searchEmailsApi(
  q?: string,
  status?: string,
  page: number = 1,
  limit: number = 20
): Promise<PaginatedResponse<EmailDto>> {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (q && q.trim()) {
    params.append('q', q.trim());
  }
  if (status && status !== 'ALL') {
    params.append('status', status);
  }

  const response = await fetch(`${API_BASE_URL}/api/search/emails?${params.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'include',
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => null);
    throw new Error(errBody?.error?.message || `Search failed (HTTP ${response.status})`);
  }

  const result = await response.json() as {
    data: EmailDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  return {
    data: result.data,
    pagination: {
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    },
  };
}


/**
 * Email Operations
 */
export async function listEmails(
  page: number = 1,
  limit: number = 10,
  status?: string
): Promise<PaginatedResponse<EmailDto>> {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (status && status !== 'ALL') {
    params.append('status', status);
  }

  const response = await fetch(`${API_BASE_URL}/api/emails?${params.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'include',
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => null);
    throw new Error(errBody?.error?.message || `Failed to list emails (HTTP ${response.status})`);
  }

  return response.json() as Promise<PaginatedResponse<EmailDto>>;
}

export async function getEmailById(id: string): Promise<EmailDto> {
  const response = await fetch(`${API_BASE_URL}/api/emails/${id}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'include',
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => null);
    throw new Error(errBody?.error?.message || `Failed to fetch email (HTTP ${response.status})`);
  }

  return response.json() as Promise<EmailDto>;
}

export interface CreateDraftPayload {
  recipient: string;
  subject: string;
  body: string;
  attachments?: Array<{ filename: string; contentType: string; size: number; contentBase64: string }>;
}

export async function createDraftEmail(
  payload: CreateDraftPayload,
  idempotencyKey?: string
): Promise<EmailDto> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  if (idempotencyKey?.trim()) {
    headers['Idempotency-Key'] = idempotencyKey.trim();
  }

  const response = await fetch(`${API_BASE_URL}/api/emails`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => null);
    throw new Error(errBody?.error?.message || `Failed to create email (HTTP ${response.status})`);
  }

  return response.json() as Promise<EmailDto>;
}

export async function updateDraftEmail(
  id: string,
  updates: Partial<CreateDraftPayload>
): Promise<EmailDto> {
  const response = await fetch(`${API_BASE_URL}/api/emails/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => null);
    throw new Error(errBody?.error?.message || `Failed to update email (HTTP ${response.status})`);
  }

  return response.json() as Promise<EmailDto>;
}

export async function deleteDraftEmail(id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/emails/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => null);
    throw new Error(errBody?.error?.message || `Failed to delete draft (HTTP ${response.status})`);
  }
}

/**
 * Scheduler Operations (Milestones 3, 5, 6)
 */
export async function scheduleEmail(id: string, scheduledTime: string): Promise<EmailDto> {
  const response = await fetch(`${API_BASE_URL}/api/emails/${id}/schedule`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ scheduledTime }),
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => null);
    throw new Error(errBody?.error?.message || `Failed to schedule email (HTTP ${response.status})`);
  }

  return response.json() as Promise<EmailDto>;
}

export async function cancelScheduledEmail(id: string): Promise<EmailDto> {
  const response = await fetch(`${API_BASE_URL}/api/emails/${id}/cancel`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    credentials: 'include',
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => null);
    throw new Error(errBody?.error?.message || `Failed to cancel email (HTTP ${response.status})`);
  }

  return response.json() as Promise<EmailDto>;
}
