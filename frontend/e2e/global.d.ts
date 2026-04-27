// Ambient typing for the production-side `?e2e=1` test seam. The
// runtime declaration lives in `src/test/e2eHooks.ts`; this file
// re-exports the surface so e2e specs see it without depending on
// the src tsconfig project.

interface E2EHooks {
  openPopup(todoId: string, x?: number, z?: number): void;
  closePopup(): void;
  getRenderedTodoIds(): string[];
  getSearchResultIds(): string[];
  readonly version: '2';
}

declare global {
  interface Window {
    __pondE2E__?: E2EHooks;
  }
}

export {};
