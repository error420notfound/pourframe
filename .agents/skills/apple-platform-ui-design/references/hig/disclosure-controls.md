<!--
{
  "documentType" : "article",
  "framework" : "Human Interface Guidelines",
  "identifier" : "/design/Human-Interface-Guidelines/disclosure-controls",
  "metadataVersion" : "0.1.0",
  "role" : "article",
  "title" : "Disclosure controls"
}
-->

# Disclosure controls

Disclosure controls reveal and hide information and functionality related to specific controls or views.

## Discussion

![A stylized representation of collapsed and expanded disclosure buttons. The image is tinted red to subtly reflect the red in the original six-color Apple logo.](images/com.apple.HIG/components-disclosure-control-intro@2x.png)

## Best practices

**Use a disclosure control to hide details until they’re relevant.** Place controls that people are most likely to use at the top of the disclosure hierarchy so they’re always visible, with more advanced functionality hidden by default. This organization helps people quickly find the most essential information without overwhelming them with too many detailed options.

## Disclosure triangles

A disclosure triangle shows and hides information and functionality associated with a view or a list of items. For example, Keynote uses a disclosure triangle to show advanced options when exporting a presentation, and the Finder uses disclosure triangles to progressively reveal hierarchy when navigating a folder structure in list view.

**Collapsed:**

![An illustration of three folders in a Finder list view. The folders are collapsed, with disclosure triangles on their leading edges pointing inward to indicate that they can be expanded to reveal their contents.](images/com.apple.HIG/disclosure-triangle-before@2x.png)

**Expanded:**

![An illustration of three folders in a Finder list view. The first and third folders are collapsed, with disclosure triangles on their leading edges pointing inward to indicate that they can be expanded to reveal their contents. The second folder is expanded, with its disclosure triangle pointing down, revealing three subfolders inside.](images/com.apple.HIG/disclosure-triangle-after~dark@2x.png)

A disclosure triangle points inward from the leading edge when its content is hidden and down when its content is visible. Clicking or tapping the disclosure triangle switches between these two states, and the view expands or collapses accordingly to accommodate the content.

**Provide a descriptive label when using a disclosure triangle.** Make sure your labels indicate what is disclosed or hidden, like “Advanced Options.”

For developer guidance, see <doc://com.apple.documentation/documentation/AppKit/NSButton/BezelStyle-swift.enum/disclosure>.

## Disclosure buttons

A disclosure button shows and hides functionality associated with a specific control. For example, the macOS Save sheet shows a disclosure button next to the Save As text field. When people click or tap this button, the Save dialog expands to give advanced navigation options for selecting an output location for their document.

A disclosure button points down when its content is hidden and up when its content is visible. Clicking or tapping the disclosure button switches between these two states, and the view expands or collapses accordingly to accommodate the content.

**Collapsed:**

![A screenshot of a collapsed save dialog in macOS. The dialog includes a closed disclosure button that expands the dialog to reveal additional options.](images/com.apple.HIG/disclosure-button-before@2x.png)

**Expanded:**

![A screenshot of an expanded save dialog in macOS. The dialog includes an open disclosure button that collapses the dialog to hide some options.](images/com.apple.HIG/disclosure-button-after~dark@2x.png)

**Place a disclosure button near the content that it shows and hides.** Establish a clear relationship between the control and the expanded choices that appear when a person clicks or taps a button.

**Use no more than one disclosure button in a single view.** Multiple disclosure buttons add complexity and can be confusing.

For developer guidance, see <doc://com.apple.documentation/documentation/AppKit/NSButton/BezelStyle-swift.enum/pushDisclosure>.

## Platform considerations

*No additional considerations for macOS. Not supported in tvOS or watchOS.*

### iOS, iPadOS, visionOS

Disclosure controls are available in iOS, iPadOS, and visionOS with the SwiftUI <doc://com.apple.documentation/documentation/SwiftUI/DisclosureGroup> view.

## Resources

#### Related

[Outline views](/design/Human-Interface-Guidelines/outline-views)

[Lists and tables](/design/Human-Interface-Guidelines/lists-and-tables)

[Buttons](/design/Human-Interface-Guidelines/buttons)

#### Developer documentation

<doc://com.apple.documentation/documentation/SwiftUI/DisclosureGroup> — SwiftUI

<doc://com.apple.documentation/documentation/AppKit/NSButton/BezelStyle-swift.enum/disclosure> — AppKit

<doc://com.apple.documentation/documentation/AppKit/NSButton/BezelStyle-swift.enum/pushDisclosure> — AppKit

#### Videos

  <doc://com.apple.documentation/videos/play/wwdc2020/10031>



---

Copyright &copy; 2026 Apple Inc. All rights reserved. | [Terms of Use](https://www.apple.com/legal/internet-services/terms/site.html) | [Privacy Policy](https://www.apple.com/privacy/privacy-policy)