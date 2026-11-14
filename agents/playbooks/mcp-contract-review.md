# MCP contract review

Use this procedure for tools, transport configuration, mutation semantics, or agent-visible results. Apply the [review protocol](../review-protocol.md).

1. Check input and output schemas, project authorization, payload limits, and errors. Verify the tested client and protocol combination.
2. Trace mutating tools into the shared document command service. Confirm expected-revision handling and explicit save-versus-render status.
3. Retry a completed mutation after discarding its reply. The same application-level idempotency key and payload must produce the original result without another mutation. A reused key with a different payload must fail clearly.
4. Test cancellation and timeouts around the commit point. A cancelled or disconnected request does not imply that its mutation was undone.
5. Check that captures return the requested document revision and viewport, and report unresolved render dependencies.
6. For HTTP, inspect binding, origin and host checks, authentication, and secret handling in the effective configuration.

Record exact request sequences, revisions, outcomes, and relevant logs with secrets removed. Transport request IDs or idempotency annotations alone do not establish application-level deduplication.
