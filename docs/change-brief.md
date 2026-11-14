# Easy Proto desktop slice

Implement the local agent-to-canvas loop from the imported planning baseline. Acceptance covers a visible Electron window, MCP create/update/capture, project reopen, lost-reply retry, stale-write rejection and preview privilege isolation. The slice affects INV-01 through INV-09 and review provenance under INV-13.

Route document/capture/MCP checks to Architecture and Reliability, preview/transport authority to Security, and canvas/preview/capture behavior to Frontend. Consult each specialty before implementation. Use the integration fixture and disposable project directories to collect runtime evidence on Apple Silicon.

## Project picker

The desktop can create a project in an empty folder, open a saved project, and retain the current project after cancellation or an invalid selection. Verify the same SDK connection can find the new context and that the prior activation cannot read, write, capture, or replay commands against the new active folder. Include same-ID copies, pending capture cancellation, and reopening while an admitted save finishes. Route fixed-revision review to Security and Architecture and Reliability.

## Previous resize workflow

The corner resize handle and its keyboard resize controls were replaced at the user's request. Device presets are the current desktop resize workflow. The invariant that zoom preserves the CSS viewport still applies.

## Home, activity, device presets, and working-session reviews

- Home lists locally opened projects and can create or reopen one. Verify an empty profile, persistence across restart, a moved folder, and revocation of the previous MCP activation and preview URLs when returning Home.
- Rename the project and artboards inline. Verify portable project names, revision-checked artboard edits, and preservation of the preview frame. Keep chrome labels the same screen size as the canvas zoom changes.
- Let an authorized agent signal artboard activity. Verify that only the active board pulses, reduced motion keeps it steady, and activity expires or clears without a save or a capture change.
- Click artboard dimensions to apply phone, tablet, or desktop presets. Verify keyboard selection, CSS viewport and media-query changes, conflict rejection, and matching capture and reopened dimensions. Check the Lucide settings menu and the Figma-inspired palettes at standard and minimum window sizes.
- Keep EasyProtoMocks portable. Verify that its current snapshot and source files reopen and that repository content has no machine paths or credentials.
- Run focused checks during iteration. Verify the unpublished review candidate workflow in a disposable repository, load policy from the trusted base, and confirm the final commit uses the reviewed tree and parent.

Route Home, previews, and MCP authority to Security. Route project persistence, revision semantics, and review provenance to Architecture/Reliability. Route canvas and menus to Frontend and Design. Route the dependency and review workflow to Infrastructure.

## Artboard editing and preview entry

- Command-D and Command-C followed by Command-V create offset copies with independent HTML and CSS. Verify source at copy time, a fresh ID on paste, and preservation of native text shortcuts.
- Delete saves removal of the selected artboard. Command-Z restores its ID, source, position, size, and order. Verify redo, deleted preview retirement, and reopening after removal.
- Undo and redo publish new revisions and retain retry results, including when an earlier result references a removed artboard. Verify v1 reads, v2 reopening, and session-scoped history.
- Keep the artboard outline visible while the iframe loads. Fade in the preview after load, respect Reduced Motion, and preserve preview identity on canvas moves and zoom.

Route persistence to Architecture/Reliability, clipboard and IPC scope to Security, and canvas shortcuts and preview entry to Frontend and Design.

## Multi-select and trackpad panning

- Shift-click toggles artboards, and a selection box includes every board it partially overlaps. The dashed group outline aligns with artboard edges at different zoom levels.
- Swiping with two fingers or scrolling moves the canvas horizontally or vertically at the same zoom. Pinch still zooms while retaining the artboard’s CSS viewport. Space-drag still pans.
- Move, duplicate, paste, or delete multiple selected artboards together. One saved revision and one undo step cover the group. Copies retain the group geometry and use independent IDs and sources.
- Verify stale and invalid group edits leave the document intact, grouped moves retain source revisions, and committed group results replay after reopening version 3. Read existing version 1 and version 2 projects.
- Verify the narrow clipboard and document bridge still rejects unauthorized contexts and the HTML/CSS previews remain isolated. Reopen the portable mockup in the exported candidate.

Route gestures and outline behavior to Frontend and Design. Route versioning, command replay, and grouped undo to Architecture and Reliability. Route the changed preload and clipboard IPC to Security. Related requirements are INV-01 through INV-07 and INV-13.
