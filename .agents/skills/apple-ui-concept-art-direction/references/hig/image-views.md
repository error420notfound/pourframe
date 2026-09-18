<!--
{
  "documentType" : "article",
  "framework" : "Human Interface Guidelines",
  "identifier" : "/design/Human-Interface-Guidelines/image-views",
  "metadataVersion" : "0.1.0",
  "role" : "article",
  "title" : "Image views"
}
-->

# Image views

An image view displays a single image — or in some cases, an animated sequence of images — on a transparent or opaque background.

## Discussion

![A stylized representation of a photo. The image is tinted red to subtly reflect the red in the original six-color Apple logo.](images/com.apple.HIG/components-image-view-intro~dark@2x.png)

Within an image view, you can stretch, scale, size to fit, or pin the image to a specific location. Image views are typically not interactive.

## Best practices

**Use an image view when the primary purpose of the view is simply to display an image.** In rare cases where you might want an image to be interactive, configure a system-provided [button](https://developer.apple.com/design/human-interface-guidelines/buttons) to display the image instead of adding button behaviors to an image view.

**If you want to display an icon in your interface, consider using a symbol or interface icon instead of an image view.** [SF Symbols](/design/Human-Interface-Guidelines/sf-symbols) provides a large library of streamlined, vector-based images that you can render with various colors and opacities. An [icon](https://developer.apple.com/design/human-interface-guidelines/icons) (also called a glyph or template image) is typically a bitmap image in which the nontransparent pixels can receive color. Both symbols and interface icons can use the accent colors people choose.

## Content

An image view can contain rich image data in various formats, like PNG, JPEG, and PDF. For more guidance, see [Images](/design/Human-Interface-Guidelines/images).

**Take care when overlaying text on images.** Compositing text on top of images can decrease both the clarity of the image and the legibility of the text. To help improve the results, ensure the text contrasts well with the image, and consider ways to make the text object stand out, like adding a text shadow or background layer.

**Aim to use a consistent size for all images in an animated sequence.** When you prescale images to fit the view, the system doesn’t have to perform any scaling. In cases where the system must do the scaling, performance is generally better when all images are the same size and shape.

## Platform considerations

*No additional considerations for iOS or iPadOS.*

### macOS

**If your app needs an editable image view, use an image well.** An [image well](https://developer.apple.com/design/human-interface-guidelines/image-wells) is an image view that supports copying, pasting, dragging, and using the Delete key to clear its content.

**Use an image button instead of an image view to make a clickable image.** An [image button](https://developer.apple.com/design/human-interface-guidelines/buttons#Image-buttons) contains an image or icon, appears in a view, and initiates an instantaneous app-specific action.

### tvOS

Many tvOS images combine multiple layers with transparency to create a feeling of depth. For guidance, see [Layered images](/design/Human-Interface-Guidelines/images#Layered-images).

### visionOS

Windows in visionOS apps and games can use image views to display 2D and stereoscopic images, as well as spatial photos. If your app uses RealityKit, you can also display images of any type outside of image views next to 3D content, or generate a spatial scene from an existing 2D image. For design guidance, see [Images > visionOS](/design/Human-Interface-Guidelines/images#visionOS); for developer guidance, see <doc://com.apple.documentation/documentation/RealityKit/ImagePresentationComponent>.

For guidance on presenting other 3D content in a window or volume, see [Windows > visionOS](/design/Human-Interface-Guidelines/windows#visionOS).

### watchOS

**Use SwiftUI to create animations when possible.** Alternatively, you can use WatchKit to animate a sequence of images within an image element if necessary. For developer guidance, see <doc://com.apple.documentation/documentation/WatchKit/WKImageAnimatable>.

## Resources

#### Related

[Images](/design/Human-Interface-Guidelines/images)

[Image wells](/design/Human-Interface-Guidelines/image-wells)

[Image buttons](/design/Human-Interface-Guidelines/buttons#Image-buttons)

[SF Symbols](/design/Human-Interface-Guidelines/sf-symbols)

#### Developer documentation

<doc://com.apple.documentation/documentation/SwiftUI/Image> — SwiftUI

<doc://com.apple.documentation/documentation/UIKit/UIImageView> — UIKit

<doc://com.apple.documentation/documentation/AppKit/NSImageView> — AppKit

#### Videos

  <doc://com.apple.documentation/videos/play/wwdc2023/10181>

  <doc://com.apple.documentation/videos/play/wwdc2021/10021>

## Change log

|Date         |Changes                                  |
|-------------|-----------------------------------------|
|June 21, 2023|Updated to include guidance for visionOS.|

---

Copyright &copy; 2026 Apple Inc. All rights reserved. | [Terms of Use](https://www.apple.com/legal/internet-services/terms/site.html) | [Privacy Policy](https://www.apple.com/privacy/privacy-policy)