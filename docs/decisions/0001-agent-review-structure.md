# Five specialist roles and a shared review process

- Status: proposed operating baseline
- Date: 2026-11-14
- Decision owner: Chase

## Context

The product needs recurring design critique and engineering review while remaining manageable as a personal project. Domain ownership must lead to evidence and follow-through, and review overhead must remain proportionate to the change.

## Decision

Use Design, Frontend, Security, Infrastructure, and Architecture/Reliability roles. The implementing agent coordinates the task. Invoke specialists on demand using one shared protocol and reusable playbooks. Keep roles runner-neutral; choose a thin adapter for the existing local coding agent during implementation.

Start with manual routing and independent reviewer sessions. Automate selection, report validation, evidence provenance, and gate enforcement after exercising the workflow on real changes. Keep durable decisions and findings in the repository; keep bulky logs as linked artifacts.

During a working session, the implementer runs focused checks and shares the result. Independent specialists review the batch in parallel when it is ready to commit or when the user requests review. Consult a specialist early for decisions that would be expensive to reverse. The [Codex review workflow](../../agents/codex-review.md) freezes the proposed tree before the branch advances.

## Consequences

The fifth role explicitly owns data integrity and long-term contracts. Infrastructure focuses on builds, packaging, dependencies, CI, and future publishing. The user retains final product and risk decisions. Several role prompts using the same model may share blind spots, so behavioral fixtures and deterministic checks are required to evaluate usefulness.

## Revisit

Split a role only when repeated missed work or conflicting responsibilities justify it. Add dedicated performance, accessibility, or publishing specialists only when those workloads outgrow the current ownership. Reassess the workflow if review time, false positives, or maintenance overhead outweigh confirmed useful findings.

