# UX and visual design specification

> Companion to [`../PLAN.md`](../PLAN.md). This is a spec, not a survey — it says what to build.

## 1. Layout

Four regions, all resizable, sizes persisted per breakpoint bucket via `react-resizable-panels`'
`autoSaveId`.

```
┌────────────────────────────────────────────────────────────────────────┐
│ App bar 40px — tabs · schema chip · validity pill · Tree|Form|Source   │
├──────────────┬──────────────────────────────────┬──────────────────────┤
│              │                                  │                      │
│  INSPECTOR   │            TREE                  │   DERIVED VIEWS      │
│  360px       │            flex, min 480px       │   380px              │
│  (280–560)   │                                  │   (320–560)          │
│              │                                  │   Source│Diagram│    │
│              │                                  │   History            │
│              ├──────────────────────────────────┤                      │
│              │ breadcrumb 28px                  │                      │
├──────────────┴──────────────────────────────────┴──────────────────────┤
│ PROBLEMS — 28px strip, expands 180–360px                               │
└────────────────────────────────────────────────────────────────────────┘
```

### The left panel is the selection inspector

The brief mandates the attributes editor on the left. The right generalisation is that **everything
about the selected node lives in one fixed place** — the property beginners rely on most. Stacked
sections, in order:

1. **Identity header** — QName, validity badge
2. **What is this?** — documentation card (§6)
3. **Attributes** — required first, then set, then unset
4. **Value** — text/value editor for simple-content nodes
5. **Allowed here** — read-only content-model summary
6. **Problems with this node**

Sections come from a **per-document-kind registry**, so XSD and Schematron modes swap sections in
without a second layout implementation.

### Responsive

| Width | Behaviour |
|---|---|
| ≥1600 | all four regions open, right panel showing Source |
| 1280–1599 | right panel auto-collapses to its rail; Source becomes a `Ctrl+E` overlay splitting the centre **horizontally** rather than stealing tree width; Inspector 320px |
| 1024–1279 | Inspector 300px; right panel rail only; Problems overlays with a scrim rather than pushing layout |
| <1024 (tablet) | single column, bottom segmented control Tree \| Inspector \| Problems; selecting a node slides the Inspector in as a **left-anchored** sheet (honouring the brief); Insert palette becomes a full-screen sheet at 44px rows |
| phone | **explicitly out of scope** — say so rather than half-supporting it |

## 2. The tree

### Row anatomy

```
[twisty 24] [validity 16] [kind icon 16] [ns chip] [element name] [cardinality] [attr chips +n] [= "text…"] [required] [⋯]
```

- Row height from a `--row-h` CSS variable: **32 comfortable / 28 compact (default) / 24 dense**.
- Indent exactly **16px per level**, with 1px indent guides at 40% opacity. The guide for the focused
  node's ancestor chain highlights to accent colour — the cheapest orientation aid there is, and
  Figma's layers panel proves it works.
- **Cardinality chip is literal**: `1 of 1–3`, `2 of 0–∞`. Amber below min, red above max. Tabular
  numerals so `1 of 1–3` and `10 of 1–30` align.
- Attribute chips render `name=value` in mono 11px, clipped at 14 chars; clicking one focuses that
  field in the Inspector.
- Inline text preview in italic tertiary, truncated at ~48 chars.

Steal Chrome DevTools' Elements panel wholesale here — badge chips, inline preview and a bottom
breadcrumb are all proven at this density.

### Namespace colouring

Hash each namespace URI into one of **eight curated OKLCH hues** (fixed L≈0.55 light / 0.72 dark,
C≈0.11) rather than free hue rotation, which produces low-contrast near-duplicates. Colour tints
**only the prefix chip background**, never the element name text. The prefix text is always shown, so
colour is decoration and never information (WCAG 1.4.1).

Unprefixed default-namespace elements get a neutral grey chip rather than nothing, so beginners learn a
namespace is still in play.

### Drag and drop — pre-emptive, never post-hoc

On drag start, compute the **full legal-drop set once** by asking the content-model engine which
`(parent, index)` pairs accept the dragged node's QName.

- legal insertion points: 2px accent line with a 4px round cap
- legal containers: 2px inset ring
- illegal rows: 45% opacity, `cursor: no-drop`, and after 400ms dwell a tooltip naming the reason —
  *"`<price>` can't go inside `<address>`. It's allowed inside `<item>`."*

