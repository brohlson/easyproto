# Agent roles and review skills

Use five on-demand specialist roles. Their expertise is operationalized through current primary references, project invariants, repeatable playbooks, tools, and evidence. Role titles alone do not establish expertise or correctness.

| Role | Primary responsibility | Main playbooks |
| --- | --- | --- |
| [Design Lead](design-lead.md) | Interaction quality, keyboard workflow, accessibility, visual hierarchy | [Design critique](playbooks/design-crit.md) |
| [Frontend Lead](frontend-lead.md) | React and canvas state, coordinates, preview lifetime, UI performance | [Canvas performance](playbooks/canvas-performance-review.md), design critique |
| [Security Lead](security-lead.md) | Preview privileges, IPC, MCP authority, file containment, sharing boundaries | [Electron security](playbooks/electron-security-review.md), [MCP contracts](playbooks/mcp-contract-review.md) |
| [Infrastructure Lead](infrastructure-lead.md) | Builds, packaging, dependency/runtime maintenance, CI, future publishing operations | [Release readiness](playbooks/release-readiness-review.md) |
| [Architecture and Reliability Lead](architecture-reliability-lead.md) | Document commands, save/recovery, migrations, retry semantics, module boundaries | [Document recovery](playbooks/document-recovery-review.md), MCP contracts, release readiness |

The active implementing agent coordinates work. Review sessions are separate and normally read-only. A specialist may implement a specifically assigned task in a separate run, but that run cannot provide independent review of its own work.

## Role, skill, tool, and enforcement

- A **role** defines ownership and judgment.
- A **review skill** is a reusable procedure with inputs, steps, and required observations. This starter stores those procedures under `playbooks/`.
- A **tool** supplies source inspection, screenshots, execution, profiling, or other evidence.
- The **runner and CI** enforce permissions, revision identity, required reports, and acceptance policy.

These are project-local procedures. They are not automatically discovered by every agent client or installed as global skills. During Milestone 0, the chosen runner adapter will explicitly load the applicable role and playbooks. Native skill wrappers can be added later without duplicating the canonical procedure.

## Invocation

Give a reviewer the user outcome, acceptance criteria, base/head revision, diff and relevant surrounding source, applicable invariants and decisions, and check artifacts. Ask for a report following [the protocol](review-protocol.md). Withhold other reviewers' conclusions until independent reports are complete.

Use [routing](review-routing.md) to keep routine reviews small. Start with manual selection and one or two relevant specialists. Automate repeated steps after the first real changes reveal what the runner needs.

