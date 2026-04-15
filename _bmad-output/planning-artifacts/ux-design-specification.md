---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
lastStep: 14
inputDocuments: ['_bmad-output/planning-artifacts/prd.md']
---

# UX Design Specification - nearform-bmad-todo-app

**Author:** Michael
**Date:** 2026-04-14

---

## Executive Summary

### Project Vision

A visually immersive todo application where task management happens inside a living 3D neon pond. Todos exist as luminescent lily pads floating on a dark water surface, overlapping organically with varying opacity. The interface has no traditional list, no visible search bar, no native browser controls — just a responsive 3D environment where adding a todo drops a new pad into the water with rippling neon light, searching causes matching pads to surface while others submerge, and completing a task transforms its visual state. Inspired by the rag-csv-crew application's neon aesthetic, this todo app pushes the concept further into spatial, immersive interaction.

The application is a Nearform internal demo and BMad method showcase. Desktop only. Chrome only. Every pixel is custom-rendered — cursor, scrollbars, checkboxes, inputs. The system cursor is replaced with a trailing neon snake effect. The entire experience is designed to make internal audiences stop and say "how did they build this?"

### Target Users

**Primary: The demo viewer (Nearform engineers and leadership)**
Encounters the app via a shared link or live presentation. Expects a standard CRUD demo. Gets an immersive 3D experience instead. Tech-savvy, desktop Chrome, appreciates craft.

**Secondary: The daily user (power user with 30+ todos)**
Uses the app regularly. Relies on type-to-search to navigate a dense pond of lily pads. Assigns neon colors for self-organization. Interacts through hover-to-focus and keyboard-driven search.

**Tertiary: The presenter (Michael in a live demo)**
Needs flawless performance on a projected screen. Empty state must look inviting. Every interaction must be smooth and visually impressive in real-time.

### Key Design Challenges

- **Lily pad readability at density** — as todos accumulate, pads shrink and overlap. Must gracefully degrade from readable text → small text → rendered line shapes (Monaco minimap style) without feeling broken
- **Type-to-search discoverability** — no visible search bar means the user must discover that typing anywhere initiates filtering. The empty state or onboarding hint must communicate this
- **3D performance** — a pond full of animated, overlapping, semi-transparent lily pads with real-time ripple effects must maintain 60fps on desktop
- **Custom everything** — replacing the system cursor means every native UI element (inputs, scrollbars, checkboxes) must be custom-built to maintain immersion
- **Focus management** — "anywhere outside a focused element initiates search" requires careful keyboard event handling to avoid conflicts with todo text input

### Design Opportunities

- **The pond as identity** — no other todo app looks or feels like this. The lily pad metaphor is instantly memorable and demo-worthy
- **Search as spectacle** — watching todos surface and submerge with neon ripples turns a utility feature into a visual experience
- **Color as personal expression** — user-assigned neon colors for organization makes the pond visually richer over time, unique to each user
- **Progressive density as emergent behavior** — the pond naturally evolves its visual character as more todos are added, creating a living, organic feel

## Core User Experience

### Defining Experience

The core interaction loop is **pond → drop → find → act**. The user sees a living neon pond, drops thoughts into it as lily pads, finds them later through type-to-search, and acts on them (complete or delete). Each action produces a visual response in the 3D environment — ripples, surfacing, submerging, dissolving. The pond is not a container for a list; it IS the interface. There is no separation between "data view" and "interaction layer."

The primary action — adding a todo — must feel like depositing something alive into the water. The pad materializes, settles among others, causes ripples. The secondary action — searching — transforms the entire pond: matching pads rise and glow while non-matches sink and fade. Both actions produce environmental responses, not UI state changes.

### Platform Strategy

- **Desktop only** — full commitment to immersive 3D experience without touch/responsive compromises
- **Chrome only** — single browser target enables aggressive use of modern APIs and GPU features
- **Mouse + keyboard** — hover for focus, click for action, type anywhere for search
- **GPU-dependent** — Three.js with React Three Fiber, Bloom postprocessing, real-time water simulation
- **No offline** — requires backend for persistence and embedding generation
- **Custom cursor** — neon snake trail (ported from rag-csv-crew CursorSnake component) replaces system cursor entirely, requiring all UI primitives to be custom-built

### Effortless Interactions

- **Adding a todo** — a text input appears contextually (keyboard shortcut or dedicated trigger), user types, presses enter, and a new lily pad drops into the pond with a ripple. No modal, no form, no fields beyond the text itself.
- **Finding a todo** — type anywhere outside a focused element. No search bar to locate, no button to click. The pond responds immediately: matching pads surface, non-matches submerge. Clear the input and the pond restores.
- **Completing a todo** — hover a lily pad to focus it, single click to toggle completion. The pad visually transforms (color shift, partial submersion, glow change) without leaving the pond.
- **Deleting a todo** — hover to focus, explicit delete action (not accidental). The pad dissolves into the water with a final ripple.
- **Color assignment** — quick interaction on a focused lily pad to assign a neon color for personal organization.

### Critical Success Moments

1. **First 3 seconds** — the pond loads and the user sees something they've never seen in a todo app. The neon water, the floating pads, the custom cursor trail. This is the make-or-break moment for the demo.
2. **First search** — the user types and watches the pond reorganize itself. Pads rise and sink with ripple effects. This is the "this is smarter than I expected" moment.
3. **The density threshold** — when 20+ todos fill the pond and pads shrink into minimap-like line renderings, then the user types and watches specific pads surface from the compressed mass. This demonstrates that the aesthetic isn't just decoration — it scales.
4. **The empty pond** — when no todos exist, the pond should feel inviting, not empty. Subtle water movement, ambient glow, a gentle visual cue that says "drop something in."

### Experience Principles

1. **The pond is the interface** — no separation between data display and interaction surface. Every user action produces an environmental response in the 3D scene.
2. **Type to interact** — keyboard-first for both creation and search. No buttons to find, no menus to navigate. The app responds to what you type.
3. **Visual feedback is the response** — no toast notifications, no success messages. The pond's physical response (ripples, surfacing, dissolving) IS the confirmation.
4. **Density is a feature, not a problem** — the pond gracefully evolves its visual character as todos accumulate, from readable pads to minimap density, making search the natural navigation tool.
5. **Everything is custom** — no native browser UI visible anywhere. Cursor, inputs, scrolling, controls — all rendered within the neon visual language.

## Desired Emotional Response

### Primary Emotional Goals

**Awe + Disbelief (simultaneous):** The user should feel both "this is art" and "wait, this is a *todo app*?" at the same time. The visual craft creates awe; the realization that it's functional creates disbelief. These two emotions layered together produce the demo "wow" moment — the user is impressed by the aesthetics AND surprised that the aesthetics serve a real purpose.

**Curiosity → Discovery:** After the initial impact, the user should feel pulled to explore. Hover a lily pad — it responds. Start typing — the pond transforms. Click a pad — it changes state. Every interaction reveals something, rewarding curiosity with visual feedback.

**Ownership through expression:** As the user assigns neon colors and accumulates todos, the pond becomes *theirs* — a unique visual fingerprint. This creates attachment and a sense of personal space within the aesthetic.

### Emotional Journey Mapping

