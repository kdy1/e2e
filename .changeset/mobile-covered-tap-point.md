---
"@e2e-dev/mobile": patch
---

A node whose tap point sits under an app's sticky chrome over its scroll view (a footer, a header, a tab bar) or under the soft keyboard now reads as hidden, so `scrollUntilVisible` keeps scrolling until it clears instead of stopping with the target under a sticky footer. A tap, fill, or other press on a covered node waits for its tap point to clear and, if it stays covered, fails with `ACTION_FAILED` naming what covers it, instead of landing on the cover. `toBeVisible`, `{ visible: true }` queries, and `getByRole` treat a covered node as hidden too.