**Never allow the drop and then revert.** Blockly and Scratch established that refusing at the boundary
*teaches the rule*, whereas snap-back after acceptance teaches nothing. Add a "Show me where it can go"
affordance that flashes the legal ancestors.

`Alt+↑/↓` is the keyboard equivalent and applies the same check, with a 120ms horizontal shake plus a
live-region message when refused.

`@headless-tree`'s `dragAndDropFeature` exposes `canDrop` / `canDropForeignDragObject`, which map
directly onto this. `@dnd-kit` is the fallback, but then you own the keyboard DnD story.

### Search and filter

`Ctrl+F` opens a **sticky filter bar at the top of the tree**, not a floating widget: input, match
count (`7 of 132 nodes`), prev/next, three scope toggles (element names / attribute values / text
content) and a "Problems only" chip.

Filtering **narrows** rather than highlights: non-matching nodes hide, but every match's full ancestor
chain stays visible and auto-expanded, rendered at 60% opacity so it is obvious they are context rather
than matches. Matched substrings highlight with a background token, never colour alone. **Escape
restores the previous expansion state exactly** — store it before filtering.

### Breadcrumb

Sticky 28px footer under the tree, clickable segments, `…` overflow past four segments, click-to-copy
XPath on the right. In expert mode it renders the XPath directly
(`/po:order/po:items/po:item[2]`). Deliberately at the bottom, matching DevTools, so it does not
compete with the filter bar for the top edge.

## 3. The Insert palette — the most important screen in the product

A 420px popover (520px when the preview pane fits) anchored below the insertion caret, max-height
`min(480px, 60vh)`, falling back to a centred dialog under 1024px.

**Header:** segmented control `Before <sibling> · Inside <parent> · After <sibling>`, with a one-line
position sentence beneath.

**Search:** auto-focused, fuzzy-matching **both element name and documentation text** — so typing
"price" surfaces an element literally named `amt` documented as "unit price".

**Groups, in fixed order, never re-sorting as you type:**

| Group | Notes |
|---|---|
| **Required — missing (n)** | red-tinted left border, `Add all required` button in the group header |
| **Suggested next** | what the sequence expects at this exact position |
| **Optional (n)** | |
| **Repeat this** | only when below `maxOccurs`; row reads `Another <item> (2 of 1–10)` |
| **Templates** | schema-derived snippets — `Full <address> with all required children` |
| **More node types** | text, comment, CDATA, PI — collapsed in beginner mode |

**Each row:** icon, `ns:name`, cardinality chip, type chip (`text` / `date` / `choice`), and a second
line of ≤120 characters of plain description.

**Preview pane** (right, when width allows): the exact XML to be inserted, plus full documentation.
**This is where teaching actually happens.**

**Footer** always shows key hints: `↑↓ move · Enter insert · ⇧Enter insert and keep open · Tab preview
· Esc cancel`.

Two details that matter disproportionately:

- When the content model is a choice, the group header reads **"Choose one of:"**.
- When nothing is legal, the empty state **explains why** rather than showing an empty list: *"`<price>`
  only holds text (a decimal number). You can't put elements inside it."*

### Insertion must be impossible to miss

Render it three ways simultaneously: a persistent ghost `+ Add …` row as the last child of the
selected element, a primary Insert button in the tree toolbar, and four key bindings — `Ctrl+Space`
(IDE muscle memory), `/` (Notion muscle memory), `+` (discoverable), and `Insert`.

### "Add all required" is recursive and fills values

It walks the content model depth-first adding every element with `minOccurs ≥ 1` and every
`use="required"` attribute, filling: `fixed` verbatim, `default` verbatim, first `xs:enumeration`
entry, today's date for date types, `0` for numerics respecting `minInclusive`, and for `xs:pattern` a
string from the regex sample generator clamped by `minLength`/`maxLength`.

**Every generated value is marked a placeholder** — tertiary italic with a dot marker, counted in an
`n placeholders to review` chip in the app bar, steppable with `F7`/`Shift+F7`, cleared on first user
edit. This turns "valid but meaningless" into a guided to-do list, which is exactly what a beginner
needs after a wizard drops them into a filled skeleton.

## 4. Smart paste

On `Ctrl+V` of XML that does not fit at the caret, open a **Paste helper sheet** listing ranked
options, each annotated with its validity consequence:

