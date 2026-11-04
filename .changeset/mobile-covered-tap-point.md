---
"@e2e-dev/mobile": patch
---

A tap, fill, or other press no longer lands on whatever covers the node's tap point. A node under an app's sticky chrome over its scroll view (a footer, a header, a tab bar) is waited on while it moves and, once at rest, dragged clear by the least scroll that uncovers it, as Playwright scrolls an element into view before a click. A node under the soft keyboard is waited on. A node still covered when the action times out fails with `ACTION_FAILED` naming what covers it, and nothing is pressed. This fixes `scrollUntilVisible` followed by a tap landing on a sticky footer. Visibility is unchanged: `toBeVisible`, `getByRole`, and `scrollUntilVisible` still read a covered node as visible.
