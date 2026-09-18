---
name: apple-ui-concept-art-direction
description: Develop, critique, and generate art direction for credible Apple-platform UI concept images using product context and Apple Human Interface Guidelines. Use for visual UI explorations, design directions, screen mockups, or image-generation briefs; do not use for implementation-only work or generic Apple-style decoration.
---

# Apple UI Concept Art Direction

Turn product intent into a visually convincing interface concept. Use HIG to establish platform grammar and interaction credibility, then express the product's own brand and priorities through hierarchy, typography, colour, imagery, material, and motion cues.

## Establish the concept brief

Determine or infer:

- Product, audience, primary task, and business objective
- Platform, device class, orientation, viewport, and delivery surface
- Exact screen or interaction state to depict
- Content that must be visible and the primary action
- Existing brand assets, design system, or visual references
- Desired fidelity: structural direction, polished concept, or presentation-ready hero
- Output form: single screen, comparison, flow, annotated concept, or device-context mockup

Read [references/reference-map.md](references/reference-map.md), then load only the routed HIG files. For any new visual direction, include the target-platform guide, design principles, layout, accessibility, typography, and colour. Add component and system-surface references only for elements visible in the concept.

Ask a question only when a missing choice would materially change the concept. Otherwise make a defensible assumption and state it briefly.

## Direct the concept in layers

Make decisions in this order:

1. Product task and information priority
2. Platform behavior and component grammar
3. Spatial hierarchy and content density
4. Brand expression and emotional tone
5. Surface treatment, imagery, and polish

Do not begin with visual effects. A polished concept must still explain what the product is, what state it is in, and what the user can do next.

When the brief lacks a visual stance, default to quiet, precise, restrained art direction: strong hierarchy, generous but purposeful spacing, controlled colour, credible content, and material effects used only when they reinforce structure. Yield to explicit project or brand direction.

## Preserve product identity

Apple conventions should make the interface feel natural on the target platform, not make every product resemble a system app. Keep familiar controls recognizable while allowing the product to own its typography, palette, imagery, data language, and composition.

Avoid generic signals of “premium technology” such as excessive glass, neon gradients, floating cards, empty whitespace, ornamental charts, or oversized type when they do not serve the task. Do not copy Apple marketing artwork or imply official Apple authorship.

For websites and PWAs, translate HIG intent without fabricating native chrome or unavailable system behavior. Keep browser and responsive-web realities visible where relevant.

## Compose a generation-ready visual specification

When generating or commissioning an image, read [references/image-brief-template.md](references/image-brief-template.md) and resolve every section relevant to the requested frame.

Specify:

- Canvas dimensions or aspect ratio, device class, orientation, and crop
- Whether the image shows a raw viewport, physical device, or environmental scene
- Screen state, selected items, focus, keyboard, pointer, sheet, popover, or notification
- Navigation, major regions, component placement, and visual hierarchy
- Realistic interface copy and plausible product data
- Typography character, colour roles, contrast, material, iconography, imagery, and depth
- System chrome, safe areas, and platform-specific details that must appear
- Elements and visual clichés to exclude

Use one coherent interaction state per frame unless the user asks for a sequence or comparison. For comparisons, hold content, brand, and fidelity constant so the intended design difference is legible.

## Image-generation discipline

- Describe the interface as a designed system, not a list of disconnected objects.
- Use concise, meaningful labels; minimize tiny text that an image model cannot render reliably.
- Avoid invented operating-system controls, contradictory navigation models, impossible geometry, and decorative data.
- Do not place the interface in a device mockup unless context, scale, or hardware relationship matters.
- If a reference image is supplied, identify what should remain, what should change, and what must not be copied.
- If multiple directions are requested, vary a clear design axis such as density, hierarchy, materiality, navigation, or brand expression rather than producing arbitrary stylistic variations.

After generation, inspect the result against the brief. When the hierarchy, device context, interaction state, or critical content is materially wrong and image editing is available, make a targeted correction before presenting it. Do not repeatedly regenerate for minor text artifacts that do not affect the design judgment.

## Output modes

### Art-direction proposal

Describe the design idea, hierarchy, composition, visual system, platform relationship, and deliberate departures. Include enough specificity that another designer or image model could reproduce the direction.

### Generated UI concept

Create the visual specification, generate the image using the available image tool, inspect it, and present it as a concept rather than an implementation guarantee. Add only the behavior notes needed to understand interactions that a static frame cannot show.

### Concept critique

Evaluate task clarity, hierarchy, platform credibility, brand distinctiveness, component coherence, accessibility, content plausibility, and production feasibility. Separate structural issues from stylistic preferences.

### Directional alternatives

Name each direction by its governing idea and state what changes and what remains fixed. Prefer two or three meaningfully different directions over many shallow variants.

## Quality bar

- The product purpose and primary action are understandable immediately.
- The screen depicts a plausible state with credible content.
- HIG alignment supports usability without flattening brand identity.
- Visual effects reinforce hierarchy and interaction rather than substituting for them.
- Accessibility affects contrast, scale, focus, motion, and component choices.
- The concept can be translated into a real design system and implementation.
- Cite the local HIG filename when a precise guideline materially determines the concept.
