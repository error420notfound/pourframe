# Adaptive Layout Reference Map

Use the smallest relevant bundle. The files in `hig/` are the supplied Apple Human Interface Guidelines snapshot.

## Required foundation

For every task, read:

- The relevant platform guide: [iOS](hig/designing-for-ios.md), [iPadOS](hig/designing-for-ipados.md), [macOS](hig/designing-for-macos.md), or [iPhone Duo](hig/designing-for-iphone-duo.md)
- [Layout](hig/layout.md)

For concepts, audits, or specifications that change interaction or visibility, also read [Accessibility](hig/accessibility.md). Read [Design principles](hig/design-principles.md) when evaluating higher-level trade-offs.

## Windowing and spatial composition

- Window and orientation behavior: [Windows](hig/windows.md), [Going full screen](hig/going-full-screen.md), [Multitasking](hig/multitasking.md)
- Multiple panes: [Split views](hig/split-views.md), [Sidebars](hig/sidebars.md), [Column views](hig/column-views.md), [Outline views](hig/outline-views.md)
- Structured content: [Collections](hig/collections.md), [Lists and tables](hig/lists-and-tables.md), [Scroll views](hig/scroll-views.md)
- Directional adaptation: [Right to left](hig/right-to-left.md)

## Navigation and command adaptation

- Navigation transformations: [Tab bars](hig/tab-bars.md), [Tab views](hig/tab-views.md), [Sidebars](hig/sidebars.md), [Toolbars](hig/toolbars.md)
- Commands: [Menus](hig/menus.md), [Context menus](hig/context-menus.md), [Buttons](hig/buttons.md), [Controls](hig/controls.md)
- Search placement: [Search fields](hig/search-fields.md)
- Transient surfaces: [Modality](hig/modality.md), [Sheets](hig/sheets.md), [Popovers](hig/popovers.md)

## Input and occlusion

- Touch forms and keyboard-up layouts: [Entering data](hig/entering-data.md), [Text fields](hig/text-fields.md), [Virtual keyboards](hig/virtual-keyboards.md), [Scroll views](hig/scroll-views.md)
- Hardware keyboard and focus: [Keyboards](hig/keyboards.md), [Focus and selection](hig/focus-and-selection.md)
- Pointer and contextual action: [Pointing devices](hig/pointing-devices.md), [Context menus](hig/context-menus.md)
- Pencil and direct manipulation: [Apple Pencil and Scribble](hig/apple-pencil-and-scribble.md), [Drag and drop](hig/drag-and-drop.md)
- System regions: [Status bars](hig/status-bars.md)

## Content resilience

- Text scaling and label length: [Typography](hig/typography.md), [Writing](hig/writing.md)
- Motion between states: [Motion](hig/motion.md)
- Feedback through transformations: [Feedback](hig/feedback.md)
- Dense data surfaces: [Charts](hig/charts.md)

## Task bundles

| Task | Add these references to the required foundation |
| --- | --- |
| iPhone form with keyboard open | Entering data, text fields, virtual keyboards, scroll views, typography |
| Phone portrait to landscape | Scroll views, navigation component in use, typography, status bars |
| iPad full-screen and split view | Multitasking, windows, sidebars, split views, toolbars, popovers |
| iPad with keyboard and pointer | Keyboards, pointing devices, focus and selection, context menus |
| iPad workspace with Pencil | Apple Pencil and Scribble, drag and drop, focus and selection |
| Mac window resizing | Windows, toolbars, menus, sidebars or split views, keyboards, pointing devices |
| iPhone Duo poses | iPhone Duo, relevant navigation and content components, motion |
| Navigation transformation | Tab bars, sidebars, split views, toolbars, state-preserving navigation |
| Adaptive dashboard | Collections or lists, split views, charts, scroll views, feedback |
| Web or PWA adaptation | iOS or iPadOS, layout, virtual keyboards, keyboards, pointing devices, accessibility; translate to web semantics |
