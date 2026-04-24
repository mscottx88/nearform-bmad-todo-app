# Custom Scrollbar + Custom Cursor — Field Notes

Building a user-controlled neon scrollbar for a `<textarea>` that lives
inside a drei `<Html>` portal — and combining it with a custom canvas
cursor ("firefly" / "frog hand") — turns out to be much harder than it
looks. This document records every dead end, every fix that looked right
but wasn't, and the patterns that finally worked, so no one has to
re-discover them. The working reference implementation lives in
[frontend/src/components/ui/InfoPopup.tsx](../frontend/src/components/ui/InfoPopup.tsx)
and
[frontend/src/components/ui/InfoPopup.css](../frontend/src/components/ui/InfoPopup.css).

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

**What works:** don't wrap the textarea in NeonScrollbar. Build a
dedicated tiny scrollbar component that mirrors the **textarea's own
`scrollTop` and `scrollHeight`**, not some container's.

```tsx
<div className="info-popup__editor-textbox" style={{ height: editorHeight }}>
  <textarea
    ref={setTextareaEl}
    style={{ height: '100%', overflowY: 'auto' }}
    /* native scrollbar hidden via CSS: scrollbar-width: none */
  />
  <div className="info-popup__neon-track">
    <div ref={setThumbEl} className="info-popup__neon-thumb" />
  </div>
</div>
```

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

**Only caveat:** gate the `stopPropagation` on "can we actually scroll
in this direction?" so wheel events over *non-scrollable* popup
regions still zoom the camera. Read the textarea's `scrollTop`,
`scrollHeight`, `clientHeight` and only stop propagation if the
direction would consume the wheel.

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

At the end of a drag, you want to revert the custom cursor glyph (see
cursor section below) based on where the mouse actually is. Tracking a
`isOverHandleRef` in `pointerenter` / `pointerleave` handlers is
unreliable: browsers **suppress** those events on elements other than
the one that captured `pointerdown`, so mid-drag transitions never
fire and the ref drifts out of sync.

**What works:** at `mouseup`, resolve the element under the cursor
directly:

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
const isDraggable = el?.closest('.info-popup__neon-thumb') !== null
                 || el?.closest('.info-popup__editor-resize') !== null;
store.setCursorMode(isDraggable ? 'grab' : 'firefly');
```

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

For the edit-mode textbox:

```
.info-popup__editor-textbox   (position:relative; overflow:hidden; neon border)
  <textarea                   (height:100%; overflow-y:auto; padding-right:22)
    ref={setTextareaEl}       (state-backed callback ref)
  />
  .info-popup__neon-track     (position:absolute; right:0; top:0; bottom:0; width:15)
    .info-popup__neon-thumb   (position:absolute; top/height written by syncThumb)
      ref={setThumbEl}        (state-backed callback ref)
```

Thumb math:

```
visibleHeight = editorHeight − 2
textHeight    = textareaEl.scrollHeight
scrollOffset  = textareaEl.scrollTop
usable        = editorHeight − THUMB_INSET × 2
ratio         = visibleHeight / textHeight
thumbH        = max(MIN_THUMB_PX, ratio × usable)
maxTop        = usable − thumbH
maxScroll     = textHeight − visibleHeight
scrollFrac    = scrollOffset / maxScroll
thumb.top     = THUMB_INSET + scrollFrac × maxTop
thumb.height  = thumbH
```

Effects:

1. Main setup effect depends on `[editing, textareaEl, thumbEl, syncThumb]`
   and, when all four are present, resets scrollTop, attaches a scroll
   listener, attaches a ResizeObserver on the textarea, and calls
   `syncThumb()` once.
2. `useLayoutEffect` on `[editText, ...]` calls `syncThumb()` so the
   thumb resizes live as the user types.
3. `syncThumb()` is also invoked from the scroll listener (user wheel
   or thumb drag) and from the RO callback (layout settled).

For the cursor:

- Global: `html, body { cursor: none; }` + fixed-position canvas with
  `z-index: 2147483647; pointer-events: none`.
- Every interactive element: explicit `cursor: none`.
- Hover mode popup: panel `pointer-events: none`.
- Focused mode popup: panel `pointer-events: auto`, child elements
  receive mouse events normally.
- Cursor-mode transitions on drag release use
  `document.elementFromPoint` to resolve the under-cursor element,
  not stale refs.

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

## Summary of things that work

| Problem                                 | Solution                                              |
|-----------------------------------------|-------------------------------------------------------|
| Textarea scrollbar in a portal          | Bespoke track + thumb; read `scrollHeight` / `scrollTop` directly from the textarea |
| `clientHeight` unreliable               | Compute from React state (`editorHeight − 2`)         |
| Ref-null-at-effect-time                 | State-backed callback refs (`useState` + `ref={setEl}`) |
| Thumb visibility toggled from JS        | `element.style.display = 'block' | 'none'` explicitly; no CSS `display` rule; no JSX `style` prop |
| Inner that resolves `height: 100%`      | Parent has explicit `height`, not just `max-height`   |
| Cursor at top on edit open              | `ta.scrollTop = 0` when mounting                      |
| Wheel scroll without canvas zoom        | `e.stopPropagation()` on the editor wrapper, gated by "can scroll in this direction" |
| Smooth drag with custom cursor tracking | `mousedown` on target + `document.mousemove` / `mouseup` |
| Correct cursor glyph at drag release    | `document.elementFromPoint(ev.clientX, ev.clientY)`  |
| Custom cursor always above popups       | `z-index: 2147483647`                                 |
| Custom cursor over scrollbar thumb      | `cursor: none` on `.nsb-thumb`                        |
| Custom cursor in hover-mode popup       | Accept it doesn't — hover popups are `pointer-events: none` |