- *Paste inside `<x>` — adds 2 errors*
- *Paste as a sibling after `<y>` — valid*
- *Paste as text content — valid*
- *Strip namespace prefixes and paste inside — valid*

Default-select the highest-validity option, show a diff-style preview. `Ctrl+Shift+V` goes straight to
the sheet; plain `Ctrl+V` takes the default when exactly one option is valid and opens the sheet
otherwise. This converts the single most error-prone beginner action into a teaching moment while
staying one keystroke for experts.

## 5. Keyboard map — this is the contract, bind exactly these

**Navigation** (WAI-ARIA APG tree pattern)

| Key | Action |
|---|---|
| `↓` `↑` | next / previous visible node |
| `→` | expand, else move to first child |
| `←` | collapse, else move to parent |
| `Home` `End` | first / last visible |
| `*` | expand all siblings at this level |
| printable chars | typeahead, 500ms buffer, matches local name then documentation text |

**Selection:** `Shift+↓/↑` extend · `Ctrl+↓/↑` move focus without selecting · `Ctrl+Space` toggle
selection · `Ctrl+A` select siblings

**Editing:** `F2` rename · `Enter` edit primary value (text content, else first required attribute) ·
`Escape` cancel · `Tab` commit and move to next field

**Insert:** `Ctrl+Space` / `/` / `+` / `Insert` open the palette; inside it `←/→` or `Tab` switches
Before \| Inside \| After

**Structure:** `Ctrl+D` duplicate ("repeat this") · `Alt+↑/↓` move among siblings · `Delete` ·
`Ctrl+X/C/V` subtree cut/copy/paste · `Ctrl+Shift+V` smart paste

**Problems:** `F8` next · `Shift+F8` previous · `Ctrl+.` quick-fix menu

**Search:** `Ctrl+F` filter · `F3`/`Shift+F3` next/previous match

**Global:** `Ctrl+K` command palette · `Ctrl+Z`/`Ctrl+Shift+Z` · `Ctrl+Alt+Z` History panel ·
`Ctrl+1/2/3` focus Inspector/Tree/Problems · `Ctrl+E` Source · `Ctrl+Shift+E` Form view · `?`
cheatsheet

`Escape` must never trap focus inside the tree.

## 6. Beginner scaffolding

### The documentation guarantee

**The teaching promise cannot depend on schema authors having written documentation.** Most schemas a
beginner meets have none.

`src/schema/describe.ts` always returns a sentence, in priority order:

1. first sentence of `xs:documentation` in the user's language (`@xml:lang`, BCP-47 lookup)
2. an `xs:appinfo` label, if a recognised convention is present
3. **a generated sentence** — humanise the element name (`shipDate` → "Ship date"), append the
   base-type description from a hand-written map of the ~45 built-ins (`xs:date` → "holds a date"),
   append the cardinality clause ("Exactly one is required here." / "You can add between 1 and 10."),
   append any facet clause ("Must be one of: GBP, EUR, USD.")

Every palette row, tooltip and Form-view hint calls this **one function**, so no code path can render a
blank description. Generated descriptions carry a subtle `auto` affordance so users learn to
distinguish authored guidance from inferred.

### "Why is this invalid?" — a fixed four-section popover

Every error badge — in the tree row, the Inspector and the Problems panel — opens the *same* popover
with the *same* four sections in the *same* order:

1. **What's wrong** — one plain sentence
2. **Where** — breadcrumb with clickable segments
3. **Why** — the rendered content model or Schematron assertion that was violated, offending part
   highlighted
4. **Fix it** — vertical list of code-action buttons, each stating its effect

A collapsed disclosure reveals the raw technical message. This last part matters: `cvc-complex-type.2.4.a:
Invalid content was found starting with element 'x'.` must be **available** for people who will paste
it into a search engine, but must **never** be the primary text.

Build `src/validation/messages/cvc-catalogue.ts` mapping every `cvc-*` code to a template with typed
slots (`found`, `expected[]`, `path`), plus `svrl-catalogue.ts` for Schematron. **RedHat lemminx's
code-action set is the best ready-made list of fix actions to mirror.**

### Form view — same model, no second state tree

Toggled per node (`Ctrl+Shift+E` or the row `⋯` menu). The subtree renders as a plain labelled form in
the centre panel while the tree stays in a narrow gutter for orientation.

