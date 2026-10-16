import type { HealthCheckResponse, ApiRootResponse } from '@reachinbox/shared';

// API base URL configured via Vite environment variables
export const API_BASE_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:5000';

export async function fetchApiRoot(): Promise<ApiRootResponse> {
  const response = await fetch(`${API_BASE_URL}/`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`API returned HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json() as Promise<ApiRootResponse>;
}

export async function fetchApiHealth(): Promise<HealthCheckResponse> {
  const response = await fetch(`${API_BASE_URL}/health`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
  });

  // Note: /health returns 503 when degraded/unhealthy, but still provides valid JSON body with service details!
  if (response.status === 200 || response.status === 503) {
    return response.json() as Promise<HealthCheckResponse>;
  }

  throw new Error(`API health check failed with HTTP ${response.status}: ${response.statusText}`);
}
