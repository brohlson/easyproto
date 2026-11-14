# Review routing

Route by changed behavior, declared risk, and affected trust or data boundaries. File paths are useful hints, not the sole classifier. Use the currently trusted policy and preserve the reason for each selected reviewer.

| Change | Default reviewers | Evidence focus |
| --- | --- | --- |
| Copy or isolated cosmetic adjustment | Implementer checks; Design only when comprehension or accessibility changes | Visible result in affected state |
| Canvas gestures, selection, focus, arrange/preview mode | Frontend + Design | Task walkthrough, keyboard/focus, coordinate behavior |
| Rendering, thumbnail cache, capture readiness | Frontend + Architecture/Reliability | Exact revision/viewport capture, lifecycle, realistic workload |
| Document commands, persistence, undo, migrations | Architecture/Reliability | Interrupted-save recovery, conflicts, history, compatibility |
| Asset resolver or import/export file access | Security + Architecture/Reliability | Containment, symlinks, source/asset consistency |
| MCP mutations, transport, authentication, discovery | Architecture/Reliability + Security | Retry idempotency, stale revisions, authority and origin checks |
| Preload, IPC, sandbox, origin policy, JavaScript runtime | Security + Frontend | Privilege isolation and actual hostile fixtures |
| Build, packaging, update pipeline, desktop runtime upgrade | Infrastructure + affected owner | Packaged workflow, compatibility, rollback; add Security for changed trust or known relevant vulnerabilities |
| Review policy, runner permissions, gate implementation | Infrastructure + Architecture/Reliability; Security when authority changes | Existing-policy enforcement, stale/fabricated evidence rejection |
| Web snapshot publishing | Infrastructure + Security; Design for viewer interaction | Snapshot isolation, selected export, credentials excluded, access semantics |
| Release or milestone acceptance | Architecture/Reliability + relevant owners | Core workflow and changed-risk evidence |

For new features, pick the primary engineering owner and add Design for meaningful user workflow changes. Add another specialist only for a concrete affected boundary. An unfamiliar domain is a reason to inspect context, not to automatically call every role.

Consult specialists before implementation when a decision changes the file format, privilege boundary, public tool contract, or major interaction model. Reserve full after-implementation review for the actual diff and evidence.