| Model | Control |
|---|---|
| simple-content element | control chosen by base type; textarea when `maxLength > 120` |
| attribute | same, in a visually distinct **Settings** subsection so the element/attribute distinction is still taught |
| repeating element | repeatable field group with Add/Remove/drag, showing `2 of 1–10` |
| `xs:choice` | radio group or select that swaps the sub-form |
| nested complexType | collapsible fieldset with a legend |

Labels from `xs:documentation`'s first sentence or a humanised name; hint text is the rest; required is
an asterisk **plus the word "required"** in the accessible name.

**Do not introduce react-hook-form or a JSON-Schema form library.** The XML model is the single source
of truth and every control dispatches the same commands as the tree, or the project is spent
reconciling two states.

Mixed-content nodes are not form-renderable — show *"This element mixes text and elements — edit it in
the tree"* rather than a broken form.

### Visible undo history

The History tab lists commands newest-first with a current-position marker and a subtle rule showing
the redo tail. Labels are human sentences: *"Added `<item>` (3rd)"*, *"Changed @currency to EUR"*,
*"Deleted `<note>` and 4 children"*, *"Added 6 required elements"*. Clicking any entry time-travels and
focuses `affectedPath`.

**Undo must always move focus and scroll to the affected node.** Silent undo is disorienting and is a
top complaint about every editor in the prior art.

### Onboarding

**Empty workspace:** full-bleed centre, heading *"What are you working on?"*, four cards in a 2×2 grid:

- **Start from a schema** — marked *Recommended*, opens the wizard
- **Open a file** — whole-window drag-drop overlay accepting `.xml`/`.xsd`/`.sch`/`.zip`
- **Start from scratch** — blank document plus a persistent amber bar *"No schema attached — attach one
  to get guidance"*
- **Explore an example**

**Bundle exactly three examples, chosen deliberately:**

1. a small purchase order (single namespace — teaches the core loop)
2. a topic document with mixed content and two namespaces (teaches prefixes)
3. an invoice with Schematron rules where **one rule deliberately fails on open**, so the user sees
   error → explainer → quick fix → green within the first 60 seconds

**First-run coach marks:** at most four, sequential, dismissible, never modal, anchored to the Insert
button, the Inspector, the validity pill and the Problems panel. Gated on `onboarding.v1.seen`.
`Escape` dismisses all.

**Other empty states carry their weight too:** an empty Problems panel shows a green check and *"No
problems. This document matches purchase-order.xsd."*; an empty tree with a schema attached shows a
single ghost row *"+ Add root element: `<purchaseOrder>`"* so the very first action is one click.

### New-document wizard — five steps

1. **Choose the schema** — upload, URL, workspace library, or bundled catalogue
2. **Choose the root element** — from global element declarations, each row showing name and
   documentation; auto-advance if there is exactly one
3. **Choose fill level** — *Required only* (default) / *Required plus recommended* (adds optional
   elements that carry documentation, a decent proxy for importance) / *Everything* (with a node-count
   warning above ~200)
4. **(Optional, skippable)** short form collecting top-level required simple values, so the document is
   not born full of placeholders
5. **Land in the tree** with the first placeholder focused and its editor open

Every step is back-navigable and the whole wizard escapable to a blank-with-schema state. **Never trap
a user in a wizard they opened by accident.**

### Expert mode — chrome removal, never capability removal

| | Beginner | Expert |
|---|---|---|
| palette rows | two-line with descriptions | single-line |
| node-kind rows (comment/CDATA/PI) | collapsed under "More" | top level |
| validation code | behind a disclosure | inline in Problems |
| row density | 28px | 24px |
| ghost `+ Add` rows | shown | suppressed |
| breadcrumb | plain-English labels | XPath, click-to-copy |
| coach marks | yes | never |

**Nothing is removed in either direction** — an expert can still open the explainer, a beginner can
still reach the raw source. Ship the toggle from day one and make every new UI decision answer "which
side of the toggle?", or beginner scaffolding quietly accretes until the tool is slow for everyone.

## 7. Accessibility

**Use `role="tree"` with `aria-activedescendant`. Deliberately reject `role="treegrid"`.**

Treegrid looks right for multi-column rows, but its screen-reader support (particularly NVDA and JAWS
with dynamically-inserted rows) is inconsistent, and our rows have a *variable* number of cells —
attribute chips collapse to `+n` — which breaks the grid's column model.

