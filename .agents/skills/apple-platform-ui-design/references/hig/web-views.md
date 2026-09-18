<!--
{
  "documentType" : "article",
  "framework" : "Human Interface Guidelines",
  "identifier" : "/design/Human-Interface-Guidelines/web-views",
  "metadataVersion" : "0.1.0",
  "role" : "article",
  "title" : "Web views"
}
-->

# Web views

A web view loads and displays rich web content, such as embedded HTML and websites, directly within your app.

## Discussion

![A stylized representation of a compass icon. The image is tinted red to subtly reflect the red in the original six-color Apple logo.](images/com.apple.HIG/components-web-view-intro~dark@2x.png)

For example, Mail uses a web view to show HTML content in messages.

## Best practices

**Support forward and back navigation when appropriate.** Web views support forward and back navigation, but this behavior isn’t available by default. If people are likely to use your web view to visit multiple pages, allow forward and back navigation, and provide corresponding controls to initiate these features.

**Avoid using a web view to build a web browser.** Using a web view to let people briefly access a website without leaving the context of your app is fine, but Safari is the primary way people browse the web. Attempting to replicate the functionality of Safari in your app is unnecessary and discouraged.

## Platform considerations

*No additional considerations for iOS, iPadOS, macOS, or visionOS. Not supported in tvOS or watchOS.*

## Resources

#### Related

[Webkit.org](https://webkit.org/)

#### Developer documentation

<doc://com.apple.documentation/documentation/WebKit/WKWebView> — WebKit

#### Videos

  <doc://com.apple.documentation/videos/play/wwdc2021/10032>



---

Copyright &copy; 2026 Apple Inc. All rights reserved. | [Terms of Use](https://www.apple.com/legal/internet-services/terms/site.html) | [Privacy Policy](https://www.apple.com/privacy/privacy-policy)