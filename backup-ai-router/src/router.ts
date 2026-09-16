import type { CompletionRequest, CompletionResponse } from './types.ts';
import { AgentPool } from './agents/pool.ts';

const pool = new AgentPool();

export function getPool(): AgentPool {
  return pool;
}

export async function routeRequest(request: CompletionRequest): Promise<CompletionResponse> {
  console.log('[router] routeRequest called');
  return pool.routeRequest(request);
}

export function getAgentStates() {
  return pool.getAllStates();
}

export function selectBestAgent() {
  return pool.selectBestAgent();
}
