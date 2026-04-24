# Custom Scrollbar + Custom Cursor — Historical Field Notes

> **Historical record.** These are the dead ends + gotchas we hit on the
> way to shipping story 3.4 (lily pad info popup with inline editor).
> The document was originally a "what works" guide written on 2026-04-23
> mid-implementation. During code review (2026-04-24) the bespoke-
> scrollbar architecture it describes was **deleted** and replaced with
> `NeonScrollbar` overlay mode. The cursor + drag-teardown pitfalls
> still apply; the scrollbar pitfalls are preserved here as the
> historical record of why overlay mode exists.
>
> **For the current architecture**, see:
> - Spec Dev Notes §"Scrollbar convention" in [3-4-lily-pad-info-popup.md](../_bmad-output/implementation-artifacts/3-4-lily-pad-info-popup.md)
> - JSDoc on [`NeonScrollbar.tsx`](../frontend/src/components/ui/NeonScrollbar.tsx) (`scrollElement` prop = overlay mode)
> - The reference consumer at [`InfoPopup.tsx`](../frontend/src/components/ui/InfoPopup.tsx) (edit mode uses `<NeonScrollbar scrollElement={textareaEl} …>`)
>
> The scrollbar pitfalls below (Pitfalls 1–8) describe **abandoned code**.
> The cursor pitfalls (Pitfalls 11–15) and the drag-teardown pattern
> (Pitfall 9) still apply to current code.

## Part 1 — Custom scrollbar over a textarea

### The goal

- A visible track on the right edge of a text editor box.
- A thumb whose **height** is proportional to `visible / total` and
  whose **top** tracks `scrollTop / (total − visible)`.
- Wheel scrolling and thumb dragging both work.
- Native scrollbar hidden (neon aesthetic only).
- User-resizable textarea (drag the bottom of the box).

Sounds trivial. It isn't.

### Pitfall 1: NeonScrollbar was never designed for this

The repo's existing `NeonScrollbar` component (ported from
`rag-csv-crew`) scrolls **its own inner `<div>`** — not an arbitrary
external scrollable element. The whole architecture is:

```
<div .neon-scrollbar>           ← outer, overflow:hidden, bounds the viewport
  <div .neon-scrollbar-inner>   ← height:100%, overflow:scroll (THIS scrolls)
    {children}                  ← tall content that overflows inner
  </div>
  <div .nsb-track> <div .nsb-thumb /> </div>
</div>
```

The inner `<div>` is what scrolls. The thumb reads
`inner.scrollTop / inner.scrollHeight / inner.clientHeight`.

**Trap:** putting a `<textarea>` inside `NeonScrollbar` creates an
unresolvable layout race:

- If the textarea auto-grows to fill the inner (so there's no overflow
  at the inner level), `inner.scrollHeight === inner.clientHeight` and
  the thumb never shows.
- If the textarea grows *beyond* the inner with `overflow: hidden`, the
  inner's `scrollHeight` reports the overflow — but scrolling the inner
  shifts the whole textarea element (including its border and
  background) upward, which reads visually as "the box moves, not the
  text".
- If the textarea scrolls its own content (`overflow-y: auto`), the
  inner doesn't overflow at all — NeonScrollbar's thumb stays at
  full-track size.

**What we first tried:** don't wrap the textarea in NeonScrollbar; build
a dedicated tiny scrollbar component that mirrors the textarea's own
`scrollTop` and `scrollHeight` directly.

```tsx
/* HISTORICAL — this approach was deleted during CR. Preserved here
   for context; see Pitfalls 2–8 for the reasons we ran into it. */
<div className="info-popup__editor-textbox" style={{ height: editorHeight }}>
  <textarea
    ref={setTextareaEl}
    style={{ height: '100%', overflowY: 'auto' }}
  />
  <div className="info-popup__neon-track">
    <div ref={setThumbEl} className="info-popup__neon-thumb" />
  </div>
</div>
```

