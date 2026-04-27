/**
 * Story 1.5 / AC 6: axe-core allowlist.
 *
 * Currently empty — every WCAG 2A/2AA violation is a real bug to fix.
 * Add an entry here only if axe flags something that a) genuinely
 * cannot be fixed in our code (e.g. a third-party canvas) and b) has
 * a tracking item documenting the workaround. Each entry MUST carry
 * a comment block: violation rule id, reason, link to follow-up.
 */
export const allowedRules: ReadonlyArray<string> = [];
