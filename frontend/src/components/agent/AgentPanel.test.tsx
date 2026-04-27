import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';

vi.mock('../../api/agentApi', () => ({
  listSessions: vi.fn(async () => []),
  getSession: vi.fn(),
  getMessages: vi.fn(async () => []),
  createSession: vi.fn(async () => ({
    id: 'sess-new',
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

// Story 6.7: mock @react-three/drei's <View> + <PerspectiveCamera>
// so the AgentPanel test doesn't try to instantiate R3F. We render
// the View as a plain div with the same className/track shape so
// existing assertions on `.agent-panel__oracle` still pass.
vi.mock('@react-three/drei', () => {
  const React = require('react') as typeof import('react');
  return {
    View: ({
      as: As = 'div',
      className,
      style,
      children,
    }: {
      as?: keyof React.JSX.IntrinsicElements;
      className?: string;
      style?: React.CSSProperties;
      children?: React.ReactNode;
    }) => React.createElement(As, { className, style }, children),
    PerspectiveCamera: () => null,
  };
});

// Sub the @react-three/fiber pieces too — OracleFrog uses useFrame.
vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

import { AgentPanel } from './AgentPanel';
import { useAgentStore } from '../../stores/useAgentStore';

function resetStore() {
  useAgentStore.setState({
    panelOpen: false,
    activeSessionId: null,
    // Story 6.9: keep tests deterministic even when an earlier test
    // ran setPanelWidth.
    panelWidth: 440,
    sessions: [],
    messages: [],
    inputDraft: '',
    streamingMessageId: null,
    streamingBuffer: '',
  });
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
}

function readPanelWidthVar(): string {
  const panel = document.querySelector('.agent-panel') as HTMLElement | null;
  if (panel === null) throw new Error('panel not mounted');
  return panel.style.getPropertyValue('--agent-panel-width');
}

function fireResizePointer(
  handle: HTMLElement,
  type: 'pointerDown' | 'pointerMove' | 'pointerUp',
  clientX: number,
) {
  // happy-dom may not implement pointer-capture methods. Stub with
  // no-ops so the component's setPointerCapture / releasePointerCapture
  // calls don't throw; hasPointerCapture returns false so the
  // releasePointerCapture branch runs only when warranted.
  if (typeof handle.setPointerCapture !== 'function') {
    handle.setPointerCapture = vi.fn();
  }
  if (typeof handle.releasePointerCapture !== 'function') {
    handle.releasePointerCapture = vi.fn();
  }
  if (typeof handle.hasPointerCapture !== 'function') {
    handle.hasPointerCapture = vi.fn(() => false);
  }
  fireEvent[type](handle, { clientX, button: 0, pointerId: 1 });
}

describe('AgentPanel', () => {
  beforeEach(() => {
    resetStore();
    // jsdom default is 1024 — keep it explicit so the resize tests
    // below can switch viewports without leaking into other suites.
    setViewportWidth(1024);
  });

  it('renders nothing while panelOpen is false', () => {
    const { container } = render(<AgentPanel />);
    expect(container.querySelector('.agent-panel')).toBeNull();
  });

  it('renders the three-section drawer when panelOpen is true', () => {
    useAgentStore.setState({ panelOpen: true });
    render(<AgentPanel />);
    expect(document.querySelector('.agent-panel')).not.toBeNull();
    expect(document.querySelector('.agent-panel__section--oracle')).not.toBeNull();
    expect(document.querySelector('.agent-panel__section--chat')).not.toBeNull();
    expect(
      document.querySelector('.agent-panel__section--composer'),
    ).not.toBeNull();
    // Two divider rules between the three sections.
    expect(document.querySelectorAll('.agent-panel__divider')).toHaveLength(2);
  });

  it('renders the AgentPanelOracleView (replaces 6.2 placeholder per Story 6.7)', () => {
    useAgentStore.setState({ panelOpen: true });
    render(<AgentPanel />);
    // The mocked drei View renders as a div with the same
    // agent-panel__oracle className the placeholder used. The
    // surrounding section--oracle wrapper still drives the 16:10
    // aspect-ratio rule.
    expect(document.querySelector('.agent-panel__section--oracle')).not.toBeNull();
    expect(document.querySelector('.agent-panel__oracle')).not.toBeNull();
  });

  it('Escape closes the panel when the composer is unfocused', () => {
    useAgentStore.setState({ panelOpen: true });
    render(<AgentPanel />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(useAgentStore.getState().panelOpen).toBe(false);
  });

  it('Escape with focused composer + draft clears the draft (does NOT close)', () => {
    useAgentStore.setState({ panelOpen: true, inputDraft: 'half a thought' });
    render(<AgentPanel />);
    const composer = document.querySelector('textarea.agent-composer');
    expect(composer).not.toBeNull();
    (composer as HTMLTextAreaElement).focus();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(useAgentStore.getState().panelOpen).toBe(true);
    expect(useAgentStore.getState().inputDraft).toBe('');
  });

  it('Escape with focused composer but EMPTY draft closes the panel', () => {
    useAgentStore.setState({ panelOpen: true, inputDraft: '' });
    render(<AgentPanel />);
    const composer = document.querySelector('textarea.agent-composer');
    (composer as HTMLTextAreaElement).focus();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(useAgentStore.getState().panelOpen).toBe(false);
  });

  it('close button calls closePanel', () => {
    useAgentStore.setState({ panelOpen: true });
    render(<AgentPanel />);
    const closeBtn = document.querySelector('.agent-btn--close') as HTMLButtonElement;
    fireEvent.click(closeBtn);
    expect(useAgentStore.getState().panelOpen).toBe(false);
  });

  // ── Story 6.9: drag-to-resize ────────────────────────────────────

  it('renders the panel at 440px when no persisted width is set', () => {
    useAgentStore.setState({ panelOpen: true, panelWidth: 440 });
    render(<AgentPanel />);
    expect(readPanelWidthVar()).toBe('440px');
  });

  it('renders the panel at the persisted panelWidth', () => {
    // 600 must lie inside the viewport's [25%, 50%] clamp; pick a
    // viewport where it does (vw=2000 → min=500, max=1000).
    setViewportWidth(2000);
    useAgentStore.setState({ panelOpen: true, panelWidth: 600 });
    render(<AgentPanel />);
    expect(readPanelWidthVar()).toBe('600px');
  });

  it('exposes a resize handle with the WAI-ARIA separator pattern', () => {
    useAgentStore.setState({ panelOpen: true });
    render(<AgentPanel />);
    const handle = document.querySelector(
      '.agent-panel__resize-handle',
    ) as HTMLElement | null;
    expect(handle).not.toBeNull();
    expect(handle?.getAttribute('role')).toBe('separator');
    expect(handle?.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle?.getAttribute('aria-label')).toBe('Resize chat panel');
    expect(handle?.getAttribute('tabindex')).toBe('0');
    expect(handle?.getAttribute('aria-valuenow')).toBe('440');
    // 1024 viewport → min=256, max=512.
    expect(handle?.getAttribute('aria-valuemin')).toBe('256');
    expect(handle?.getAttribute('aria-valuemax')).toBe('512');
  });

  it('dragging the handle 100px left grows the panel by 100px', () => {
    // vw=1500 → min=375, max=750. 440 (start) and 540 (end) both
    // sit comfortably inside the clamp window.
    setViewportWidth(1500);
    useAgentStore.setState({ panelOpen: true, panelWidth: 440 });
    render(<AgentPanel />);
    const handle = document.querySelector(
      '.agent-panel__resize-handle',
    ) as HTMLElement;

    // Anchor pointerdown at the panel's left edge: vw - panelWidth.
    fireResizePointer(handle, 'pointerDown', 1060);
    fireResizePointer(handle, 'pointerMove', 960); // 100px left
    expect(readPanelWidthVar()).toBe('540px');
    fireResizePointer(handle, 'pointerUp', 960);
    expect(useAgentStore.getState().panelWidth).toBe(540);
  });

  it('dragging past the maximum clamps the panel to 50% of viewport', () => {
    setViewportWidth(1024); // max=512
    useAgentStore.setState({ panelOpen: true, panelWidth: 440 });
    render(<AgentPanel />);
    const handle = document.querySelector(
      '.agent-panel__resize-handle',
    ) as HTMLElement;
    fireResizePointer(handle, 'pointerDown', 584);
    // Drag wildly to the left (negative clientX).
    fireResizePointer(handle, 'pointerMove', -2000);
    expect(readPanelWidthVar()).toBe('512px');
    fireResizePointer(handle, 'pointerUp', -2000);
    expect(useAgentStore.getState().panelWidth).toBe(512);
  });

  it('dragging past the minimum clamps the panel to 25% of viewport', () => {
    setViewportWidth(1024); // min=256
    useAgentStore.setState({ panelOpen: true, panelWidth: 440 });
    render(<AgentPanel />);
    const handle = document.querySelector(
      '.agent-panel__resize-handle',
    ) as HTMLElement;
    fireResizePointer(handle, 'pointerDown', 584);
    fireResizePointer(handle, 'pointerMove', 5000); // far right
    expect(readPanelWidthVar()).toBe('256px');
    fireResizePointer(handle, 'pointerUp', 5000);
    expect(useAgentStore.getState().panelWidth).toBe(256);
  });

  it('window resize re-clamps an over-wide persisted width', () => {
    setViewportWidth(2000);
    useAgentStore.setState({ panelOpen: true, panelWidth: 900 }); // valid here
    render(<AgentPanel />);
    expect(readPanelWidthVar()).toBe('900px');

    // Shrink the viewport so 50% < 900 → re-clamp expected.
    act(() => {
      setViewportWidth(1000); // max=500
      window.dispatchEvent(new Event('resize'));
    });
    expect(readPanelWidthVar()).toBe('500px');
    expect(useAgentStore.getState().panelWidth).toBe(500);
  });

  it('ArrowLeft on focused handle widens the panel by 20px', () => {
    // vw=1500 → min=375, max=750. 440 + 20 = 460 sits inside.
    setViewportWidth(1500);
    useAgentStore.setState({ panelOpen: true, panelWidth: 440 });
    render(<AgentPanel />);
    const handle = document.querySelector(
      '.agent-panel__resize-handle',
    ) as HTMLElement;
    handle.focus();
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(readPanelWidthVar()).toBe('460px');
    fireEvent.keyUp(handle, { key: 'ArrowLeft' });
    expect(useAgentStore.getState().panelWidth).toBe(460);
  });

  it('ArrowRight on focused handle narrows the panel by 20px', () => {
    setViewportWidth(1500);
    useAgentStore.setState({ panelOpen: true, panelWidth: 440 });
    render(<AgentPanel />);
    const handle = document.querySelector(
      '.agent-panel__resize-handle',
    ) as HTMLElement;
    handle.focus();
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(readPanelWidthVar()).toBe('420px');
    fireEvent.keyUp(handle, { key: 'ArrowRight' });
    expect(useAgentStore.getState().panelWidth).toBe(420);
  });

  it('rehydrating from a pre-6.9 localStorage shape leaves panelWidth at 440', async () => {
    // Regression guard for the partialize migration: an existing
    // localStorage entry that lacks `panelWidth` must NOT crash on
    // hydration; the in-code default holds.
    localStorage.setItem(
      'agent-store-v1',
      JSON.stringify({
        state: { panelOpen: true, activeSessionId: 'legacy-session' },
        version: 0,
      }),
    );
    await useAgentStore.persist.rehydrate();
    expect(useAgentStore.getState().panelWidth).toBe(440);
  });
});