**What actually shipped (2026-04-24 CR refactor):** `NeonScrollbar` got
a second API — an **overlay mode** via the `scrollElement` prop — that
drives the thumb against an externally-owned scrollable element. The
bespoke track/thumb DOM, `syncThumb` math, and `thumbEl` state are all
gone. The overlay mode solves the same layout race by NOT wrapping the
textarea at all — it just overlays an absolutely-positioned track + thumb
chrome.

```tsx
<div className="info-popup__editor-textbox" style={{ position: 'relative', height: editorHeight }}>
  <textarea ref={setTextareaEl} style={{ width: '100%', height: '100%', overflowY: 'auto' }} />
  <NeonScrollbar scrollElement={textareaEl} color="cyan" />
</div>
```

See [`NeonScrollbar.tsx`](../frontend/src/components/ui/NeonScrollbar.tsx)
for the `scrollElement` prop's JSDoc and the `.neon-scrollbar--overlay`
CSS modifier.

### Pitfall 2: `ta.clientHeight` is unreliable inside a drei `<Html>` portal

This was the single biggest time sink.

drei's `<Html>` renders its children into a React portal that is
positioned via a CSS transform computed in an R3F render loop on each
frame. When React first commits the portal contents, the DOM elements
are in the tree but the browser hasn't finished positioning the portal
yet. Reading layout properties too early returns stale or zero values:

| Timing hook                  | `ta.clientHeight` |
|------------------------------|-------------------|
| `useLayoutEffect` (pre-paint) | often 0           |
| `useEffect` (post-paint)      | sometimes 0       |
| `ResizeObserver` first fire   | sometimes 0       |
| After a user interaction (drag) | correct         |

Every timing trick tried — `useLayoutEffect`, `useEffect`,
`ResizeObserver`, `requestAnimationFrame`, `setTimeout(0)` — failed at
least occasionally on the first open. The pattern was always: "works
after the user interacts, broken before."

**What works:** don't read `clientHeight` from the DOM at all. It's a
value you already control via React state:

```ts
const visibleHeight = editorHeight - 2;  // known from state, minus border
const textHeight   = ta.scrollHeight;     // the only DOM read
const scrollOffset = ta.scrollTop;        // the only DOM read
```

`scrollHeight` is the intrinsic content measurement — it's reliable as
soon as the textarea has its `value` prop, because the browser computes
it from the text content (not from the containing layout). `scrollTop`
is just a scalar the textarea already manages.

The thumb math then works everywhere the first time:

```ts
const usable     = editorHeight - THUMB_INSET * 2;
const ratio      = visibleHeight / textHeight;
const thumbH     = Math.max(MIN_THUMB_PX, ratio * usable);
const maxTop     = usable - thumbH;
const maxScroll  = textHeight - visibleHeight;
const scrollFrac = maxScroll > 0 ? scrollOffset / maxScroll : 0;
thumb.style.top    = `${THUMB_INSET + scrollFrac * maxTop}px`;
thumb.style.height = `${thumbH}px`;
```

### Pitfall 3: `useRef`-backed refs are `null` at effect time in portals

Even though `textareaRef.current` and `thumbRef.current` *should* be
assigned in React's commit phase before effects run, inside a drei
`<Html>` portal they were reliably `null` on the first `useEffect`
firing after `editing` flipped true. A debug overlay printed
`ta=false th=false` on initial open — but `ta=true th=true` after any
interaction that triggered a re-render (e.g., dragging the resize
handle).

The symptom: `syncThumb` early-returned every time because the refs
were null. The listeners never attached. The thumb never updated.

**What works:** use **state-backed callback refs** instead of
`useRef`-backed refs. An element mount becomes a state transition that
React re-runs effects on:

