# Easy Proto desktop slice

Implement the local agent-to-canvas loop from the imported planning baseline. Acceptance covers a visible Electron window, MCP create/update/capture, project reopen, lost-reply retry, stale-write rejection and preview privilege isolation. The slice affects INV-01 through INV-09 and review provenance under INV-13.

Route document/capture/MCP checks to Architecture and Reliability, preview/transport authority to Security, and canvas/preview/capture behavior to Frontend. Consult each specialty before implementation. Use the integration fixture and disposable project directories to collect runtime evidence on Apple Silicon.

## Project picker

The desktop can create a project in an empty folder, open a saved project, and retain the current project after cancellation or an invalid selection. Verify the same SDK connection can find the new context and that the prior activation cannot read, write, capture, or replay commands against the new active folder. Include same-ID copies, pending capture cancellation, and reopening while an admitted save finishes. Route fixed-revision review to Security and Architecture and Reliability.
