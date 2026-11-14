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
