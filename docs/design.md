# Interface design: tokens, layout and motion

How the interface is styled and animated, after the redesign in issue #80. Styles are plain CSS next to each feature (`src/features/*/*.css`); every value comes from the tokens in [`src/app/globals.css`](../src/app/globals.css), so the light and dark themes switch together.

## Tokens

| Group | Tokens | Rule |
| --- | --- | --- |
| Colour | `--bg`, `--surface`, `--surface-2/3`, `--line`, `--ink`, `--ink-2/3`, `--accent*`, `--status-*`, `--chart-*`, `--priority-*`, `--type-*`, `--danger*`, `--success`, `--project-teal` | No hex values outside `globals.css`. Each token has a dark value; text pairs keep 4.5:1 and chart marks 3:1 in both themes. |
| Type | `--font-sans`, `--font-mono`; `--text-2xs` (11px) to `--text-display`; `--weight-regular/medium/semibold/bold` (400/500/600/700) | One sans and one mono family, four weights. Inputs stay at 16px on phones so iOS doesn't zoom. |
| Space | `--space-1` (4px) to `--space-12` (48px) | Margins, padding and gaps sit on a 4px grid. 1px, 2px, 6px and 10px remain only as optical half-steps inside chips and small controls. |
| Shape | `--radius-sm/–/lg/full` | |
| Motion | `--ease-out`, `--ease-in-out`, `--ease-drawer`; `--dur-press` (140ms), `--dur-fast` (160ms), `--dur-base` (220ms) | |

Before the redesign the CSS had five font weights (including 550 and 650), five raw font sizes, a raw hex colour and spacing values such as 3, 5, 7, 9, 14, 18, 22, 34 and 38px. All now use the tokens above.

## Layout: the project toolbar

The toolbar above the board, list, backlog and insights has two rows:

1. **What you're looking at**: the view switcher (Board, List, Backlog, Insights), then *All tasks / Active sprint* when a sprint is running.
2. **How it's filtered**: search, then one row of compact selects sized to their labels, then the result count. A select with a value is tinted with the accent, so active filters stand out.

On a phone the view switcher spans the width with its four buttons sharing it, and the selects scroll sideways in one row that runs to the screen edges, so each keeps its full label (they were squeezed to "An…" before). *My tasks* uses the same layout. The quick-add hint under the task input is a quiet line of syntax rather than a row of key caps.

Smaller fixes: panel titles with an icon (*Sprint report*) keep the icon on the title's line, as *Delivery forecast* did; and in the task sheet, an epic's item list truncates long titles instead of pushing the sheet wider than a phone screen.

## Motion

| Where | What | Duration |
| --- | --- | --- |
| Project views, *My tasks* | Content rises 6px into place when it loads or the view changes | 220ms, ease-out |
| Task sheet | Slides in from the side (a bottom sheet on phones); its Comments/Activity panel rises in when switched | 300ms / 220ms |
| Board cards | Press scales to 0.98; hover shows a border; a dragged card tilts and lifts | 140–160ms |
| Buttons, toggles, rows | Colour and background transitions | 160ms |

Rules:

- **Movement uses `transform`**, never layout properties such as width, height or top, so animation never triggers layout. Entrance animations move but don't fade: nothing is drawn at partial opacity, which an accessibility scan taken mid-animation would report as low contrast.
- **300ms or less**, with strong ease-out curves, so nothing delays the next action.
- **Reduced motion is respected**: with `prefers-reduced-motion: reduce`, a global rule in `globals.css` cuts animations to nothing and limits transitions to colour and opacity; the drag tilt and chart growth are switched off explicitly.
- No looping animation except loading indicators.

## Checks

- [`e2e/accessibility.spec.js`](../e2e/accessibility.spec.js) runs axe (WCAG 2.1 A/AA) and a horizontal-overflow check at 390, 768 and 1280px, now including every project view and the task sheet in both the light and dark themes.
- Before-and-after screenshots and page timings: see [performance-evidence.md](performance-evidence.md#interface-redesign-issue-80).
