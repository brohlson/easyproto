# Local Canvas planning starter

Local Canvas is a working project name for a personal desktop app that lets a local coding agent create and revise HTML/CSS artboards on an infinite canvas, with portable local projects and optional snapshot publishing later.

This starter contains the implementation plan, five project-local agent role charters, reusable review playbooks, a review contract, and templates. Application code, an executable agent runner, CI enforcement, and publishing are future milestones. These files do not install or activate platform agents or personal skills.

The [editable build plan](https://chatgpt.com/space/page_534a8dbaa7f081919591510a4f019c74) contains the milestone overview. The included `docs/implementation-plan.md` is its initial snapshot. After integration, keep the project's instructions, role files, playbooks, decisions, and executable checks versioned with the application code.

## Start here

1. Read [the implementation plan](docs/implementation-plan.md).
2. Read [AGENTS.md](AGENTS.md) and the [agent index](agents/README.md).
3. Use the [change brief](agents/templates/change-brief.md) for the first small implementation task.
4. Select reviewers using [the routing policy](agents/review-routing.md).
5. Load the relevant role and playbook into a fresh reviewer session. Follow the [review protocol](agents/review-protocol.md).
6. Integrate the selected coding-agent runner during Milestone 0. The runner must enforce permissions and record evidence; Markdown cannot enforce either.

The first product acceptance scenario is: ask a local agent to create two artboards, inspect a screenshot, revise the selected one, save, quit, and reopen the same project. Repeat a lost-response mutation without duplicating it and reject a stale edit without overwriting newer work.

## Directory map

| Location | Purpose |
| --- | --- |
| `AGENTS.md` | Shared project principles and entry point |
| `agents/*-lead.md` | Five specialist role charters |
| `agents/playbooks/` | Repeatable domain review procedures |
| `agents/review-protocol.md` | Evidence, dispositions, independence, and gating |
| `agents/review-routing.md` | Which specialist to invoke and when |
| `agents/schemas/review.schema.json` | Proposed machine-readable report contract |
| `agents/templates/` | Change, review, decision, and handoff templates |
| `docs/implementation-plan.md` | Milestones and acceptance criteria |
| `docs/architecture.md` | Current architecture baseline and open decisions |
| `docs/invariants.md` | Properties that changes must preserve |
| `docs/risks.md` | Initial risk register and accountable roles |
| `docs/decisions/` | Architecture decisions and rationale |

Keep the charters and playbooks runner-neutral. Add provider-specific adapter files after choosing a local coding-agent runner. Avoid maintaining five copied versions of shared rules.

