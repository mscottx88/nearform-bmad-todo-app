import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, act, screen } from '@testing-library/react';

vi.mock('../../api/agentApi', () => ({
  listSessions: vi.fn(async () => []),
  getSession: vi.fn(),
  getMessages: vi.fn(async () => []),
  createSession: vi.fn(async () => ({
    id: 'sess-fresh',
    title: null,
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
  })),
  deleteSession: vi.fn(async () => {}),
  cancelChat: vi.fn(async () => {}),
}));

vi.mock('../../hooks/useAgentSse', () => ({
  streamAgentChat: vi.fn(async () => ({ abort: vi.fn() })),
}));

import * as agentApi from '../../api/agentApi';
import { AgentSessionsMenu } from './AgentSessionsMenu';
import { useAgentStore } from '../../stores/useAgentStore';

const mockedAgentApi = agentApi as unknown as {
  listSessions: ReturnType<typeof vi.fn>;
  getMessages: ReturnType<typeof vi.fn>;
  createSession: ReturnType<typeof vi.fn>;
  deleteSession: ReturnType<typeof vi.fn>;
};

function resetStore() {
  useAgentStore.setState({
    panelOpen: false,
    activeSessionId: null,
    sessions: [
      {
        id: 'sess-a',
        title: 'first conversation',
        createdAt: '2026-04-25T00:00:00Z',
        updatedAt: '2026-04-25T01:00:00Z',
      },
      {
        id: 'sess-b',
        title: null,
        createdAt: '2026-04-25T00:00:00Z',
        updatedAt: '2026-04-25T00:30:00Z',
      },
    ],
    messages: [],
    inputDraft: '',
    streamingMessageId: null,
    streamingBuffer: '',
  });
}

describe('AgentSessionsMenu', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
    mockedAgentApi.getMessages.mockResolvedValue([]);
    mockedAgentApi.deleteSession.mockResolvedValue(undefined);
    mockedAgentApi.listSessions.mockResolvedValue([]);
  });

  it('renders all sessions with "(untitled)" fallback for null titles', () => {
    render(<AgentSessionsMenu onClose={() => {}} />);
    expect(screen.getByText('first conversation')).toBeTruthy();
    expect(screen.getByText('(untitled)')).toBeTruthy();
  });

  it('shows the empty-state message when there are no sessions', () => {
    useAgentStore.setState({ sessions: [] });
    render(<AgentSessionsMenu onClose={() => {}} />);
    expect(screen.getByText(/no conversations yet/i)).toBeTruthy();
  });

  it('clicking a session row switches to it and closes the menu', async () => {
    const onClose = vi.fn();
    render(<AgentSessionsMenu onClose={onClose} />);
    await act(async () => {
      fireEvent.click(screen.getByText('first conversation'));
    });
    expect(useAgentStore.getState().activeSessionId).toBe('sess-a');
    expect(mockedAgentApi.getMessages).toHaveBeenCalledWith('sess-a');
    expect(onClose).toHaveBeenCalled();
  });

  it('× icon promotes the row to confirm-delete state without firing DELETE', () => {
    render(<AgentSessionsMenu onClose={() => {}} />);
    const deleteIcon = document.querySelectorAll(
      '.agent-sessions-menu__delete',
    )[0] as HTMLButtonElement;
    fireEvent.click(deleteIcon);
    expect(screen.getByText(/delete this conversation\?/i)).toBeTruthy();
    expect(mockedAgentApi.deleteSession).not.toHaveBeenCalled();
  });

  it('confirming delete fires DELETE and removes the row', async () => {
    render(<AgentSessionsMenu onClose={() => {}} />);
    const deleteIcon = document.querySelectorAll(
      '.agent-sessions-menu__delete',
    )[0] as HTMLButtonElement;
    fireEvent.click(deleteIcon);
    await act(async () => {
      fireEvent.click(screen.getByText(/delete this conversation\?/i));
    });
    expect(mockedAgentApi.deleteSession).toHaveBeenCalledWith('sess-a');
    expect(useAgentStore.getState().sessions.map((s) => s.id)).toEqual(['sess-b']);
  });

  it('cancel button retracts the confirm state without deleting', () => {
    render(<AgentSessionsMenu onClose={() => {}} />);
    const deleteIcon = document.querySelectorAll(
      '.agent-sessions-menu__delete',
    )[0] as HTMLButtonElement;
    fireEvent.click(deleteIcon);
    fireEvent.click(screen.getByText(/cancel/i));
    expect(screen.queryByText(/delete this conversation\?/i)).toBeNull();
    expect(mockedAgentApi.deleteSession).not.toHaveBeenCalled();
  });
});
