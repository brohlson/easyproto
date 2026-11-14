# Design critique

Use this procedure for changes to the canvas workflow, application chrome, or user-visible state. Apply the [review protocol](../review-protocol.md).

1. State the user task and its completion condition. Open the reviewed build at the recorded revision and window size.
2. Walk the relevant sequence with pointer input and keyboard input. Check selection, arrange and preview transitions, focus, Escape, and recovery from a mistaken action.
3. Inspect the affected empty, loading, saved, unsaved, conflict, and error states. Review only states that the change can affect.
4. Check hierarchy, text clarity, spacing, target visibility, and behavior at supported window sizes. Distinguish an accepted design rule from personal taste.
5. Capture each problematic state with its revision, dimensions, and reproduction steps.

Report the user consequence, the smallest useful correction, and a verification step. A missing screenshot blocks a visual conclusion when the appearance cannot otherwise be inspected. A screenshot alone does not prove keyboard behavior. Keep speculative enhancements in an advisory section rather than expanding the accepted feature.
