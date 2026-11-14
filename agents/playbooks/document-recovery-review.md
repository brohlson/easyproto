# Document recovery review

Use this procedure for persistence, autosave, history, asset commits, or schema migration changes. Apply the [review protocol](../review-protocol.md).

1. Write the durability contract: what a successful response promises, where the commit point is, and which complete state reopening should recover.
2. Trace all files and journal records modified by a command. Check ordering, flushing where required by the contract, cleanup, and recovery after interruption.
3. Inject termination at meaningful commit boundaries in disposable projects. Reopen and verify source, layout, assets, history, revision, and idempotency records agree.
4. Exercise stale writes, disk-write failures, malformed documents, and unsupported schema versions that the change affects. Verify failed operations preserve recoverable user data.
5. For migrations, test representative older fixtures, backup behavior, interrupted migration, and the supported rollback or refusal policy.

Record exact fixtures, commands, interruption points, and recovered outcomes. Atomic replacement of individual files is insufficient evidence of a multi-file transaction. Mark required crash or migration evidence as blocked when unavailable. Keep cache regeneration separate from recovery of authoritative user content.
