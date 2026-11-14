# Canvas performance review

Use this procedure when canvas rendering, iframe lifecycle, thumbnails, or capture scheduling changes. Apply the [review protocol](../review-protocol.md).

1. Define representative documents, artboard count, viewport sizes, device environment, and gestures before measuring. Compare the same workload before and after the change.
2. Exercise pan, zoom, selection, resize, preview activation, and repeated opening and closing. Record relevant latency, frame behavior, memory, and live-renderer counts using available tooling.
3. Verify that zoom preserves CSS viewport size and resizing changes it. Check whether moving boards accidentally remounts or reloads their documents.
4. Inspect state subscriptions, cleanup, capture cancellation, and offscreen renderer disposal where measurements indicate a problem.
5. Confirm thumbnail and screenshot cache keys include source revision, asset changes, viewport, and relevant render settings. Obsolete captures must not replace current ones.

Report the workload and measurements, not an unsupported claim that the canvas scales indefinitely. Use agreed budgets where they exist; otherwise present a baseline and proposed target. Missing measurements block a performance claim, while a reproducible functional regression can still be reported directly.
