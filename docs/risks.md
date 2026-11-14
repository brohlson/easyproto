# Initial risk register

Status for every entry is **open planning requirement**. Owners are agent roles responsible for review and follow-through; Chase remains the product maintainer and risk decision owner.

| ID | Risk | Owner | Evidence required before affected milestone completes |
| --- | --- | --- | --- |
| R-01 | Generated content reaches privileged app functions | Security | Hostile preview fixture cannot use the app bridge, read an unrelated file, navigate trusted chrome, or gain an unapproved capability |
| R-02 | Unauthorized callers control local MCP | Security | For HTTP, enforce loopback, authentication, Origin/Host validation, and project scope. For stdio, verify subprocess/IPC authority and project scope. Apply HTTP checks to any internal HTTP bridge as well |
| R-03 | Lost MCP response causes duplicate changes on retry | Architecture/Reliability | Commit create, drop response, restart as applicable, retry same command: same artboard and history outcome; different payload with same key rejected |
| R-04 | Concurrent user/agent edits erase work | Architecture/Reliability | Interleaved edits reject stale revision while preserving the committed newer state |
| R-05 | Interrupted multi-file saves corrupt a project | Architecture/Reliability | Termination at each commit boundary, reopen, and check consistent sources/assets; disk-full/permission failures produce honest state and recoverable data |
| R-06 | Migration or app rollback damages projects | Architecture/Reliability + Infrastructure | Older fixtures migrate with preserved originals; newer unsupported schema is safely rejected/read-only; interrupted migration recovers |
| R-07 | Agent sees a stale or mismatched screenshot | Frontend + Architecture/Reliability | Rapid successive edits and requested-revision captures prove identity; missing asset/font and readiness timeout are explicit |
| R-08 | Live previews or captures leak resources | Frontend | Repeat create/select/capture/delete with a representative project and compare memory/input latency against a recorded target-machine baseline |
| R-09 | Development works but packaged app fails | Infrastructure | Packaged connect/create/render/capture/save/quit/reopen smoke on the supported Mac configuration |
| R-10 | Share export leaks credentials or mutable state | Security + Infrastructure | Selected immutable snapshot, asset completeness, secret exclusion, separated preview origin, tested access and revocation semantics if offered |
| R-11 | Reviews approve stale code or fabricated check claims | Infrastructure + Architecture/Reliability | Harness fixtures reject stale commit, missing role, missing trusted execution, unresolved blocker, or self-weakened policy |

When implementation begins, add concrete issue IDs, owners, evidence links, and revisit milestones. Do not mark an entry resolved from a prompt, a design document, or an agent vote alone.