| Stage | Target Emotion | Trigger |
|---|---|---|
| **First load** | Awe + disbelief | The living neon pond fills the viewport. Custom cursor trail follows mouse. |
| **Empty pond** | Invitation + intrigue | Subtle water movement, ambient glow, gentle cue to "drop something in" |
| **First todo added** | Delight + satisfaction | Lily pad drops into water with ripple — the pond responded to them |
| **Exploring (hover/browse)** | Curiosity + discovery | Pads respond to hover, revealing content, shifting focus |
| **First search** | Surprise + intelligence | Typing transforms the entire pond — "this is smarter than I expected" |
| **Dense pond (20+ todos)** | Mastery + confidence | The minimap-density view feels intentional, search feels essential |
| **Error occurs** | Unease + fascination | A lily pad shows bite marks, aphids/caterpillars appear — biological decay rather than UI error banners |
| **Error resolves** | Relief + resilience | The pad heals, insects disappear, the pond restores itself |
| **Mood switch** | Control + playfulness | Toggling between zen and cyberpunk atmospheres transforms the entire environment |
| **Returning** | Familiarity + warmth | The pond remembers — their colored pads are exactly where they left them |

### Micro-Emotions

**Cultivate:**
- **Confidence** — every interaction has clear, immediate visual feedback. The user always knows the pond heard them.
- **Delight** — small surprises in animation details, cursor trail, ripple physics. Reward for paying attention.
- **Mastery** — the type-to-search and hover-to-focus model becomes second nature quickly. Power users feel fast.
- **Fascination** — even error states are visually interesting (biological decay), not frustrating.

**Avoid:**
- **Confusion** — the lack of traditional UI chrome must never feel like missing functionality. Visual cues must compensate.
- **Anxiety** — "did my todo save?" must never be a question. The lily pad appearing IS the confirmation.
- **Boredom** — the pond should feel alive even when idle. Subtle water movement, ambient glow shifts, gentle pad drift.

### Design Implications

| Emotional Goal | UX Design Choice |
|---|---|
| Awe + disbelief | Full-viewport 3D pond scene with no traditional UI elements visible |
| Curiosity → discovery | Every element responds to hover/interaction — no dead zones |
| Delight | Ripple physics, pad drop animation, cursor trail, bloom effects |
| Confidence | Lily pad materialization IS the save confirmation — no toasts or modals |
| Fascination in errors | Biological decay metaphor — aphids/caterpillars on failing pads instead of error banners |
| Control + playfulness | Configurable atmosphere — zen (calm, soft ripples, muted glow) vs. cyberpunk (pulsing, bright, active waves) |
| Mastery | Progressive density that rewards search-driven navigation |
| Ownership | User-assigned neon colors create a unique visual fingerprint per person |

### Emotional Design Principles

1. **The pond is alive** — idle state has subtle movement (water, glow shifts, gentle pad drift). The environment breathes even when the user isn't acting.
2. **Errors are organic, not clinical** — failure states use the pond metaphor (biological decay, distortion, glitching water) rather than red banners or modal dialogs.
3. **Atmosphere is configurable** — zen mode (contemplative, soft ripples, muted glow, slower animations) vs. cyberpunk mode (electric, pulsing neon, active waves, faster transitions). User controls the mood.
4. **Every response is environmental** — the pond ripples, pads surface or sink, glows intensify or fade. No system-style notifications. The 3D world IS the feedback layer.
5. **Surprise scales with attention** — casual users see the big moments (drop, search, ripple). Attentive users notice cursor trail color shifts, pad drift patterns, subtle glow breathing. Layers of delight for different attention levels.

### Pond Ecosystem

The pond is populated by ambient wildlife whose density and variety scale with the number of active todos. The ecosystem creates emergent visual richness that rewards usage.

**Creature types:**
- Fireflies — neon trails drifting above the water surface
- Frogs — perch on lily pads, occasionally hop between them
- Fish — neon silhouettes gliding beneath the water surface
- Dragonflies — dart across the scene with quick, erratic movement
- Water striders — skim the surface tension with ripple effects

**Ecosystem scaling:**

| Todo Count | Ecosystem State | Visual Character |
|---|---|---|
| 0-3 | Sparse | Quiet pond, single firefly, still water. Inviting but waiting. |
| 5-10 | Awakening | A few fireflies, a frog appears, fish begin moving. Life stirs. |
| 15-25 | Thriving | Multiple creature types active, rich ambient movement. The pond feels alive. |
| 30+ | Lush | Dense wildlife, firefly swarms, frog chorus, schooling fish. Teeming ecosystem. |

**Ecosystem-error interaction:** When a lily pad enters an error state (biological decay), nearby creatures may react — fish scatter, frogs hop away from the affected pad, fireflies dim near the decay. When the error resolves, life returns.

## UX Pattern Analysis & Inspiration

### Inspiring Products Analysis

**RAG CSV Crew (primary visual reference)**
The existing Nearform application provides the complete visual language: neon color palette, circuit-board backgrounds, 3D isometric objects via Three.js/React Three Fiber, custom cursor snake trail, retro-futuristic typography, and fully custom UI primitives (scrollbars, checkboxes, selects). The todo app inherits this DNA and extends it into a spatial 3D environment.