- rows are `role="treeitem"` with `aria-expanded`, `aria-level`, `aria-setsize`, `aria-posinset`,
  `aria-selected`; child containers are `role="group"`
- **`aria-activedescendant` rather than roving tabindex is forced by virtualization**, which unmounts
  rows and would destroy DOM focus. Accept that VoiceOver handles activedescendant less well and
  compensate with an explicit polite live region
- per-row secondary content via `aria-describedby` → a visually-hidden summary: *"3 attributes: id
  equals 42, currency equals GBP. 1 error: missing required child title."*
- row actions open with `Shift+F10` or the context-menu key
- WCAG 2.2 SC 2.5.8: the twisty keeps a 24×24 hit area even at 24px row height

### Focus and announcements

| Event | Focus | Announcement |
|---|---|---|
| insert | the new node; open its editor if it has editable content or an unset required attribute | *"Added title inside book, 1 of 1. 1 required attribute still empty."* |
| delete | next sibling, else previous, else parent | *"Deleted note. Focus moved to price."* |
| undo/redo | scroll to `affectedPath` | the command label |
| validation completes | — | **the delta only**, never the absolute count on every keystroke: *"2 problems fixed, 1 remaining"* |

One `role="status" aria-live="polite" aria-atomic="true"` node at the app root, written through a
single `announce()` helper, debounced to at most one announcement per 1500ms so the region does not
become noise. `role="alert"` sparingly, for save-blocking errors only.

## 8. Visual design tokens

**Type** — Inter Variable (OFL-1.1) for UI, JetBrains Mono (OFL-1.1) for values, chips and source.
Sizes/line-heights: 11/16 micro chips · 12/16 secondary · **13/20 tree and body default** · 14/20 panel
body · 16/24 section title · 20/28 page title · 24/32 empty-state title. Tabular numerals on cardinality
chips.

**Spacing** — 4px base: 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48. Tree indent exactly 16px per level.

**Radii** — 4 chips/inputs · 6 buttons/rows · 8 cards/popovers · 12 dialogs.

**Colour** — two layers. Primitives from Radix Colors 12-step scales (slate, blue, red, amber, green,
violet) in OKLCH; then semantic aliases: `surface-0..3`, `border-subtle/default/strong`,
`text-primary/secondary/tertiary`, `accent = blue-9`, `error = red-9 on red-3`, `warning = amber-9 on
amber-3`, `ok = green-9`, `info = blue-9`. Dark mode uses matching Radix dark scales under **identical
alias names**, switched by `[data-theme]` on `<html>` with `prefers-color-scheme` as default,
implemented with Tailwind v4 `@theme` and `@custom-variant dark`.

**Density** — root `--row-h` of 32 / 28 / 24.

**Icons** — Lucide (ISC) at 16px, 1.5px stroke, plus **nine custom 16px glyphs** for XML semantics
Lucide lacks: element, attribute, text, comment, CDATA, PI, sequence, choice, all.

**Motion** — 120ms ease-out hover/press · 160ms popover (opacity + 0.98→1 scale) · 200ms
`cubic-bezier(0.2,0,0,1)` panel resize. **Do not height-animate tree expand/collapse** — animate only
the twisty's 90° rotation, because height animation on a virtualized list janks badly. Respect
`prefers-reduced-motion` by dropping transforms and keeping opacity. Support `forced-colors` with
system colours for selection and focus rings.

## 9. Mode differences

### XSD authoring

The tree renders with schema semantics: an `xs:element` row leads with `@name`, shows `@type` as a
chip, and renders `minOccurs`/`maxOccurs` as **one editable `0..∞` cardinality control** rather than two
attributes buried in a list.

Inspector gains a **Facets** section (enumeration list editor, pattern with a live "test a value"
box, min/max inclusive/exclusive, length constraints), and its documentation card becomes **editable** —
writing `xs:documentation` is the highest-leverage thing an XSD author can do for downstream users of
this very editor, so nudge it.

Palette groups: Structure (sequence, choice, all, group ref) · Declarations · Types · Documentation.

Right panel gains a **Diagram** tab (Liquid-Studio-style content-model boxes: dashed border for
optional, compositor icons, `0..∞` labels) — read-only, click-to-select-in-tree, **deferred to Phase 6**
since beginners cannot read that notation anyway.

Two beginner-critical extras: a **"Used by"** back-reference list on every global type/element, and
**"Preview instance"**, generating a sample document and opening it in a second tab.