```ts
const [textareaEl, setTextareaEl] = useState<HTMLTextAreaElement | null>(null);
const [thumbEl,    setThumbEl]    = useState<HTMLDivElement     | null>(null);

// JSX: React calls setTextareaEl(el) when <textarea> mounts.
<textarea ref={setTextareaEl} ... />
<div      ref={setThumbEl}    className="info-popup__neon-thumb" />

// Effect depends on the state. Fires after the element exists.
useEffect(() => {
  if (!editing || !textareaEl || !thumbEl) return;
  textareaEl.addEventListener('scroll', syncThumb, { passive: true });
  const ro = new ResizeObserver(() => syncThumb());
  ro.observe(textareaEl);
  syncThumb();
  return () => {
    textareaEl.removeEventListener('scroll', syncThumb);
    ro.disconnect();
  };
}, [editing, textareaEl, thumbEl, syncThumb]);
```

This was the final fix. It bypasses any dependency on React's
ref-commit-phase timing relative to portal DOM insertion.

### Pitfall 4: `display: ''` falls back to CSS, not `block`

When using direct DOM style writes to show/hide the thumb:

```ts
thumb.style.display = '';   // ← WRONG if CSS has display:none
```

`style.display = ''` **removes** the inline style, letting the CSS
cascade win. If the CSS class has `display: none` (which seemed like a
reasonable "start hidden" rule), the thumb stays hidden forever because
`""` → cascade → `display: none`.

**What works:** either don't put `display` in the CSS at all and use
`style.display = 'none' | 'block'` from JS, or use explicit values both
ways:

```ts
thumb.style.display = thumbVisible ? 'block' : 'none';
```

### Pitfall 5: React's `style` prop fights direct DOM writes

A `style={{ display: 'none' }}` prop on the thumb JSX (to hide it
initially) is re-applied by React on **every re-render**. So
`syncThumb` would set `thumb.style.display = 'block'`, and the next
time anything triggered a React re-render (e.g., a keystroke in the
textarea), React would overwrite the DOM with `display: 'none'` again.
The thumb appeared to "only work after a resize" because `editorHeight`
changing triggered `syncThumb` *after* the re-render, while text
changes triggered the re-render *after* `syncThumb`.

**What works:** don't put any `style` prop on an element whose style
you're managing directly from JS. Use a CSS class for static styling,
and let JS own `display`, `top`, `height`, etc. via
`element.style.XYZ =`. Starting-state invisibility can come from having
no height set (an empty `position: absolute` div is 0×0).

### Pitfall 6: `autoFocus` scrolls the textarea to the cursor

When a textarea has `autoFocus` and is populated with long text, the
browser:

1. focuses the textarea,
2. places the cursor at the end of the value,
3. scrolls the textarea internally to show the cursor.

Result: on first open, `scrollTop = maxScroll`, `scrollFrac = 1`, thumb
at the bottom. Combined with Pitfall 2 making the first size calc wrong,
the visual was a tiny sliver stuck at the bottom of the track.

**What works:** explicitly reset `scrollTop = 0` when the editor
mounts, before attaching the scroll listener:

```ts
useEffect(() => {
  if (!editing || !textareaEl) return;
  textareaEl.scrollTop = 0;          // ← always start at top
  textareaEl.addEventListener('scroll', syncThumb, { passive: true });
  // ...
}, [editing, textareaEl, ...]);
```

### Pitfall 7: `stopPropagation` on wheel doesn't prevent native scroll

The popup panel has an `onWheel` handler that forwards wheel events to
the `<canvas>` so OrbitControls zoom keeps working when the cursor is
over the popup. But inside the editor, wheeling should scroll the text,
not zoom the camera.

Naive fix: call `e.stopPropagation()` on the editor's `onWheel`. This
works — React's synthetic `stopPropagation` prevents the panel's
handler from firing, so no canvas zoom. The native browser scroll on
the textarea still happens because the browser's scroll-target
resolution is independent of React's synthetic event propagation.

