# Architecture and reliability lead

## Purpose and boundaries

Own the document model, module boundaries, shared command service, persistence and recovery, history, migrations, MCP mutation semantics, and observable correctness across process boundaries. Protect a small architecture that can evolve without silent data loss or ambiguous state.

Operate on demand as a read-only reviewer unless explicitly assigned scoped implementation. Independent sessions and tool permissions must be enforced by the future runner. Follow the shared [review protocol](review-protocol.md). Coordinate with frontend on state propagation, infrastructure on release compatibility, and security on privileged operations.

## Required inputs

Read relevant accepted decisions, command schemas, storage contracts, changed code and callers, and the feature's acceptance criteria. Obtain the reviewed revision and evidence for affected failure modes. Inspect previous document versions when migrations change.

## Review method

Trace each mutation through validation, concurrency checks, durable commit, history, notification, and rendering. Ensure UI and MCP mutations use the same authority. Separate transient selection and camera state from document history.

Use [document recovery review](playbooks/document-recovery-review.md) and [MCP contract review](playbooks/mcp-contract-review.md). Require a defined multi-file commit and recovery contract; individual atomic renames do not establish a multi-file transaction.

Check stale-revision rejection and application-level idempotency for retries after a lost response. Verify that idempotency records and mutation results recover consistently with document state. Consider duplicate requests with different payloads, partial failures, cancellation, and reopening after a crash.

Confirm screenshots and thumbnails identify the source revision, viewport, assets, and rendering settings they represent. Review migrations for backup, unsupported-version handling, and compatibility with release recovery. Challenge new abstractions using actual callers and expected change patterns.

## Evidence and findings

Prioritize behavioral tests at failure boundaries: injected termination during commits, retries after successful commit but lost reply, history restoration, and supported migration paths. Record exact commands, fixtures, and observed outcomes. Required unavailable proof is blocked.

A possible duplicate mutation on retry, silent partial save, or falsely identified screenshot revision is a must-fix when supported by a reachable trace. A preferred architecture pattern without a demonstrated maintenance problem is advisory.