### Schematron authoring

The document is shallow, so the Inspector swaps its attributes-first layout for an **XPath editor** on
CodeMirror 6, with bracket matching and namespace-aware completion from `sch:ns` declarations.

Beside it, bound live to a sample instance in another tab: *"this context matches 14 nodes"* updating as
you type, a Test now button, and clickable pass/fail lists. See
[`validation.md` §3.5](validation.md#35-live-rule-testing--the-killer-beginner-feature).

Further Inspector sections: Namespaces table · Message editor with a button to insert
`<sch:value-of select="…"/>` tokens · Role/severity picker · Diagnostics linker.

Palette groups: Patterns · Rules · Assertions & Reports · Variables (`sch:let`) · Phases · Diagnostics ·
Namespaces.

Pleasing reuse: **Schematron is itself defined by a schema**, so the same content-model engine drives
this palette with no special-casing.

## 10. Prior art

### Steal, precisely

| Source | What |
|---|---|
| **Altova XMLSpy** Grid View | collapse of repeated sibling elements with identical simple children into a **spreadsheet-style table**. For a 200-line-item invoice this is transformative and no web XML editor does it. Add as a per-node "View as table" toggle |
| **XMLmind XXE** | its insert model — separate, always-visible Insert Before / Insert / Insert After lists containing *only* legal items. The best prior art for the mandated insert affordance; our segmented Before\|Inside\|After header is a direct descendant |
| **Oxygen XML Author** | the content-completion window showing `xs:documentation` in a side pane as you arrow through candidates (= our preview pane); the Attributes table that bolds required attributes; "learn document structure" for schema-less files |
| **RedHat lemminx / VS Code XML** | its code-action catalogue **verbatim** as the quick-fix list; its schema-association UX as the Attach Schema flow |
| **Liquid Studio** | the XSD content-model diagram vocabulary |
| **Emacs nxml-mode** | incremental validation with a next-error binding (our `F8`), and the principle that validation runs continuously, **never on a Validate button** |
| **Chrome DevTools Elements** | badge chips, bottom breadcrumb, `Ctrl+F` with match counts, and the "Edit as HTML" escape hatch (our `Ctrl+E`) |
| **Notion** | the `/` slash menu as the second insert binding, and the ghost empty-line affordance |
| **Linear** | `Ctrl+K` command palette, always-visible footer key hints |
| **Sanity Studio** | array "Add item" menus carrying icons plus one-line descriptions |

### Avoid, and why

- **Oxygen's mode dichotomy** (Text / Author / Grid as separate, differently-capable modes) — users get
  stranded in a mode that cannot do the thing they want. Our Tree/Form/Source are **views over one
  model with identical capability**, not modes.
- **Oxygen's CSS-driven Author mode as the primary view** — it needs a hand-written CSS framework per
  schema and simply cannot work for an arbitrary uploaded XSD.
- **XMLSpy's three stacked "entry helper" panes** presented as bare unexplained lists — that is the
  anti-pattern this entire product exists to fix. One contextual palette with descriptions replaces all
  three.
- **Stylus Studio's and XMLSpy's modal-dialog-heavy flows** — everything here is inline or a dismissible
  popover.
- Surfacing raw `cvc-*` strings as primary text anywhere.
- **A right-hand inspector**, however conventional (Figma, Xcode and Sanity all put it right) — the
  brief mandates left, and consistency with the mandate beats convention.
- `role="treegrid"`. Animating tree expand/collapse height. Infinite-nesting breadcrumbs.

## 11. Performance constraints that shape the UI

Assume 50k-node documents. Windowing via TanStack Virtual is mandatory, which **forces three design
consequences** worth stating explicitly:

1. **Rows must be fixed-height per density** — no auto-measured rows, so the inline text preview
   truncates rather than wraps.
2. **Focus must use `aria-activedescendant`** rather than DOM focus (§7).
3. **"Expand all" must be guarded** with a confirm above ~5,000 newly-visible nodes.

Two more:

- The Inspector must not synchronously recompute the content model on every arrow-key press — debounce
  selection→inspector at 60ms and render a skeleton in the interim, or held arrow keys stutter.
- The Insert palette's candidate computation must be **memoised per `(parent type, position)`**, or it
  recomputes on every keystroke of the filter.

Validation runs in a worker with results diffed into the model **by node id**, so the tree re-renders
only changed rows.