**As shipped (current code, AC #21):** in EDIT MODE the wheel handler
unconditionally stops propagation whenever a textarea is present —
users reaching the bottom/top of their own text do not expect the
camera to start zooming. In READONLY mode the original direction-gating
survives (stop only if the scroll region can consume the wheel in that
direction), so scrolling past the end of the readonly text scrolls the
pond camera as usual. Previously this file recommended direction-gating
in both modes; that version was tightened during CR.

### Pitfall 8: CSS sizing chain (`height: 100%` + `max-height`)

Attempt: wrap the textarea in NeonScrollbar's pattern of `max-height`
+ `height: 100%`. It looks reasonable:

```css
.outer { max-height: 180px; overflow: hidden; }
.inner { height: 100%; max-height: inherit; overflow: scroll; }
```

With only `max-height` (no `height`) on the outer, the inner's
`height: 100%` has no definite containing-block height to resolve
against and falls back to `auto`. The inner grows with its content
instead of being clipped at 180 px. `inner.scrollHeight ===
inner.clientHeight` → NeonScrollbar sees no overflow → no thumb.

**What works:** when you control the outer height directly from state
(like `editorHeight`), use explicit `height: editorHeight` (not
`max-height`). Inner's `height: 100%` then resolves cleanly. Keep
`max-height` only for use cases where you want content-sized boxes
that cap at a max.

### Pitfall 9: drag handles — use mouse events on `document`, not pointer events on `window`

The resize handle originally used `onPointerDown` + `window.addEventListener('pointermove' | 'pointerup')`. On some mouse drivers / browser builds this proved unreliable mid-drag: the pointer events got swallowed by a captured gesture, so the drag either froze or never terminated on release.

**What works:** use plain mouse events on `document` (the same pattern
NeonScrollbar uses internally for its thumb drag). They fire
consistently through any captured interaction:

```tsx
<div onMouseDown={(e) => {
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  // ...
}} />
```

Also set `document.body.style.userSelect = 'none'` during drag so a
rapid cursor sweep doesn't highlight text across the popup.

### Pitfall 10: drag release resolves to the wrong cursor state

_(See Pitfall 14 below — same root cause, same fix. Kept separate
originally because this one arose in the scrollbar drag path and
Pitfall 14 in the resize-handle path. Both resolve via
`document.elementFromPoint` at `mouseup`.)_

```ts
const onUp = (ev: MouseEvent) => {
  const el = document.elementFromPoint(ev.clientX, ev.clientY);
  const overHandle = el?.closest('.info-popup__editor-resize') !== null;
  setCursorMode(overHandle ? 'grab' : 'firefly');
};
```

---

## Part 2 — The custom canvas cursor

The app renders its own cursor glyph (a neon firefly / frog hand) via a
fixed-position `<canvas>` that tracks `window.mousemove`. Global CSS
sets `cursor: none` on `html, body, #root` so the OS cursor is hidden
and the canvas overlay looks like the only cursor on screen.

This creates a whole class of new problems that wouldn't exist with a
native cursor.

### Pitfall 11: every new form element re-introduces the OS cursor

User-agent stylesheets override `cursor: none` on specific element
types:

- `<textarea>` → `cursor: text`
- `<input type="text">` → `cursor: text`
- `<input type="button">`, `<button>` → `cursor: default`
- Anything styled with `cursor: pointer`, `cursor: grab`, etc.
- `::-webkit-resizer` (the textarea resize grip) → its own cursor
- Native scrollbar thumbs → `cursor: default` at compositor level

Each of these reintroduces the OS cursor on top of the canvas overlay,
breaking the neon-only aesthetic.

**What works:** explicitly set `cursor: none` on every interactive
element, even the ones where it "should" inherit:

```css
.info-popup__button         { cursor: none; }
.info-popup__editor-textarea { cursor: none; }
.info-popup__editor-resize   { cursor: none; }
.info-popup__neon-track      { cursor: none; }
.info-popup__neon-thumb      { cursor: none; }
.nsb-thumb                   { cursor: none; }  /* NeonScrollbar */
```

Yes, even on the scrollbar thumb — the original `cursor: pointer`
there caused a long-standing "the frog hand disappears over the
scrollbar" bug.

### Pitfall 12: `pointer-events: none` breaks scrollbar interactions

Hover-only popups (info popup before the user clicks) use
`pointer-events: none` on the panel so the cursor "passes through" to
the pad underneath. This is necessary for the hover affordance to
work — if the panel intercepted events, moving the mouse onto the
panel would count as leaving the pad and the popup would vanish under
the cursor.

But `pointer-events: none` is inherited by descendants by default. So
the scrollbar thumb inside a hover-mode popup doesn't receive
`mouseenter` / `mouseleave`, and the frog-hand-on-thumb swap never
fires.

**What works:** split the popup into "hover mode" (entire panel
`pointer-events: none`, no interactions) and "focused mode" (panel
`pointer-events: auto`, all child interactions work). The
readonly-text scrollbar is still visible in hover mode but doesn't
respond to the cursor — that's fine because the user can't do anything
with it until they focus anyway.

### Pitfall 13: the custom cursor canvas is below drei `<Html>` portals

The cursor firefly canvas has `z-index: var(--z-cursor)`. Initially
this was `9999`. drei's `<Html>` uses `zIndexRange: [16777271, 0]` by
default and computes the actual z-index from the 3D depth of the
anchor point — up to ~16 million. A popup rendered into an `<Html>`
portal lands *above* the cursor canvas, so the cursor disappears when
it moves over the popup.

**What works:** set the cursor's z-index above any reasonable
`<Html>`-managed value. We use `2147483647` (max 32-bit signed
integer):

```css
:root { --z-cursor: 2147483647; }

.cursor-firefly-canvas {
  position: fixed;
  z-index: var(--z-cursor);
  pointer-events: none;
}
```

### Pitfall 14: drag release leaves the cursor glyph stuck

The cursor state machine is `firefly` / `grab` / `grabbing`. On drag
start we set `grabbing`. On drag end we want to revert — but to
`grab` if the pointer is still over a draggable affordance, and to
`firefly` otherwise.

Relying on `pointerenter` / `pointerleave` refs set during the drag
is unreliable (Pitfall 10). A ref initialized from a `pointerenter`
that fired *before* the drag can go stale if the pointer moved off
mid-drag without the `pointerleave` firing.

**What works:** use `document.elementFromPoint(clientX, clientY)` on
the `mouseup` event to resolve what's actually under the cursor right
now, and pick the cursor glyph from that:

```ts
const el = document.elementFromPoint(ev.clientX, ev.clientY);
const isDraggable = el?.closest('.nsb-thumb') !== null           // NeonScrollbar thumb
                 || el?.closest('.info-popup__editor-resize') !== null;
store.setCursorMode(isDraggable ? 'grab' : 'firefly');
```

(Earlier drafts of this doc referenced `.info-popup__neon-thumb` — that
class belonged to the bespoke scrollbar that was deleted during CR.
NeonScrollbar's overlay-mode thumb is `.nsb-thumb`.)

### Pitfall 15: NeonScrollbar needs explicit drag-state callbacks

To make the cursor glyph swap work on the scrollbar thumb (hover →
`grab`, drag → `grabbing`), NeonScrollbar needs to surface its
internal mouse-enter / -leave / -down / -up events to the app. We
extended its prop surface with:

```ts
onThumbHover?: (hovered: boolean) => void;
onThumbDrag?:  (dragging: boolean, event?: MouseEvent) => void;
```

The `MouseEvent` on drag release is what lets the consumer call
`document.elementFromPoint` (Pitfall 14). The original rag-csv-crew
component doesn't have these props; we added them as optional so the
port stays drop-in compatible.

---

## Part 3 — What the final architecture looks like

**The edit-mode scrollbar described in earlier drafts was deleted during
CR (2026-04-24).** `NeonScrollbar` was extended with an overlay mode so
the popup no longer needs a bespoke track/thumb. The current DOM
structure for edit mode:

```
.info-popup__editor-textbox   (position:relative; height: editorHeight; neon border)
  <textarea                   (width:100%; height:100%; overflow-y:auto)
    ref={setTextareaEl}       (state-backed callback ref → scrollElement prop)
  />
  <NeonScrollbar               (overlay mode — drives thumb against scrollElement.scrollTop)
    scrollElement={textareaEl}
    color="cyan"
    onThumbHover={...}         (firefly → grab cursor swap on thumb hover)
    onThumbDrag={...}          (grabbing during drag, grab/firefly at release)
  />
```

All thumb math, drag handling, scroll listeners, and ResizeObservers now
live inside `NeonScrollbar` (see `updateThumbs` in
[NeonScrollbar.tsx](../frontend/src/components/ui/NeonScrollbar.tsx)).
The `.neon-scrollbar--overlay` CSS modifier (in
[NeonScrollbar.css](../frontend/src/components/ui/NeonScrollbar.css))
handles the absolute-positioning + pointer-events gating.

For the cursor (still applies):

- Global: `html, body { cursor: none; }` + fixed-position canvas with
  `z-index: 2147483647; pointer-events: none`.
- Every interactive element: explicit `cursor: none`.
- Hover mode popup: panel `pointer-events: none`.
- Focused mode popup: panel `pointer-events: auto`; child elements
  receive mouse events normally. The panel itself explicitly reverts
  `cursorMode` from `'grab'` to `'firefly'` in its own `onMouseEnter`
  (R3F's pointer-hover state on the pad underneath goes stale once the
  panel absorbs events, leaving the frog-hand glyph visible through the
  popup — see AC #2c).
- Cursor-mode transitions on drag release use
  `document.elementFromPoint` to resolve the under-cursor element,
  not stale refs.

For the rest of the shipped architecture (enter/exit animations via
`clip-path`, callout centroid-to-centroid via `ResizeObserver`,
hover-popup-fades-on-drag behaviour), see the amended spec at
[3-4-lily-pad-info-popup.md](../_bmad-output/implementation-artifacts/3-4-lily-pad-info-popup.md)
ACs #2, #2a, #2b, #2c, #13. Those are not duplicated here.

## Summary of things that look reasonable but don't work

| Thing                                            | Why it fails                                    |
|--------------------------------------------------|-------------------------------------------------|
| Wrapping textarea in NeonScrollbar               | NeonScrollbar scrolls its own div, not the textarea |
| Reading `ta.clientHeight` in an effect           | Returns 0 inside a drei `<Html>` portal         |
| `useRef`-backed refs inside a portal             | Not assigned before the first effect fires      |
| `thumb.style.display = ''`                       | Cascades to CSS `display: none` if present      |
| `style={{ display: 'none' }}` in JSX             | Re-applied on every re-render, fights JS writes |
| `max-height` alone on a flex/positioned parent   | Child `height: 100%` doesn't resolve            |
| `autoFocus` on a long-text textarea              | Browser auto-scrolls to end of value            |
| `pointerdown` + `window.pointer*` for drags      | Pointer events swallowed by captured gestures   |
| Tracking hover state in refs during a drag       | Browser suppresses enter/leave mid-drag         |
| `cursor: none` on body and hoping it inherits    | UA stylesheets override on form elements + thumbs |
| `z-index: 9999` on the cursor canvas             | drei Html uses z-indexes up to 16 million       |

_(An earlier draft of this document included a second summary table
enumerating "things that work". It has been removed — the anti-pattern
table above plus the individual pitfall bodies are the single source of
truth, and the "what works" column was misleading once the bespoke
scrollbar architecture was replaced with NeonScrollbar overlay mode.)_
