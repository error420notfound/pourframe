---
name: apple-adaptive-layouts
description: Design, adapt, critique, and specify Apple-platform interfaces across device sizes, orientations, windows, multitasking states, keyboards, pointers, and iPhone Duo poses. Use when layout behavior must change across iPhone, iPad, or Mac contexts; do not use for general Apple visual styling without an adaptation problem.
---

# Apple Adaptive Layouts

Treat adaptation as a product-behavior problem, not a collection of resized screenshots. Preserve task continuity while changing hierarchy, navigation, density, and simultaneous visibility to fit the available space and input context.

## Establish the adaptation space

Determine or infer:

- Delivery surface: native app, website, PWA, or concept exploration
- Platforms and device classes in scope
- Portrait, landscape, windowed, full-screen, split-view, and iPhone Duo pose states that matter
- Minimum and maximum usable viewport, including safe areas and system chrome
- Touch, pointer, hardware keyboard, virtual keyboard, Pencil, and accessibility input
- Content priority, persistent task state, and information that can appear simultaneously

Read [references/reference-map.md](references/reference-map.md), then load only the routed HIG sources. Always read the target-platform guide and layout reference. Add accessibility for any concept, critique, or specification that changes interaction or content visibility.

## Define invariants before variants

Identify what must remain stable across contexts:

- The user's current task, selection, draft data, and navigation position
- The primary action and essential status
- Meaning and ordering of information
- Accessible names, focus logic, and recoverability

Then define what may adapt:

- Reflow, wrapping, alignment, and content density
- Number and proportion of panes or columns
- Navigation form, such as tab bar, sidebar, split view, or toolbar
- Persistent versus transient presentation
- Visibility and placement of secondary actions
- Pointer, keyboard, hover, focus, and drag-and-drop affordances

Do not assume that a larger canvas should merely enlarge components. Use added space to improve simultaneous visibility, comparison, context, and task efficiency. Do not remove essential capability in compact layouts; reprioritize or progressively disclose it.

## Model transformations explicitly

For each meaningful context, specify:

1. Available region and occlusions
2. Navigation structure
3. Content hierarchy and pane composition
4. Primary and secondary action placement
5. Modal or transient surface behavior
6. Scrolling, focus, selection, and state persistence
7. Active input methods

Prefer continuous reflow when structure remains understandable. Introduce a discrete layout transformation when a different navigation or pane model materially improves the task. Base transitions on usable space and content needs; avoid treating a named device model as the only breakpoint.

## Platform-specific concerns

### iPhone and virtual keyboard

Keep the focused control and relevant validation visible. Define how content scrolls, whether the primary action remains reachable, how the keyboard is dismissed, and what happens when suggestions or autocomplete appear. Avoid layouts that depend on the unobscured full-screen height.

### iPad

Design for compact and expansive windows, not only full-screen landscape. Account for multitasking, resizable windows, sidebars, split views, hardware keyboards, pointers, Pencil, and transitions between these states. Preserve selection and working context as panes appear, collapse, or become transient.

### Mac

Support resizable windows, menu and toolbar conventions, precise pointer input, keyboard navigation, focus, multi-selection, and appropriate content density. Do not stretch an iPad layout across a desktop window without reconsidering structure and command access.

### iPhone Duo

Read the Duo guide whenever the device is in scope. Define behavior for relevant poses, reserved or obscured regions, arrangement changes, and transitions between single-region and dual-region compositions. Keep interactive controls out of compromised regions and avoid splitting a single critical control or sentence across a boundary.

### Web and PWA

Translate HIG intent into responsive web behavior. Preserve semantic HTML, browser navigation, zoom, dynamic viewport changes, keyboard access, focus visibility, and cross-platform compatibility. Do not map Apple size classes directly to CSS breakpoints without validating actual content behavior.

## Output modes

### Adaptive layout specification

Provide an adaptation matrix with one row per meaningful context and these fields when applicable:

| Context | Navigation | Pane/content structure | Primary action | Transient surfaces | Input and focus | State continuity |
| --- | --- | --- | --- | --- | --- | --- |

Follow the matrix with the governing invariants, transformation rules, edge states, and unresolved implementation dependencies.

### Design critique

Evaluate whether the design preserves task continuity, hierarchy, readability, reachable actions, safe-area handling, keyboard behavior, focus, and efficient use of expanded space. Separate HIG misalignment from product-specific trade-offs and implementation limitations.

### Visual concept or image generation

Specify the exact device class, orientation, window state, input context, and interaction state shown. For a comparison image, keep content and product styling consistent between frames so the adaptation is legible. Label contexts clearly and avoid decorative device mockups unless requested.

A static image cannot demonstrate transitions or state persistence. Accompany it with a concise behavior description when those qualities are central to the concept.

### Implementation handoff

Describe the layout rules, content priorities, pane transformations, overflow behavior, safe-area treatment, focus order, keyboard response, pointer behavior, and state preservation. Distinguish native platform behavior from web implementation requirements and avoid inventing unavailable APIs.

## Quality bar

- The same task remains coherent through every transition.
- Compact layouts preserve essential capability and expanded layouts use space productively.
- Navigation changes do not erase the user's location or selection.
- Keyboard, pointer, touch, and accessibility input are first-class layout conditions.
- Recommendations describe rules and transitions, not only endpoint screenshots.
- Cite the local HIG filename when a precise platform claim materially drives the recommendation.
