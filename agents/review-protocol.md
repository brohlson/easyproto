# Review protocol

## Purpose

Make review claims traceable to a particular change, observable evidence, and an accountable disposition. Use this protocol for all five roles. It defines the intended behavior of the future runner; this starter does not execute or enforce it.

## Change and evidence

During a working session, the implementing agent runs focused checks and records meaningful results. Start independent review when the batch is ready to commit or the user asks for it. The implementing agent records a short [change brief](templates/change-brief.md), affected invariants, and relevant checks.

Review an immutable candidate. Record its trusted base and reviewed commit ID. An unpublished Git candidate can identify the proposed tree without advancing the branch. For non-Git inputs, the adapter records an immutable snapshot and equivalent content digest before claiming review freshness.

Run checks against that snapshot in an isolated test workspace. Capture the actual command, exit status, environment, and log or screenshot artifact. The trusted runner records executions. A model-authored sentence saying a test passed is not a substitute for its execution result.

Run the selected reviewers in parallel. Pass each reviewer the same change and acceptance criteria, relevant context, and evidence. Keep reviewer sessions independent until they submit their initial reports. Read-only access to the source and scoped execution in a disposable workspace must be enforced by the runtime. Test output may be written to that disposable workspace; reviewers do not modify the implementation being reviewed.

## Report

Use [review.schema.json](schemas/review.schema.json) for machine-readable reports and [review.md](templates/review.md) for readable findings. Record role, change ID, base and reviewed commit, policy version, scope, result, checks, findings, and uncertainty.

Results:

- `pass`: sufficient relevant evidence; no unresolved blocking findings in the reviewed scope.
- `changes_required`: a concrete supported defect or violated requirement needs correction.
- `needs_evidence`: an important conclusion cannot be reached with the available evidence. This is not proof of a defect.

When a role or playbook describes a conclusion as blocked for missing evidence, use the report result `needs_evidence` and identify the missing proof. Do not invent an additional result value.

Every finding has a stable ID, severity, exact location or affected behavior, evidence, impact, applicable requirement, smallest corrective action, owner, verification criterion, and disposition. A valid review can have zero findings.

## Severity and disposition

| Severity | Meaning | Default treatment |
| --- | --- | --- |
| `critical` | Credible privilege escape, unauthorized access, data loss/corruption, or comparable fundamental failure | Block acceptance of the affected change/release |
| `major` | Reproducible failure of supported behavior or a milestone's core workflow | Fix and verify before the affected feature ships |
| `minor` | Bounded defect or maintenance risk with a reasonable follow-up | Fix now or record an owned issue with a revisit condition |
| `suggestion` | Preference, optional improvement, or alternative approach | Advisory; never a gate by itself |

Supported dispositions are `open`, `fixed_verified`, `deferred`, `accepted_risk`, and `dismissed_with_evidence`. Verification of a fix names the new revision and evidence. Deferred findings identify a tracking item, owner, and milestone/date to revisit. Dismissals require a reason and evidence. Accepted risks require Chase's explicit decision, scope, rationale, and revisit condition; an agent cannot manufacture that approval.

Deferring a critical or major finding does not clear its acceptance gate. It remains blocking until verified fixed, dismissed with evidence, or covered by an explicit Chase-approved exception permitted by the project policy. A `needs_evidence` report blocks the affected required conclusion until sufficient evidence or such an exception exists. The runner evaluates this rule independently of the model's result field. An accepted exception is recorded as an exception, never relabeled as a passed test, and cannot override runtime permission limits.

Every closed or deferred finding includes a `closure` record. A verified fix supplies the actual verified commit and evidence; a deferral supplies a tracking reference and revisit condition; a dismissal supplies a reason and evidence; an accepted risk supplies the decision reference and revisit condition. The runner verifies decision authority, affected scope, and current validity. The separate `verification` field describes the criterion and is not evidence that it has been executed.

Resolve disagreements against the user requirement and evidence, not a vote among agents. The implementer proposes a correction; the affected domain reviewer verifies it. Escalate unresolved product tradeoffs to Chase. Routine fixes within the task continue without a new permission loop.

## Freshness and enforcement

The planned acceptance gate must verify report schema, expected reviewers, reviewed revision, completed trusted checks, and the disposition of blockers. Before advancing the branch, compare the staged tree and its parent with the reviewed candidate. A change to either requires a new candidate and renewed verification. Rerun checks and affected reviewers after a fix. Carry-forward of unrelated coverage requires an explicit runner-validated scope/dependency comparison.

Schema validation alone cannot prove a review is correct, an identity is independent, or a check actually ran. Those require runner provenance and CI integration. Report edits after acceptance must be auditable.

Load the required review policy from the trusted base revision. A change to policy, permissions, or routing must itself receive Architecture/Reliability and Infrastructure review, plus Security when authority changes. Evaluate that change under the existing policy; a proposed weaker rule cannot approve itself.

## Budget and stopping rules

Normally invoke one or two relevant specialists. Add a third when a concrete boundary crosses domains. Use all five at selected milestone reviews only when their domains are affected. Start with at most two review/fix cycles; if a material issue remains, record the disagreement or missing evidence and escalate rather than looping indefinitely. Rerun broader checks only for a specific unresolved risk or required gate.

## Durable memory

Retain architecture decisions, invariants, supported schema/client versions, meaningful review findings, and regression fixtures. Store verbose logs and screenshots as linked run artifacts. Keep handoffs short and current. Re-evaluate playbooks after an escaped defect; add a regression case when it would detect recurrence.