- Proven component library to port: CursorSnake, CircuitBoard, NeonCheckbox, NeonScrollbar, NeonSelect, LightningBorder, NeonScene
- Same tech stack: React 18 + TypeScript + Vite + Three.js + Python/FastAPI + PostgreSQL/pgvector
- Established neon color palette as CSS variables (pink #ff10f0, cyan #00eeff, orange #ff6600, green #39ff14, gold #ffd700)

**Casino games (interaction psychology reference)**
Casino UX is optimized for sustained attention through randomized delight, anticipation mechanics, and disproportionate visual reward. The todo pond borrows these psychological patterns:

- **Anticipation before payoff** — a todo drop has a brief build-up (the pad forms, hovers, then *drops* into the water) rather than instant appearance
- **Randomized celebration intensity** — completing a todo occasionally triggers bonus effects (extra fireflies, particle bursts, fish jump). Not every time — the unpredictability keeps it interesting
- **Ambient magnetism** — the pond's idle state has enough movement (creatures, ripples, glow shifts) to hold peripheral attention, like a casino floor you can't look away from
- **Near-miss engagement** — ecosystem creatures have randomized emergent behaviors (frog catches firefly, fish leap, dragonfly lands on a pad) creating micro-moments of delight

**Type-to-navigate tools (interaction model reference)**
VS Code command palette, Raycast, Spotlight — applications where typing anywhere is the primary navigation method. The todo pond borrows:

- **Global keyboard capture** — typing outside a focused element initiates search immediately
- **Progressive filtering** — results narrow in real-time as you type, with instant visual feedback
- **Escape to clear** — single keypress restores the full unfiltered view

### Transferable UX Patterns

**Spatial layout (from casino/game UI):**
- Elements positioned organically, not in rigid grids — lily pads float with natural spacing and overlap
- Visual hierarchy through proximity and focus rather than list ordering
- Environmental responses to user actions (ripples, creature reactions) rather than UI state indicators

**Randomized delight (from casino mechanics):**
- Variable-intensity feedback — most todo completions get a standard glow; some randomly get particle bursts, creature reactions, or bonus animations
- Emergent ecosystem moments — unpredictable creature behaviors create "did you see that?" micro-events
- Anticipation pacing — actions have brief build-up animations before resolution, creating satisfying rhythm

**Type-to-navigate (from command palettes):**
- No visible search UI — keyboard input directly transforms the environment
- Progressive refinement — results update per-keystroke with debouncing
- Escape as universal "reset" — clears search and restores full pond view

**Ambient soundscape (from casino/game environments):**
- Layered ambient audio that scales with ecosystem density (water, crickets, frogs)
- Discrete interaction sounds (splash on add, chime on complete, whoosh on delete)
- Slightly synthetic/processed natural sounds to match neon aesthetic
- Sound is the last-implemented feature — additive polish, not a dependency

### Anti-Patterns to Avoid

- **Traditional list UI** — no vertical scrolling lists, no rows, no table-like layouts. The pond IS the layout.
- **Modal dialogs** — no confirmation modals, no "are you sure?" popups. Actions are direct; undo is the safety net.
- **Toast notifications** — no slide-in success/error messages. The pond's physical response IS the notification.
- **Visible chrome** — no toolbars, sidebars, headers, footers. The viewport is 100% pond.
- **Static idle state** — the pond must never feel frozen or lifeless. Something always moves.
- **Uniform feedback** — every interaction producing the exact same animation creates predictability. Randomize intensity and details.

### Design Inspiration Strategy

**Adopt directly from rag-csv-crew:**
- CursorSnake component, neon color palette, custom UI primitives, CircuitBoard background pattern, Three.js/React Three Fiber setup with Bloom postprocessing

**Adapt from casino/game UX:**
- Randomized celebration intensity for todo completion
- Anticipation pacing on todo creation (form → hover → drop → ripple)
- Emergent ecosystem creature behaviors as ambient delight
- Ambient soundscape with interaction-triggered audio (last feature implemented)

**Adapt from command palettes:**
- Global type-to-search with no visible search bar
- Progressive filtering with environmental visual response
- Escape-to-reset as universal clear

**Avoid from traditional todo apps:**
- Lists, grids, cards, modals, toasts, toolbars, settings pages, onboarding flows

### Grouping & Clustering

**Organic clustering** — lily pads can be grouped into tight clusters that float as a unit on the pond surface. Clusters share a connecting glow aura and an optional floating label. Structure is flat — no nested groups.

**Cluster interactions:**
- Select multiple pads → they magnetically drift together and bond into a cluster
- Ungroup → pads release with outward ripple, drift apart
- Drag individual pads in/out of existing clusters
- Clusters drift together on the pond as a single unit

**Cluster search behavior:**
- Any match in a cluster surfaces the entire cluster
- Matching pads glow at full intensity, foregrounded
- Non-matching siblings remain visible but faded/transparent — providing group context
- Non-matching clusters submerge as normal

### Sound Design Specification

**Implementation priority:** Last feature — ship visual experience complete, add sound as final polish layer.

**Ambient layer (always present, scales with ecosystem):**

| Sound | Behavior | Volume Scaling |
|---|---|---|
| Water ambient | Continuous loop, subtle movement | Base level, always present |
| Cricket chirps | Loop, density increases with todo count | Scales with ecosystem state |
| Frog croaks | Random intervals, more frequent at higher density | Scales with ecosystem state |
| Wind/atmosphere | Subtle background texture | Constant, low |

**Interaction sounds (triggered by user actions):**

| Sound | Trigger | Character |
|---|---|---|
| Splash/drop | Todo added | Water drop with slight synthetic reverb |
| Completion chime | Todo completed | Tonal chime, occasionally enhanced with bonus particles |
| Dissolve/sink | Todo deleted | Reverse splash or soft underwater whoosh |
| Ripple wash | Search filtering | Soft water movement, panning with results |
| Surface break | Search result surfacing | Gentle water break sound |

**Audio UX rules:**
- Start muted — "click to enable sound" prompt on first visit, in-theme
- Mute toggle always accessible (subtle, in-theme — perhaps a firefly icon)
- Sounds are slightly synthetic/processed to match the neon aesthetic — not purely naturalistic
- Spatial audio where possible — sounds positioned relative to the action location in the pond

## Design System Foundation

### Design System Choice

**Custom Design System** — ported and extended from the rag-csv-crew application. No established UI framework (MUI, Chakra, Tailwind) applies — the entire interface is a Three.js 3D scene with custom-rendered UI primitives. The rag-csv-crew codebase serves as the component library and visual language source.

### Rationale for Selection

- The 3D pond interface has no equivalent in any component library — lily pads, water simulation, ecosystem creatures are all custom Three.js/React Three Fiber work
- The custom cursor requirement (neon snake trail) forces all native UI elements to be rebuilt anyway — no framework shortcuts survive
- The rag-csv-crew app already provides proven implementations of the exact primitives needed (custom inputs, scrollbars, checkboxes, 3D scene management)
- Visual uniqueness is the primary product goal — using a standard design system would undermine the core value proposition

### Implementation Approach

**Port from rag-csv-crew:**

| Component | Source | Adaptation Needed |
|---|---|---|
| CursorSnake | `components/CursorSnake/` | Direct port — same cursor trail behavior |
| NeonCheckbox | `components/NeonCheckbox/` | Adapt for lily pad completion toggle |
| NeonScrollbar | `components/NeonScrollbar/` | May not need — pond is spatial, not scrollable |
| NeonScene | `components/Dashboard3D/NeonScene.tsx` | Adapt canvas wrapper for pond scene instead of card grid |
| CircuitBoard | `components/CircuitBoard/` | Evaluate — pond may replace circuit-board as background |
| LightningBorder | `components/LightningBorder/` | Adapt for lily pad focus/hover effects |
| CSS Variables | `src/index.css` | Direct port — neon color palette (#ff10f0, #00eeff, #ff6600, #39ff14, #ffd700) |

**Build new:**

| Component | Purpose |
|---|---|
| PondScene | Three.js water surface with ripple physics and neon lighting |
| LilyPad | Individual todo element — 3D pad with text, color, opacity, hover/focus states |
| LilyPadCluster | Grouped pad formation with shared glow aura |
| EcosystemManager | Spawns and animates creatures (fireflies, frogs, fish, dragonflies) based on todo density |
| AtmosphereController | Zen/cyberpunk mode toggle — adjusts water speed, glow intensity, animation pacing |
| PondSearch | Global keyboard capture, search state management, surface/submerge animation orchestration |
| TodoInput | Contextual text input for creating new todos — neon-styled, appears on trigger |
| ColorPicker | Neon color assignment for lily pads — compact, in-theme |
| SoundManager | Audio layer — ambient loops, interaction triggers, spatial positioning (last implemented) |

### Customization Strategy

**Design tokens (CSS custom properties):**
- `--neon-pink: #ff10f0` — primary accent
- `--neon-cyan: #00eeff` — secondary accent
- `--neon-orange: #ff6600` — warning/attention
- `--neon-green: #39ff14` — success/completion
- `--neon-gold: #ffd700` — highlight/special
- `--pond-dark: #000000` — base background
- `--water-surface: rgba(0, 20, 40, 0.8)` — water color
- `--glow-intensity: 1.0` — base bloom strength (scales with atmosphere mode)

**Atmosphere modes:**
- Zen: `--glow-intensity: 0.6`, slower animation timing, muted colors, gentle ripples
- Cyberpunk: `--glow-intensity: 1.4`, faster animations, saturated colors, active waves

## Defining Experience

### The One-Liner

**"Drop thoughts into a living neon pond. Find them by thinking out loud."**

### Product Personality

The pond is **alive** — it breathes, moves, and evolves even when you're not touching it. It's **immersive** — there is no "app" surrounding the pond, the pond IS everything. It's **interactive** — every hover, click, and keystroke produces a visible environmental response. It's **responsive** — the pond hears you and reorganizes itself around your intent. It's **fun** — randomized creature behaviors, surprising celebration animations, and a custom cursor trail make you want to keep playing. It's **engaging** — the ecosystem scaling, color customization, and atmosphere modes give you reasons to come back and see how your pond has evolved.

### User Mental Model

The closest mental model is a **living koi pond you can think into**. Users don't "add items to a list" — they drop thoughts into a body of water that keeps them alive. They don't "search a database" — they speak to the pond and it surfaces what matters. The pond is a companion that holds your thoughts, not a tool that stores your data.

**Mental model progression:**
1. **First encounter:** "This is art" → passive observation
2. **First interaction:** "Wait, I can put things in here" → discovery
3. **Habitual use:** "The pond knows what I mean" → trust
4. **Ownership:** "This is MY pond" → attachment (colors, density, ecosystem state)

### Success Criteria for Core Experience

- User drops a todo into the pond and *feels* it land — the ripple, the pad settling, the ecosystem responding
- User types a vague concept and watches the right todos surface — "the pond understood me"
- User returns after a day and the pond is exactly as they left it — their colors, their clusters, their ecosystem density
- A first-time viewer watches someone else use it and immediately wants to try — the interaction is visually self-evident
- Nobody ever asks "where's the search bar?" — they just start typing because the pond *invites* interaction

### Novel UX Patterns

This product is almost entirely novel interaction design. No established patterns transfer directly.

**Novel patterns that need visual affordance:**
- **Type-anywhere search** — no search bar exists. The empty pond must hint at this (perhaps faint rippling text on the water: "just start typing...")
- **Hover-to-focus in 3D space** — lily pads respond to mouse proximity, not just direct hover. Nearby pads subtly shift as the cursor approaches.
- **Progressive density** — the pond doesn't paginate or scroll. It compresses. Users need to understand that density IS the natural state, not a bug.
- **Organic grouping** — dragging pads together to cluster them has no standard web precedent. The magnetic drift animation must make the behavior self-evident.

**Familiar metaphors that ground the novelty:**
- Dropping something into water (universal physical intuition)
- Objects floating and sinking (buoyancy = relevance)
- Living things responding to environment (ecosystem = activity indicator)
- Color = category (universal organizational metaphor)

### Experience Mechanics

**1. Adding a Todo (The Drop)**

| Phase | User Action | Pond Response | Duration |
|---|---|---|---|
| Trigger | Keyboard shortcut or dedicated trigger | A subtle glow appears at the water surface — the pond is ready | Instant |
| Input | User types todo text in neon-styled input | Text appears in retro-futuristic font, cursor snake pauses nearby | User-paced |
| Commit | User presses Enter | Input dissolves | 100ms |
| Formation | — | A lily pad forms in the air above the pond surface, glowing with the default or chosen neon color | 200ms |
| Drop | — | The pad falls into the water with realistic physics | 300ms |
| Impact | — | Neon ripples radiate outward from impact point. Nearby pads bob gently. Ecosystem reacts (fish scatter, fireflies flicker). | 500ms |
| Settle | — | Pad drifts to its resting position among other pads, opacity normalizes | 400ms |

**2. Finding a Todo (The Search)**

| Phase | User Action | Pond Response | Duration |
|---|---|---|---|
| Trigger | Start typing anywhere (outside focused element) | Faint search text appears on water surface. Pond begins to shift. | Instant |
| Filter | Each keystroke refines | Matching pads rise, glow brighter, come to foreground. Non-matching pads sink, fade, become translucent. Clusters surface as units with matching members highlighted. | 300ms debounce |
| Ripple | — | Surfacing pads create upward ripples. Submerging pads create downward distortion. | Continuous |
| Focus | Hover a surfaced result | Pad expands to full readability. Cursor snake glows in the pad's color. | 150ms |
| Clear | Press Escape | All pads restore to resting state. Water smooths. Search text dissolves. | 400ms |

**3. Completing a Todo (The Transform)**

| Phase | User Action | Pond Response | Duration |
|---|---|---|---|
| Focus | Hover the lily pad | Pad rises, expands, glows brighter — interactive state | 150ms |
| Toggle | Click to complete | Pad's color shifts (desaturated or dimmed glow). Pad partially submerges — lower in the water than active pads. Occasional bonus: particle burst, frog croak, firefly swarm. | 400ms |
| Uncomplete | Click again | Pad re-saturates, rises back to active level. Gentle ripple. | 300ms |

**4. Deleting a Todo (The Dissolve)**

| Phase | User Action | Pond Response | Duration |
|---|---|---|---|
| Focus | Hover the lily pad | Pad rises to interactive state | 150ms |
| Trigger | Explicit delete action (button/key on focused pad) | — | Instant |
| Dissolve | — | Pad breaks apart, fragments sink below surface. Final outward ripple. Nearby creatures react. | 600ms |
| Settle | — | Water smooths where pad was. Surrounding pads drift slightly to fill the space. | 400ms |

**5. Grouping Todos (The Cluster)**

| Phase | User Action | Pond Response | Duration |
|---|---|---|---|
| Select | Multi-select pads (keyboard modifier + hover/click) | Selected pads glow with a shared pulse | Per-selection |
| Group | Trigger group action | Selected pads drift magnetically toward each other, overlapping into a tight cluster. Shared glow aura forms around the cluster. | 500ms |
| Label | Optional: type a cluster label | Label text floats above the cluster in neon | User-paced |
| Ungroup | Trigger ungroup on a cluster | Pads release, drift apart with outward ripples. Aura dissolves. | 500ms |

## Visual Design Foundation

### Color System

**Primary neon palette (from rag-csv-crew):**

| Token | Hex | Role |
|---|---|---|
| `--neon-pink` | #ff10f0 | Primary accent, active states, cursor trail highlight |
| `--neon-cyan` | #00eeff | Secondary accent, water reflections, search indicators |
| `--neon-orange` | #ff6600 | Warning, attention, error-adjacent states |
| `--neon-green` | #39ff14 | Success, completion glow, ecosystem creatures |
| `--neon-gold` | #ffd700 | Highlight, special events, bonus celebrations |

**Environment colors:**

| Token | Value | Role |
|---|---|---|
| `--pond-dark` | #000000 | Base background beneath water |
| `--water-surface` | rgba(0, 20, 40, 0.8) | Dark blue-green water tint — subtle natural feel |
| `--water-deep` | rgba(0, 10, 25, 0.95) | Deep water for submerged/sinking pads |
| `--water-reflection` | rgba(0, 238, 255, 0.05) | Subtle cyan reflection shimmer on water surface |

**Lily pad colors (user-assignable):**
Each todo can be assigned any neon color from the palette. Default color for new pads is `--neon-cyan`. Completed pads desaturate to 40% of their assigned color's intensity.

**Glow system:**
Every neon color has a corresponding glow variant using CSS `box-shadow` or Three.js Bloom postprocessing. Glow intensity scales with `--glow-intensity` (controlled by atmosphere mode).

### Typography System

**Dual-font strategy:**

| Usage | Font | Rationale |
|---|---|---|
| UI labels, titles, cluster labels, search text | Retro-futuristic monospace (e.g., "Share Tech Mono", "VT323", or custom) | Consistent with rag-csv-crew identity, establishes neon/retro tone |
| Todo text on lily pads | Clean sans-serif (e.g., "Inter", "IBM Plex Sans") | Readability at all sizes including progressive density compression |

**Type scale:**

| Element | Size | Weight | Font |
|---|---|---|---|
| App title / brand | 32px | Bold | Monospace retro |
| Cluster labels | 16px | Bold | Monospace retro |
| Search input text | 20px | Regular | Monospace retro |
| Lily pad text (full size) | 14px | Regular | Sans-serif |
| Lily pad text (medium density) | 11px | Regular | Sans-serif |
| Lily pad text (high density) | 8px | Regular | Sans-serif |
| Lily pad text (minimap density) | — | — | Rendered as colored lines, not readable text |

**Text rendering on lily pads:**
- Full size: readable text, full font rendering
- Medium density: smaller but still legible
- High density: very small, requires hover-to-focus to read
- Minimap density: text replaced with proportional colored lines (Monaco minimap style) — shape of text visible, content requires search to access

### Spacing & Layout Foundation

**No traditional spacing grid.** The pond is a 3D scene — lily pads are positioned by physics simulation, not CSS grid. Spacing is governed by:

- **Pad spacing algorithm** — minimum distance between pad centers, with allowed overlap at edges
- **Cluster cohesion** — grouped pads overlap more tightly than ungrouped pads
- **Density scaling** — as todo count increases, minimum spacing decreases and pad size shrinks
- **Focus expansion** — hovered pads temporarily claim more space, pushing neighbors slightly

**Viewport usage:**
- 100% viewport width and height — no scrolling, no margins, no chrome
- Pond scene fills the entire browser window
- Responsive to window resize — pond redistributes pads to fill available space

**Z-axis layering (depth in 3D):**

| Layer | Content | Z-depth |
|---|---|---|
| Background | Dark water, ambient reflections | Deepest |
| Submerged | Non-matching search results, deleted pads sinking | Below surface |
| Water surface | Ripple effects, water striders | Surface plane |
| Resting pads | Active lily pads at normal state | Slightly above surface |
| Focused pad | Hovered/active lily pad | Elevated above others |
| Ecosystem | Fireflies, dragonflies | Above pads |
| Cursor | Neon snake trail | Topmost layer |
| UI overlay | Search text, todo input, color picker | Screen-space overlay on 3D scene |

### Accessibility Considerations

**Intentionally limited scope (v1):**
- No WCAG compliance requirements — this is an internal demo, desktop Chrome only
- No screen reader support — the 3D pond paradigm is inherently visual
- No keyboard-only navigation beyond type-to-search and keyboard shortcuts
- No high-contrast mode — the neon-on-dark palette IS the product identity

**Baseline considerations maintained:**
- Todo text uses clean sans-serif for maximum readability within the neon context
- Focused lily pads expand to readable size regardless of density
- Neon colors on dark background provide strong contrast ratios naturally (neon green on black = ~11:1)
- Error states are communicated through visual metaphor (biological decay) AND through the todo still being accessible/recoverable

## Design Direction Decision

### Design Directions Explored

Four pond visualization approaches evaluated:
- **A: Top-Down** — simplest, map-like, best readability but least immersive
- **B: Angled Perspective** — dramatic, depth-rich, but fixed viewpoint limits density handling
- **C: Floating Void** — abstract, simpler rendering, but loses the pond metaphor
- **D: Hybrid Angled + Interactive Camera** — most immersive, handles density through zoom, explorable

### Chosen Direction

**Direction D: Hybrid Angled with Interactive Camera**

Default camera sits at ~30-40 degrees looking across the pond surface toward a subtle horizon. The user can orbit, pan, and zoom the camera to explore the pond spatially.

**Camera controls:**
- **Scroll wheel** — zoom in/out (zoom in to read individual pads, zoom out to see the full pond)
- **Click-drag on water** — pan the camera across the pond surface
- **Right-click drag or modifier+drag** — orbit camera angle
- **Double-click empty water** — reset camera to default position
- **Auto-frame on search** — when search results surface, camera smoothly adjusts to frame the visible results

**Zoom behavior:**
- Zoomed out: full pond visible, pads at minimap density, ecosystem creatures visible as ambient movement
- Default zoom: natural working distance, pads readable on hover, comfortable density
- Zoomed in: individual pads large and fully readable, water surface detail visible, creature detail visible

**Camera animation:**
- All camera transitions are smooth (eased, 300-500ms)
- Camera auto-adjusts on window resize to maintain framing
- Search results trigger subtle camera movement to center on the result cluster

### Design Rationale

- **Density handling through zoom** — rather than pads shrinking to minimap density at a fixed camera distance, the user can zoom out to see everything or zoom in to read. Progressive density still applies, but zoom gives the user agency over how they view it.
- **Demo spectacle** — a camera you can orbit around a 3D pond is a "wait, I can do THAT?" moment in a live demo. The presenter can zoom in to show detail, zoom out to show scale.
- **Natural exploration** — the pond becomes a place you move through, not just a screen you look at. This reinforces the "living koi pond" mental model.
- **Search + camera synergy** — search surfaces results AND the camera frames them. The whole environment conspires to show you what you're looking for.

### Implementation Approach

**Three.js camera setup:**
- `OrbitControls` from Three.js/React Three Fiber for zoom, pan, orbit
- Configurable constraints: min/max zoom distance, orbit angle limits (prevent going underwater), pan boundaries
- Smooth damping on all camera movements for polished feel
- Programmatic camera transitions for search-triggered framing

**Performance considerations:**
- Level-of-detail (LOD) rendering — reduce pad detail at far zoom distances
- Frustum culling — only render pads visible in current camera view
- Ecosystem creatures simplified at far zoom, detailed at close zoom

**Atmosphere mode interaction:**
- Zen mode: slower camera damping, gentler transitions, camera drift when idle
- Cyberpunk mode: snappier camera response, faster transitions, no idle drift

## User Journey Flows

### Flow 1: First Encounter (New User Arrives)

```mermaid
flowchart TD
    A[User opens URL] --> B[Pond loads — dark water, ambient glow]
    B --> C{Todos exist?}
    C -->|No| D[Empty pond — subtle ripples, lone firefly]
    C -->|Yes| E[Pond populated — pads floating, ecosystem active]
    D --> F[Faint rippling text on water: 'just start typing...']
    F --> G[User moves mouse — cursor snake trail activates]
    G --> H{User types?}
    H -->|Yes| I[Todo input appears — first pad drops into pond]
    H -->|No — hovers| J[Nearby water ripples follow cursor]
    J --> H
    I --> K[Ripple + ecosystem response — delight moment]
    K --> L[User is now in the core loop]
    E --> G
```

**Key design decisions:**
- No onboarding overlay, no tutorial, no welcome modal
- The empty pond itself IS the onboarding — ambient movement invites interaction
- "Just start typing..." ripple text is the only explicit hint
- Cursor snake activates immediately — first moment of "this is different"

### Flow 2: Adding a Todo (The Drop)

```mermaid
flowchart TD
    A[User triggers input — keyboard shortcut or dedicated trigger] --> B[Neon input field appears — pond surface glows at entry point]
    B --> C[User types todo text]
    C --> D{User presses Enter?}
    D -->|Yes| E[Input dissolves]
    D -->|Escape| F[Input cancels, pond restores]
    E --> G[Lily pad forms above water — glows with color]
    G --> H[Pad drops into water — physics-based fall]
    H --> I[Impact: neon ripples radiate outward]
    I --> J[Nearby pads bob, ecosystem reacts]
    J --> K[Pad drifts to resting position]
    K --> L{Bonus animation? — random chance}
    L -->|Yes| M[Extra fireflies / fish jump / frog croak]
    L -->|No| N[Standard settle]
    M --> O[Embedding generated async in background]
    N --> O
    O --> P[Pad fully searchable once embedding completes]
```

**Key design decisions:**
- Embedding generation is invisible to user — pad appears instantly, search capability follows async
- Random bonus animations on ~20% of adds (casino mechanic)
- Escape always cancels cleanly — no data loss risk

### Flow 3: Finding a Todo (The Search)

```mermaid
flowchart TD
    A[User starts typing — not focused on any element] --> B[Search text appears on water surface in monospace retro]
    B --> C[300ms debounce — pond begins shifting]
    C --> D[Backend returns hybrid search results]
    D --> E[Matching pads rise + glow at full intensity]
    D --> F[Non-matching pads sink + fade to translucent]
    D --> G[Matching clusters surface as units — matches highlighted, siblings faded]
    E --> H[Camera auto-frames to center on results]
    F --> I[Submerging pads create downward ripple distortion]
    G --> H
    H --> J{User hovers a result?}
    J -->|Yes| K[Pad expands to full readability — cursor snake matches pad color]
    J -->|More typing| C
    K --> L{User acts on pad?}
    L -->|Click to complete| M[Complete flow]
    L -->|Delete| N[Delete flow]
    L -->|Escape| O[Clear search — all pads restore, water smooths]
    O --> P[Camera returns to default position]
```

**Key design decisions:**
- Full-text results appear first (fast), vector results refine ranking (slower) — progressive enhancement
- Camera auto-framing means the user doesn't have to manually navigate to results
- Escape is always the universal reset — clear search, restore pond, reset camera

### Flow 4: Grouping Todos (The Cluster)

```mermaid
flowchart TD
    A[User holds modifier key — Shift or Ctrl] --> B[Selection mode activated — subtle visual indicator]
    B --> C[User hovers + clicks pads to select]
    C --> D[Selected pads pulse with shared glow]
    D --> E{More to select?}
    E -->|Yes| C
    E -->|No — trigger group| F[Selected pads drift magnetically toward center point]
    F --> G[Pads overlap into tight cluster formation]
    G --> H[Shared glow aura forms around cluster]
    H --> I{User types label?}
    I -->|Yes| J[Label floats above cluster in monospace retro neon]
    I -->|Skip| K[Unlabeled cluster]
    J --> L[Cluster complete — behaves as single unit]
    K --> L
    L --> M{Later: ungroup?}
    M -->|Yes| N[Pads release — drift apart with outward ripples]
    N --> O[Aura dissolves, pads return to independent floating]
```

**Key design decisions:**
- Modifier key for selection avoids conflicting with type-to-search
- Magnetic drift animation makes grouping feel physical, not digital
- Clusters are visual units — they drift together, surface together in search

### Flow 5: Live Demo Walkthrough

```mermaid
flowchart TD
    A[Presenter opens app on projected screen] --> B[Empty pond — ambient glow fills room display]
    B --> C[Cursor snake trail visible on projection — immediate wow]
    C --> D[Presenter adds first todo — pad drops with ripple]
    D --> E[Adds 3-4 more todos — pond comes alive]
    E --> F[Ecosystem awakens — fireflies appear]
    F --> G[Presenter assigns different colors — visual variety]
    G --> H[Presenter groups 2 todos — magnetic cluster demo]
    H --> I[Presenter types search query — pond reorganizes dramatically]
    I --> J[Camera auto-frames results — visual spectacle]
    J --> K[Presenter toggles atmosphere — zen to cyberpunk]
    K --> L[Entire environment transforms — crowd reaction]
    L --> M[Presenter zooms out — shows full pond overview]
    M --> N[Zooms into a specific pad — detail visible]
    N --> O[Demo complete — Q&A]
```

**Key design decisions:**
- Demo flow is designed to escalate visual impressions: cursor → drop → ecosystem → search → atmosphere → camera
- Each step introduces a new capability AND a new visual moment
- The atmosphere toggle is the climax — the entire world changes

### Journey Patterns

**Universal patterns across all flows:**

- **Escape always resets** — clear search, cancel input, deselect, reset camera. One key, always safe.
- **Visual response IS confirmation** — no toasts, no modals, no banners. The pond's physical response confirms every action.
- **Progressive revelation** — each interaction reveals the next possibility. First-time users discover by doing.
- **Camera follows intent** — search frames results, adding pads keeps them in view, zooming is always available.

### Flow Optimization Principles

- **Zero dead ends** — every state has a clear next action or escape path
- **Keyboard-first, mouse-enhanced** — type to search, type to add, keyboard shortcuts for grouping. Mouse for spatial interaction (hover, drag, zoom).
- **Fail silently, recover visibly** — if embedding fails, the pad still exists. If search returns nothing, the pond goes still (empty result = calm water). Errors show as biological decay, not error codes.
- **Anticipation before resolution** — every action has a brief build-up (pad forming, water shifting, pads drifting) that creates satisfying rhythm.

## Component Strategy

### Ported Components (from rag-csv-crew)

| Component | Source | State in Todo App |
|---|---|---|
| **CursorSnake** | `CursorSnake/` | Direct port — neon hexagon chain cursor with spring animation |
| **NeonScene** | `Dashboard3D/NeonScene.tsx` | Adapted — canvas wrapper reconfigured for pond scene with OrbitControls |
| **LightningBorder** | `LightningBorder/` | Adapted — used for cluster glow aura and focused pad highlight |
| **CSS Variables** | `index.css` | Direct port — full neon color palette |
| **NeonScrollbar** | `NeonScrollbar/` | Used in lizard belly list view |

*Note: NeonCheckbox from rag-csv-crew is NOT used — replaced by the egg hatching mechanic.*

### Custom Components — Pond Environment

#### PondScene

**Purpose:** The primary 3D environment — a dark blue-green water surface with ripple physics, neon reflections, and ambient lighting.
**Content:** Water surface, ambient reflections, ripple effects, horizon line.
**States:**
- Idle — subtle water movement, ambient reflections
- Active — ripples from user actions (drops, searches, deletes)
- Zen mode — slow ripples, muted glow, calm movement
- Cyberpunk mode — active waves, bright glow, faster ripples
**Interaction:** Click-drag to pan, scroll to zoom, right-drag to orbit. Double-click water to reset camera.

#### LilyPad

**Purpose:** Individual todo element — a floating 3D pad on the water surface displaying todo text.
**Content:** Todo text (sans-serif), neon glow border in assigned color, egg, and creature-controls on hover.
**States:**
- Resting — floating at water level, partial opacity, assigned neon color, egg visible
- Hovered — rises above surface, expands, full opacity, text fully readable. Creature controls appear (aphid, chameleon).
- Completed — desaturated to 40% color intensity, sits lower in water. Hatched shell visible instead of whole egg.
- Error — biological decay: bite marks appear, textures degrade
- Searching (match) — rises, glows at full intensity, foregrounded
- Searching (no match) — sinks below surface, fades to translucent
- Aging — pad edges browning, slight wilt, dimming glow (approaching auto-archive threshold)
- Minimap density — pad shrinks, text becomes rendered colored lines
**Interaction:** Hover to focus. Drag to move or drag into/out of clusters. Click egg to complete. Click aphid to delete. Click chameleon to pick color.

### Custom Components — Creature Controls

Three creature-controls appear on/near a focused lily pad. They are inhabitants of the pond, not UI buttons.

#### Completion Egg

**Purpose:** Complete/uncomplete a todo through a creature-hatching lifecycle.
**Position:** Sits on the lily pad surface, always visible (even at resting state).
**Appearance:** Small luminescent egg, glowing in the pad's assigned neon color.

| State | Visual | User Action | Result |
|---|---|---|---|
| Active (whole egg) | Intact neon egg on pad, subtle pulse | Click egg | Egg cracks, wobbles, random creature hatches and joins ecosystem. Pad desaturates. |
| Completed (hatched shell) | Cracked empty shell remains on pad | — | Visual marker that todo is done |
| Uncomplete | — | Click hatched shell | Shell reforms into whole egg. Creature spawned by this egg despawns from ecosystem. Pad re-saturates. |

**Hatch rarity tiers (casino mechanic):**

| Rarity | Creatures | Chance | Visual Impact |
|---|---|---|---|
| Common | Firefly, water strider | ~50% | Subtle ambient addition |
| Uncommon | Frog, dragonfly, butterfly | ~35% | Noticeable, fun to watch |
| Rare | Fish (splashes off pad into water), turtle | ~12% | Exciting, brief celebration |
| Legendary | Golden koi, neon phoenix, glowing jellyfish | ~3% | Major visual event, particle burst |

**Creature despawn on uncomplete:** The specific creature born from that egg fades out of the ecosystem with a subtle dissolve — maintaining the 1:1 relationship between completed todos and ecosystem fauna.

**Ecosystem implication:** Completed todos = ecosystem fauna count. The more you complete, the more biodiverse and alive the pond becomes. This creates a productivity → beauty feedback loop.

#### Delete Aphid

**Purpose:** Delete a todo through an interruptible creature-eating animation.
**Position:** Near the lily pad, appears on hover.
**Appearance:** Small sleeping aphid character — floating Z's, occasional grumbling belly animation.

| Phase | Visual | User Action | Duration |
|---|---|---|---|
| Idle | Aphid sleeping with floating Z's near pad | — | — |
| Triggered | Aphid wakes up, eyes open, starts eating pad edge | Click aphid | Instant |
| Eating | Pad visibly shrinks/decays from bite point. Progress bar below pad shows consumption. | Watch or interrupt | ~3 seconds |
| Abort | Aphid stops eating, yawns, falls back asleep. Pad regenerates to full. | Click pad before progress completes | 300ms recovery |
| Complete | Aphid consumes entire pad. Pad dissolves. Aphid burps. Fragments drift toward lizard. | Let progress bar finish | 500ms dissolve |

**Sound (when implemented):** Crunching during eating, satisfied burp on completion, snoring during sleep.

#### Color Chameleon

**Purpose:** Assign or change the neon color of a lily pad.
**Position:** Near the lily pad, appears on hover.
**Appearance:** Small friendly chameleon, skin color matches pad's current assigned color.

| Phase | Visual | User Action |
|---|---|---|
| Idle | Chameleon sits near pad, skin matches pad color | — |
| Triggered | Chameleon perks up, color picker ring opens around it | Click chameleon |
| Picking | Neon color dots in a ring (pink, cyan, orange, green, gold). Chameleon previews hovered color in real-time. | Hover to preview |
| Selected | Chameleon shifts to new color, pad glow transitions to match. Picker closes. Subtle ripple. | Click a color |
| Cancelled | Picker closes, chameleon returns to original color | Escape or click away |

### Custom Components — Pond Residents

#### Trash/Archive Lizard

**Purpose:** Permanent pond resident serving as trash bin and auto-archive. Recoverable storage for deleted and aged-out todos.
**Position:** Wanders slowly around the pond edge, repositioning occasionally. Always visible.
**Appearance:** Fat, content, sleepy lizard with visibly large belly. Neon-colored, matches atmosphere mode. Comic energy.

**Belly size:** Scales visually with consumed todo count. Empty = slim. 50+ = comically rotund.

**How todos enter the belly:**

| Source | Trigger | Animation |
|---|---|---|
| Deleted todo | Aphid finishes eating pad | Pad fragments drift toward lizard, lizard gulps them down. Belly grows slightly. |
| Auto-archived todo | Todo age exceeds configurable threshold | Pad slowly drifts toward lizard, edges browning/wilting. Lizard gently consumes it. |

**Pre-archive visual warning:** Todos approaching archive threshold show subtle aging — browning edges, wilt, dimming glow. Threshold configurable (7/14/30 days, or never).

**Belly view (recovery):**

| Phase | Visual | User Action |
|---|---|---|
| Trigger | Lizard burps, neon-styled list panel opens | Click the lizard |
| Browse | Scrollable neon list — text, color dot, date consumed, source (deleted/archived) | Scroll, search within list |
| Recover | Lizard spits out new lily pad with comedic animation. Pad lands with ripple. Fresh egg appears. | Click restore on a row |
| Close | List panel closes, lizard settles back down | Escape or click away |

**Belly list styling:** Neon-bordered panel, NeonScrollbar, monospace retro headers, sans-serif todo text. Search/filter within list.

**Lizard behavior:**
- Wanders slowly around pond perimeter, pausing in different spots
- Reacts to nearby interactions — blinks when pads drop nearby, watches aphids with interest
- Zen mode: mostly sleeping, slow movement
- Cyberpunk mode: more alert, tongue flicks, eyes tracking cursor

#### EcosystemManager

**Purpose:** Spawns and manages ambient wildlife. Creature population is the sum of: baseline ambient creatures + hatched creatures from completed todos.
**Creature sources:**
- Ambient creatures: scale with todo count (the flora feeds baseline fauna)
- Hatched creatures: 1:1 with completed todos (tracked individually for despawn on uncomplete)
**Behavior:** Randomized autonomous movement, reactions to user actions, emergent micro-events (frog catches firefly, fish leap), LOD scaling with zoom distance.

### Custom Components — UI Overlays

#### AtmosphereController

**Purpose:** Toggles between zen and cyberpunk mood.
**Trigger:** Keyboard shortcut or subtle glowing orb at pond's edge.
**States:** Zen (slow, muted, calm) / Cyberpunk (fast, bright, energetic).

#### PondSearch

**Purpose:** Global keyboard capture and search-driven pond transformation.
**Content:** Search text rendered on water surface in monospace retro.
**States:** Inactive / Active (pond reorganizing) / Empty results (pond goes still).
**Interaction:** Type anywhere to activate, Escape to clear, Backspace to edit.

#### TodoInput

**Purpose:** Contextual text input for creating new todos.
**Trigger:** Keyboard shortcut (e.g., `N` or `/` when not searching).
**States:** Hidden / Active (neon input visible) / Submitting (dissolves, pad forms).

#### SoundManager

**Purpose:** Audio layer. **Last implemented feature.**
**States:** Muted (default) / Active (user-enabled via firefly icon toggle).

### Component Implementation Roadmap

**Phase 1 — Core Pond (must have for any demo):**
1. PondScene — water surface with ripple physics
2. LilyPad — todo element with text, color, hover/focus states
3. CursorSnake — ported from rag-csv-crew
4. TodoInput — create todos
5. Completion Egg — hatch to complete (common creatures only initially)
6. PondSearch — type-to-search with surface/submerge

**Phase 2 — Creature Controls & Ecosystem:**
7. Delete Aphid — interruptible delete mechanic
8. Trash/Archive Lizard — belly view with recovery
9. Color Chameleon — color picker creature
10. EcosystemManager — ambient wildlife + hatched creature tracking
11. LilyPadCluster — grouping/ungrouping
12. Hatch rarity tiers — uncommon, rare, legendary creatures

**Phase 3 — Atmosphere & Polish:**
13. AtmosphereController — zen/cyberpunk toggle
14. Camera enhancements — auto-framing, idle drift, orbit constraints
15. Auto-archive — configurable aging threshold, lizard consumption
16. Randomized casino celebrations — bonus animations on actions
17. SoundManager — ambient + interaction audio (last feature)

## UX Consistency Patterns

### Creature Interaction Pattern

Every user action on a lily pad is performed through a creature. Creatures follow consistent behavior rules:

| Rule | Description |
|---|---|
| **Appear on hover** | Creature controls (aphid, chameleon) appear when pad is focused. Egg is always visible. |
| **Idle animation** | Every creature has a resting animation when not interacting (aphid sleeps, chameleon sways, egg pulses) |
| **Feedback through character** | The creature's reaction IS the confirmation (aphid burps, chameleon shifts color, egg cracks) |
| **Interruptible** | Destructive actions (delete) have a visible progress window for cancellation |
| **Non-destructive default** | Hovering/focusing never triggers an action — only explicit clicks |

### Environmental Feedback Pattern

The pond replaces all traditional feedback mechanisms (toasts, banners, modals) with environmental responses:

| Traditional Pattern | Pond Equivalent |
|---|---|
| Success toast | Ripple effect + ecosystem reaction (fish jump, fireflies flicker) |
| Error banner | Biological decay on affected pad (bite marks, wilt) + creature scatter |
| Loading spinner | Water surface shimmer where content is expected |
| Confirmation modal | Interruptible animation (aphid eating progress bar) |
| Empty state message | Calm pond with faint rippling text on water surface |
| Progress indicator | Aphid eating progress bar (delete), egg wobble duration (complete) |

**Rule:** If it can be communicated through the pond's physics or creatures, it must be. No overlaid UI feedback except the lizard belly list and search text on water.

### State Communication Pattern

Todo states are communicated through consistent visual language:

| State | Egg | Pad Color | Pad Position | Glow | Additional |
|---|---|---|---|---|---|
| Active | Whole, pulsing | Full intensity, assigned neon | Floating at surface | Full bloom | — |
| Completed | Hatched shell | 40% desaturated | Lower in water | Reduced bloom | Creature in ecosystem |
| Searching (match) | Visible | Full intensity | Risen, foregrounded | Bright bloom | Camera frames it |
| Searching (no match) | Hidden | Faded | Sunk below surface | No bloom | Translucent |
| Error | Visible, dimmed | Unchanged | Unchanged | Flickering | Bite marks, decay, creatures flee |
| Aging (near archive) | Visible, dusty | Browning edges | Drifting toward lizard | Dimming | Wilt effect |
| In cluster | Visible | Shared with cluster | Tight overlap | Shared aura | Cluster label above |

### Keyboard Pattern

Consistent keyboard behavior across all contexts:

| Key | Context: Nothing focused | Context: Pad focused | Context: Input active |
|---|---|---|---|
| Any letter/number | Starts search | Starts search | Types in input |
| Escape | Reset camera to default | Unfocus pad | Cancel input/search |
| Enter | — | — | Submit todo |
| Backspace | Edit search text | — | Edit input text |
| Delete | — | Triggers aphid on focused pad | — |
| N or / | Opens todo input | Opens todo input | — |
| Shift/Ctrl + Click | — | Multi-select for grouping | — |
| G | — | Group selected pads | — |
| U | — | Ungroup focused cluster | — |
| Tab | Cycle focus between pads | Next pad | — |
| Space | — | Toggle completion (click egg) | — |

**Rule:** Escape always de-escalates — from search to unfocus to default. Never trapped.

### Search Behavior Pattern

Consistent search behavior regardless of what triggers it:

| Behavior | Rule |
|---|---|
| Activation | Typing outside any focused element |
| Debounce | 300ms before API call |
| Progressive results | Full-text results appear first (fast), vector results refine ranking (slower) |
| Visual response | Matches rise + glow, non-matches sink + fade. Clusters surface as units. |
| Camera | Auto-frames to center on result cluster |
| Empty results | Pond goes still. Water calms. No "no results found" text — the stillness communicates it. |
| Clear | Escape — all pads restore, water smooths, camera resets |
| Persistence | Search text visible on water surface throughout active search |

### Error & Recovery Pattern

All errors follow the biological decay metaphor:

| Error Type | Visual | Recovery |
|---|---|---|
| Embedding generation fails | Pad exists but egg doesn't pulse (dormant). No creature will hatch until embedding succeeds. Search works via full-text only. | Auto-retry in background. Egg starts pulsing when embedding completes. |
| API timeout | Water surface briefly distorts/glitches near affected area. Affected pad shows faint decay marks. | Auto-retry. Decay marks heal on success. |
| Save failure | Pad that was dropping freezes mid-air, flickers. | Retry animation. If persistent, pad dissolves with error ripple and todo input reopens with text preserved. |
| Search failure | Water surface goes unnaturally still (not calm — frozen). | Clears automatically, search text remains for retry. |

**Rule:** Errors are always visible but never blocking. The user can continue interacting with the rest of the pond while errors resolve in the background.

### Loading Pattern

| Scenario | Visual |
|---|---|
| Initial pond load | Dark water fades in, then pads materialize one by one (staggered, not all at once) with gentle drops |
| Embedding generating | Egg on new pad has a faint shimmer/processing indicator until embedding completes |
| Search in progress | Water surface subtly shifts direction, indicating "thinking" |
| Lizard belly loading | Neon loading pulse in the belly list panel |

**Rule:** Loading states use environmental animation (water shimmer, egg glow, surface shifts), not spinners or skeleton screens.

## Responsive Design & Accessibility

### Responsive Strategy

**Desktop only — no responsive breakpoints.** This application targets a single platform: desktop Chrome with keyboard and mouse. No tablet, no mobile, no touch.

**Window resize handling:**
- Pond scene fills 100% viewport at all times
- On resize, the Three.js renderer adjusts canvas dimensions
- Lily pads redistribute to fill available space (physics simulation rebalances)
- Camera framing adjusts to maintain pond overview
- No minimum width/height enforced — the pond adapts fluidly to any desktop window size

**Aspect ratio considerations:**
- Ultra-wide monitors (21:9): pond extends horizontally, more water surface visible, pads spread wider
- Standard monitors (16:9): default design target
- Tall/portrait windows: pond compresses vertically, pads may overlap more — zoom becomes more important

### Breakpoint Strategy

**No breakpoints.** The Three.js viewport is inherently responsive to container size. The pond is not a CSS layout — it's a 3D simulation that fills whatever space it's given.

**The only "breakpoint" that matters:**
- If window width < 800px or height < 500px: display a neon-styled message: "This experience is designed for desktop. Please resize your window." — maintaining the aesthetic even in the fallback state.

### Accessibility Strategy

**Intentionally minimal for v1** — this is an internal Nearform demo, not a public-facing product.

**Not in scope:**
- WCAG compliance (any level)
- Screen reader support — the 3D pond is inherently visual
- High contrast mode — neon-on-dark IS the identity
- Touch targets — no touch input
- Reduced motion — animations ARE the product

**In scope (baseline usability):**
- **Keyboard navigation** — Tab to cycle pads, Space to toggle completion, Delete for aphid, Escape to reset. Full keyboard access to all actions.
- **Readable text** — clean sans-serif for todo text, hover-to-focus expands pads to readable size at any density
- **Color independence** — todo states are communicated through multiple channels (position, glow, egg state) not just color. A colorblind user can distinguish active from completed via pad position and egg state.
- **Neon contrast** — neon colors on black background naturally provide high contrast ratios (neon green #39ff14 on black = ~11:1)

### Testing Strategy

**Visual/interaction testing:**
- Manual testing on standard monitor (16:9) and ultra-wide (21:9)
- GPU performance profiling — 60fps target with 30+ pads, ecosystem creatures, and Bloom postprocessing
- Camera control testing — orbit limits, zoom boundaries, auto-framing behavior
- Keyboard-only walkthrough — verify all actions achievable without mouse (except camera orbit/pan)

**Browser testing:**
- Chrome latest only — no cross-browser testing required

**Performance benchmarks:**
- Measure frame rate at density milestones: 10, 20, 30, 50 pads
- Measure search response latency at same milestones
- Profile Three.js render loop for memory leaks during extended sessions

### Implementation Guidelines

**Three.js viewport:**
- Use `window.innerWidth` / `window.innerHeight` for renderer sizing
- Listen to `resize` event for dynamic canvas adjustment
- OrbitControls automatically adapt to container changes

**Text rendering in 3D:**
- Use HTML overlay (CSS2DRenderer or CSS3DRenderer) for pad text rather than 3D text geometry — sharper rendering, easier font handling
- Overlay text scales with camera distance for density behavior
- Fallback to colored lines (canvas-rendered) at minimap density

**Performance guardrails:**
- Instance pool for lily pad meshes — reuse rather than create/destroy
- Ecosystem creatures use instanced rendering where possible
- Bloom postprocessing resolution scales down if frame rate drops below 50fps
- Debounce search to prevent excessive re-rendering during rapid typing
