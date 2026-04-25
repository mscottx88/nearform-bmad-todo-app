/**
 * Thin typed wrappers around the Story 6.1 agent endpoints. The
 * streaming `POST /chat` is intentionally NOT here — it lives in
 * [useAgentSse.ts](../hooks/useAgentSse.ts) because it needs the
 * `ReadableStream` reader, not the standard JSON-response pattern that
 * axios provides.
 *
 * Source-of-truth for the URL shape: `backend/src/api/agent.py`.
 */

import apiClient from './client';
import type { ChatMessage, ChatSessionSummary } from '../types/agent';

export async function listSessions(): Promise<ChatSessionSummary[]> {
  const { data } = await apiClient.get<ChatSessionSummary[]>('/agent/sessions');
  return data;
}

export async function getSession(id: string): Promise<ChatSessionSummary> {
  const { data } = await apiClient.get<ChatSessionSummary>(`/agent/sessions/${id}`);
  return data;
}

export async function getMessages(id: string): Promise<ChatMessage[]> {
  const { data } = await apiClient.get<ChatMessage[]>(
    `/agent/sessions/${id}/messages`,
  );
  return data;
}

export async function createSession(): Promise<ChatSessionSummary> {
  const { data } = await apiClient.post<ChatSessionSummary>('/agent/sessions');
  return data;
}

export async function deleteSession(id: string): Promise<void> {
  await apiClient.delete(`/agent/sessions/${id}`);
}

export async function cancelChat(id: string): Promise<void> {
  await apiClient.post(`/agent/sessions/${id}/cancel`);
}
