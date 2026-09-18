<!--
{
  "documentType" : "article",
  "framework" : "Human Interface Guidelines",
  "identifier" : "/design/Human-Interface-Guidelines/pickers",
  "metadataVersion" : "0.1.0",
  "role" : "article",
  "title" : "Pickers"
}
-->

# Pickers

A picker displays one or more scrollable lists of distinct values that people can choose from.

## Discussion

![A stylized representation of a selected item in a scrollable list. The image is tinted red to subtly reflect the red in the original six-color Apple logo.](images/com.apple.HIG/components-pickers-intro~dark@2x.png)

The system provides several styles of pickers, each of which offers different types of selectable values and has a different appearance. The exact values shown in a picker, and their order, depend on the device language.

Pickers help people enter information by letting them choose single or multipart values. Date pickers specifically offer additional ways to choose values, like selecting a day in a calendar view or entering dates and times using a numeric keypad.

## Best practices

**Consider using a picker to offer medium-to-long lists of items.** If you need to display a fairly short list of choices, consider using a [pull-down button](/design/Human-Interface-Guidelines/pull-down-buttons) instead of a picker. Although a picker makes it easy to scroll quickly through many items, it may add too much visual weight to a short list of items. On the other hand, if you need to present a very large set of items, consider using a [list or table](/design/Human-Interface-Guidelines/lists-and-tables). Lists and tables can adjust in height, and tables can include an index, which makes it much faster to target a section of the list.

**Use predictable and logically ordered values.** Before people interact with a picker, many of its values can be hidden. It’s best when people can predict what the hidden values are, such as with an alphabetized list of countries, so they can move through the items quickly.

**Avoid switching views to show a picker.** A picker works well when displayed in context, below or in proximity to the field people are editing. A picker typically appears at the bottom of a window or in a popover.

**Consider providing less granularity when specifying minutes in a date picker.** By default, a minute list includes 60 values (0 to 59). You can optionally increase the minute interval as long as it divides evenly into 60. For example, you might want quarter-hour intervals (0, 15, 30, and 45).

## Platform considerations

*No additional considerations for visionOS.*

### iOS, iPadOS

A date picker is an efficient interface for selecting a specific date, time, or both, using touch, a keyboard, or a pointing device. You can display a date picker in one of the following styles:

- Compact — A button that displays editable date and time content in a modal view.
- Inline — For time only, a button that displays wheels of values; for dates and times, an inline calendar view.
- Wheels — A set of scrolling wheels that also supports data entry through built-in or external keyboards.
- Automatic — A system-determined style based on the current platform and date picker mode.

A date picker has four modes, each of which presents a different set of selectable values.

- Date — Displays months, days of the month, and years.
- Time — Displays hours, minutes, and (optionally) an AM/PM designation.
- Date and time — Displays dates, hours, minutes, and (optionally) an AM/PM designation.
- Countdown timer — Displays hours and minutes, up to a maximum of 23 hours and 59 minutes. This mode isn’t available in the inline or compact styles.

The exact values shown in a date picker, and their order, depend on the device location.

Here are several examples of date pickers showing different combinations of style and mode.

**Compact:**

![An illustration of a compact date picker, with a single inline row showing the currently selected date. The picker opens as a popover extending down from the row, and includes a full calendar month for choosing the date.](images/com.apple.HIG/pickers-date-picker-compact-expanded@2x.png)

**Inline:**

![An illustration of an inline date picker, titled 'Date'. A toggle at the top is switched on, and a calendar month for choosing the date appears below the title and toggle.](images/com.apple.HIG/pickers-date-picker-inline-expanded~dark@2x.png)

**Wheels:**

![An illustration of an inline time picker, titled 'Time'. The currently selected time appears in the title row, and three vertical wheels appear below the title row for choosing the hour, minute, and AM or PM value.](images/com.apple.HIG/pickers-time-picker-inline-wheel~dark@2x.png)

**Use a compact date picker when space is constrained.** The compact style displays a button that shows the current value in your app’s accent color. When people tap the button, the date picker opens a modal view, providing access to a familiar calendar-style editor and time picker. Within the modal view, people can make multiple edits to dates and times before tapping outside the view to confirm their choices.

### macOS

**Choose a date picker style that suits your app.** There are two styles of date pickers in macOS: textual and graphical. The textual style is useful when you’re working with limited space and you expect people to make specific date and time selections. The graphical style is useful when you want to give people the option of browsing through days in a calendar or selecting a range of dates, or when the look of a clock face is appropriate for your app.

For developer guidance, see <doc://com.apple.documentation/documentation/AppKit/NSDatePicker>.

### tvOS

Pickers are available in tvOS with SwiftUI. For developer guidance, see <doc://com.apple.documentation/documentation/SwiftUI/Picker>.

### watchOS

Pickers display lists of items that people navigate using the Digital Crown, which helps people manage selections in a precise and engaging way.

A picker can display a list of items using the wheels style. watchOS can also display date and time pickers using the wheels style. For developer guidance, see <doc://com.apple.documentation/documentation/SwiftUI/Picker> and <doc://com.apple.documentation/documentation/SwiftUI/DatePicker>.



![An illustration representing a screen containing a picker view on Apple Watch, showing three items in a list. The center item is highlighted.](images/com.apple.HIG/pickers-wheel-watch@2x.png)



![An illustration representing a screen containing a date picker on Apple Watch, with the day highlighted.](images/com.apple.HIG/pickers-date-watch@2x.png)



![An illustration representing a screen containing a time picker on Apple Watch, with the minutes highlighted.](images/com.apple.HIG/pickers-time-watch@2x.png)

You can configure a picker to display an outline, caption, and scrolling indicator.

For longer lists, the navigation link displays the picker as a button. When someone taps the button, the system shows the list of options. The person can also scrub through the options using the Digital Crown without tapping the button. For developer guidance, see <doc://com.apple.documentation/documentation/SwiftUI/PickerStyle/navigationLink>.



![An illustration representing a screen that contains a picker button on Apple Watch. The button’s text denotes that the second item is selected.](images/com.apple.HIG/pickers-navigation-button-watch@2x.png)



![An illustration representing a screen showing a list of items on Apple Watch. The second item in the list is selected.](images/com.apple.HIG/pickers-navigation-list-watch@2x.png)

## Resources

#### Related

[Pull-down buttons](/design/Human-Interface-Guidelines/pull-down-buttons)

[Lists and tables](/design/Human-Interface-Guidelines/lists-and-tables)

#### Developer documentation

<doc://com.apple.documentation/documentation/SwiftUI/Picker> — SwiftUI

<doc://com.apple.documentation/documentation/UIKit/UIDatePicker> — UIKit

<doc://com.apple.documentation/documentation/UIKit/UIPickerView> — UIKit

<doc://com.apple.documentation/documentation/AppKit/NSDatePicker> — AppKit

## Change log

|Date        |Changes                                       |
|------------|----------------------------------------------|
|June 5, 2023|Updated guidance for using pickers in watchOS.|

---

Copyright &copy; 2026 Apple Inc. All rights reserved. | [Terms of Use](https://www.apple.com/legal/internet-services/terms/site.html) | [Privacy Policy](https://www.apple.com/privacy/privacy-policy)