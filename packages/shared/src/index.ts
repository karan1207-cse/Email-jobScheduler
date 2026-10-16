/**
 * ReachInbox Shared Contracts and Types
 */

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
