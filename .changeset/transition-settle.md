---
"@e2e-dev/mobile": patch
---

A tap, fill, or other action on a control that just appeared or moved no longer waits out the whole `transition` budget. It goes as soon as the screen has held still for half a second, so a `transition` above the default costs time only while something is still moving. A scroll's momentum is followed until the control stops, and `transition` stays the longest wait.
