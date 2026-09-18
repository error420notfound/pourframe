---
name: apple-platform-ui-design
description: Design, adapt, critique, and specify interfaces for iPhone, iPad, iPhone Duo, and Mac using Apple Human Interface Guidelines. Use for native Apple-platform products and for web or PWA experiences where Apple-device behavior materially affects the design; do not use merely to imitate Apple's visual style.
---

# Apple Platform UI Design

Use Apple HIG as an interaction and platform-behavior reference, not as a substitute for product reasoning or brand direction.

## Start with the design context

Establish the following from the request or available artifacts. Infer low-risk details when reasonable and state consequential assumptions.

- Product objective and primary user task
- Target platform: iOS, iPadOS, macOS, iPhone Duo, or a combination
- Delivery surface: native app, responsive website, installed PWA, or concept-only exploration
- Device class, orientation, window size, and expected input methods
- Important operating conditions such as keyboard visibility, split view, offline use, live data, permissions, or time pressure

Read [references/reference-map.md](references/reference-map.md), then load only the HIG references it routes to. For broad design or critique work, always include the target-platform guide plus design principles, layout, and accessibility. For a narrow component question, load the target-platform guide and only the relevant pattern or component references.

## Make decisions in this order

1. Protect the user's task, comprehension, agency, privacy, and accessibility.
2. Follow the target platform's established behavior and interaction model.
3. Adapt the information architecture to the available space and input mode.
4. Express the product's brand through typography, colour, imagery, motion, and material choices without disguising familiar controls or weakening hierarchy.

Do not treat a larger screen as a scaled-up phone. Recompose hierarchy, navigation, density, simultaneous visibility, and input affordances for iPad and Mac. For iPhone Duo, account for poses, reserved regions, split arrangements, and transitions between configurations.

## Native, web, and PWA boundary

For native products, use platform conventions directly when they fit the task.

For websites and PWAs, translate the intent of HIG rather than copying native chrome. Preserve semantic HTML, browser behavior, responsive layout, keyboard access, web accessibility, URL/navigation expectations, and cross-platform compatibility. Never imply that a web surface can use a native API or system behavior unless the implementation supports it.

When a recommendation differs between native and web delivery, state both options and identify the recommended one for the actual surface.

## Design the experience, not only the resting screen

Cover the states that materially affect the flow, including relevant loading, empty, error, disabled, success, offline, permission, keyboard-up, compact-window, and interruption states. Define what changes when the device rotates, resizes, enters split view, attaches a keyboard or pointer, or moves between iPhone Duo poses.

Prefer familiar controls, progressive disclosure, direct manipulation, clear feedback, and reversible actions. If a nonstandard interaction provides real product value, explain the benefit, discoverability mechanism, accessibility behavior, and fallback.

## Output modes

### New concept or redesign

Provide the platform assumptions, task flow, information hierarchy, layout model, controls, key states, adaptive behavior, and accessibility considerations. Tie major choices to the relevant HIG guidance without turning the response into a checklist.

### Critique or audit

Separate findings into:

- HIG alignment
- Deliberate product or brand departure
- Usability or accessibility risk
- Delivery-specific constraint

Prioritize findings by impact on task completion and comprehension. Do not flag stylistic difference as a violation when behavior remains clear and accessible.

### Visual concept or image generation

Before generating an image, convert the product brief and relevant HIG guidance into a concrete visual specification:

- Exact device class, orientation, viewport, and crop
- User scenario and interaction state shown
- Navigation model and content hierarchy
- Visible system chrome and safe-area treatment
- Components, labels, controls, and selection states
- Keyboard, pointer, split-view, or iPhone Duo pose when relevant
- Typography, colour, material, imagery, and brand expression
- Plausible concise interface copy; avoid gibberish and decorative data

Generate one coherent state per frame unless the user asks for a flow or comparison. Present concept imagery as a design proposal, not proof of technical feasibility. When useful, accompany it with a short behavior note for interactions that a static image cannot show.

### Implementation specification

Describe component semantics, content rules, interaction states, adaptive breakpoints or layout transitions, focus behavior, keyboard behavior, and accessibility expectations. Distinguish HIG guidance from product-specific decisions and avoid inventing unavailable APIs.

## Quality bar

- The primary action and information hierarchy should be understandable immediately.
- Platform conventions should feel natural without making every product look like a stock Apple app.
- Brand expression should be restrained, coherent, and subordinate to interaction clarity.
- Accessibility and adaptive behavior must affect the concept itself, not appear as an afterthought.
- Recommendations must acknowledge implementation constraints and meaningful trade-offs.
- Cite the local HIG filename when a precise rule or platform-specific claim materially drives the decision.
