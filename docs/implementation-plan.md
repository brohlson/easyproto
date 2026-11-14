# Local Canvas build and agent harness plan

Local Canvas is the working name for Chase's personal desktop workspace for agent-created HTML/CSS mockups. Build it with Electron, React, TypeScript, real browser-rendered artboards, a local MCP server, and portable project folders. Add read-only web snapshot sharing after the local workflow is dependable.

Use five on-demand specialist agents: Design, Frontend, Security, Infrastructure, and Architecture/Reliability. The active implementation agent coordinates the task. Their accountability comes from defined ownership, reproducible evidence, revision-bound reviews, tracked findings, and checks enforced by the runner and CI.

Status on November 14, 2026: the plan, role charters, reusable review procedures, and report contract are drafted. The desktop application, coding-agent adapter, automated review gates, and cloud publishing are implementation milestones.

# Product scope

The first useful release lets a local coding agent create multiple HTML/CSS screens, inspect screenshots, revise a selected screen, and save a project that reopens correctly. Chase can arrange, resize, duplicate, rename, and preview artboards manually.

The browser owns document layout; the canvas owns spatial arrangement. Camera zoom preserves an artboard's CSS viewport, while resizing changes that viewport. Keep source files as the canonical content and screenshots as disposable caches.

Start with HTML/CSS and imported local assets. Treat JavaScript/React execution, element-level visual layout editing, shared editing, and continuous cloud synchronization as later scope decisions. The first sharing feature publishes a saved revision without requiring ongoing sync.

# Agent ownership

| Role | Owns | Typical output |
| --- | --- | --- |
| Design Lead | Interaction model, visual hierarchy, keyboard use, accessibility, arrange/preview behavior | Critique grounded in a user task and screenshots; explicit distinction between usability defects and preferences |
| Frontend Lead | React structure, canvas state, coordinate systems, preview lifecycle, input/focus, UI performance | Concrete code findings and reproduction/profiling evidence |
| Security Lead | Preview isolation, IPC authority, local MCP access, file containment, assets, future sharing boundaries | Scoped threat analysis and supported vulnerability findings |
| Infrastructure Lead | Builds, packaging, CI, runtime/dependency maintenance, release recovery, later Cloudflare publishing operations | Reproducible build and packaged-app evidence, operational decisions |
| Architecture and Reliability Lead | Document model, module boundaries, commit/recovery, undo, migrations, conflicts, retry idempotency, capture correctness | Contract decisions, failure-case evidence, regression requirements, release-risk assessment |

Architecture/Reliability is the fifth role because long-term stability depends heavily on document and command semantics. Infrastructure remains focused on how the software is built, shipped, and operated. Maintainability is shared, with a named owner for each cross-cutting contract.

The coordinator routes work, supplies the change brief, integrates findings, and drives scoped fixes. It is a responsibility of the primary agent, not another permanent specialist. Chase owns unresolved product tradeoffs and accepted risks.

# Skills and evidence

Each role file defines its mission, boundaries, inputs, workflow, evidence, and examples of must-fix findings. Reusable procedures live in `agents/playbooks/`:

- Design critique and keyboard/focus walkthrough.
- Electron preview and IPC security review.
- Document commit, recovery, migration, and history review.
- MCP mutation, conflict, and retry review.
- Canvas lifecycle and performance review.
- Packaged release readiness review.

These project procedures are runner-neutral. The chosen agent adapter explicitly loads the selected role and procedures. Native skill wrappers can be added later; one canonical playbook should remain the source of truth.

Tools supply the evidence: source inspection, actual check execution, screenshots, browser inspection, profiling, and packaged-app runs. The runner restricts tools and workspace access. A role prompt does not itself enforce read-only access or confer expertise.

Keep domain context curated: architecture decisions, invariants, schema/client compatibility, verified failure cases, and open findings. Prefer primary framework documentation for changing technical behavior. Update procedures when an escaped defect reveals a missing review step.

# Development and review workflow

1. Write a short change brief with the user outcome, acceptance criteria, affected components, invariants, and relevant verification.
2. Implement bounded changes and run focused checks during iteration. Preserve actual results.
3. When the batch is ready to commit or the user asks for review, freeze the candidate and route to one or two relevant specialists. Add another only for a concrete affected boundary.
4. Run reviewers in parallel in fresh contexts against the same immutable candidate and verification evidence. Keep their initial reports independent.
5. Collect structured findings. Distinguish `pass`, `changes_required`, and `needs_evidence`.
6. Resolve findings through a scoped fix, an evidenced dismissal, a tracked follow-up, or an explicit accepted-risk decision.
7. Recheck the affected behavior and reviewer scope on the new revision. Preserve source identity and evidence provenance.
8. Confirm the authorized commit will use the reviewed tree and parent. Record a short handoff and the next bounded task.

The proposed report schema includes role/run identity, change and source revision, policy version, reviewed scope, checks, findings, and remaining uncertainty. Every substantive finding carries evidence, consequence, owner, correction, and a verification criterion.

Critical security/data-integrity failures block the affected change. Material supported-behavior defects must be fixed before that feature ships. Minor findings may become owned follow-ups. Stylistic suggestions remain advisory. Missing evidence blocks only conclusions that depend on it; it is not proof that a vulnerability or defect exists.

Use the existing trusted policy to review policy changes. A change cannot weaken its own required checks and then approve itself. The runner validates schema, required reviewers, commit freshness, trusted check execution, and unresolved blockers. JSON schema validation alone cannot prove any semantic claim.

Start with at most two review/fix cycles. Escalate a material disagreement or missing capability after that instead of looping indefinitely. Continue routine corrective work within the existing task authorization.

# Review routing

| Change | Default reviewers |
| --- | --- |
| Small copy or isolated visual adjustment | Implementer; Design if comprehension/accessibility changes |
| Canvas gestures, focus, selection, preview interaction | Frontend and Design |
| Document commands, saves, undo, migrations | Architecture/Reliability |
| File/asset resolver or import/export authority | Security and Architecture/Reliability |
| MCP mutations, connection/authentication, retry behavior | Architecture/Reliability and Security |
| Preview execution, preload, IPC, sandbox | Security and Frontend |
| Capture identity, thumbnail lifecycle, rendering performance | Frontend and Architecture/Reliability |
| Packaging, builds, runtime upgrade, release pipeline | Infrastructure and the affected domain owner |
| Harness policy, evidence gates, permission model | Infrastructure and Architecture/Reliability; Security when authority changes |
| Web publishing | Infrastructure and Security; Design for viewer workflow |

Use all five only at selected milestone reviews where their domains are affected. File paths can suggest reviewers, but changed behavior and trust/data boundaries decide routing.

# Milestone 0 Establish the working harness

Keep initial setup to one focused development session. Use the existing local coding agent with a thin adapter instead of building a new general orchestration platform.

Deliverables:

- Choose the project repository location and coding-agent runner.
- Add the root instructions, five role files, shared procedures, and review templates.
- Pin the initial toolchain and document how to start the app once scaffolded.
- Connect the runner to role loading and isolated reviewer sessions.
- Exercise one small real change with manual routing and a recorded report.

Exit: an implementation task can be reviewed independently, a finding can be assigned and closed with evidence, and the next session can resume from the handoff. Automated CI enforcement is an incremental follow-up, not a prerequisite to writing the first screen.

Primary owners: Infrastructure and Architecture/Reliability. Design supplies the initial interaction principles.

# Milestone 1 Prove the agent to canvas loop

Build a small Electron window with a basic canvas, sandboxed HTML/CSS artboard, application-owned document model, local project open/save, and MCP create/read/update/capture tools. Decide the commit/recovery strategy before treating saves as reliable.

Use a command envelope with `projectId`, `commandId`, `expectedRevision`, `operation`, and `arguments`. Persist the outcome needed for retry deduplication with the document commit. Reject reuse of the same command ID for different arguments. Distinguish committed, rendered, and captured states.

Exit evidence:

- The agent creates two artboards, captures one, and revises it.
- Closing/reopening preserves content, dimensions, and positions.
- A lost-response retry creates no duplicate artboard or history entry within the documented idempotency contract.
- An edit based on a stale revision conflicts without erasing newer work.
- Capture returns the intended revision and viewport, or an explicit readiness/error result.
- A hostile preview fixture cannot reach privileged app functions.

Primary owners: Architecture/Reliability and Frontend. Security reviews the preview and MCP boundaries. Infrastructure confirms the selected client connects to the actual local app.

# Milestone 2 Make it dependable for daily use

Add pan/zoom, selection, movement, resizing, duplication, deletion, naming, arrange/preview modes, keyboard escape, assets, autosave, undo, and checkpoints.

Exercise interrupted saves at actual commit boundaries, disk-full/write failures, recovery after restart, and schema-version handling. Record the supported durability claim; process-termination testing does not establish every power-loss guarantee. For migrations, preserve an original and safely reject or open read-only any unsupported newer format.

Exit evidence:

- A realistic design exploration can be completed without manual file repair.
- Preview interaction returns cleanly to canvas interaction with predictable focus.
- Camera zoom and viewport resizing have their intended distinct behavior.
- Interrupted multi-file writes recover a consistent state.
- Restoring a checkpoint uses the document command system and preserves revision correctness.
- A copied project opens with its local assets intact.

Primary owners: Frontend, Design, and Architecture/Reliability. Security reviews changed asset/file authority.

# Milestone 3 Make the checks enforceable and measure performance

After exercising the manual workflow, automate routine role selection, report validation, revision freshness, trusted execution artifacts, blocker disposition, and audit records. Use base-branch policy for policy-change acceptance.

Create a representative workload on the target Mac and measure input latency, memory after repeated preview/capture cycles, startup/open time, and capture time. Establish justified budgets from that baseline. Add cached distant-artboard thumbnails only where measurements justify them.

Evaluate the harness against a small versioned fixture set containing both known faults and clean controls. Useful cases include a stale capture, an asset-path escape, a duplicate retry mutation, interrupted-save corruption, a focus trap, and a stale or fabricated review artifact.

Exit: the gate rejects stale reports and missing required evidence; the selected reviewers find known relevant faults without routinely blocking clean controls; the measured canvas workload meets recorded budgets. Record model, prompt/playbook, policy, and runner versions so changes can be compared.

Primary owners: Infrastructure and Architecture/Reliability, with Frontend for performance and Security for authority cases. Schema checks do not replace these behavioral evaluations.

# Milestone 4 Ship a maintainable personal desktop build

Package the app for the supported Mac configuration. Document build reproduction, runtime/dependency updates, project-format compatibility, and application rollback behavior. Keep migration backups and supported schema behavior consistent with rollback claims.

Exit: a packaged build can connect to the local agent, create, render, capture, save, quit, and reopen. Meaningful failure/regression checks run in the supported environment. Findings are current, scoped, and dispositioned. The release notes identify known material limitations.

Primary owners: Infrastructure and Architecture/Reliability. Invoke Design or Security for relevant changes since their last accepted review.

# Milestone 5 Publish read only snapshots

After the local app is useful, add an exporter, Cloudflare Worker/R2 upload and serving path, and a read-only web viewer. Publish a selected committed revision with required assets. Keep local credentials, app preferences, history not selected for export, and private paths out of the snapshot.

Exit: the link displays the selected revision while the local project continues changing. Access semantics are explicit. Generated content is separated from authenticated management surfaces. Test revocation and caching together if revocation is offered.

Primary owners: Infrastructure, Security, and Design. Continuous cloud sync and multiplayer remain separate later work.

# Long term maintenance

At releases and meaningful changes, check the affected invariants, dependency/runtime state, schema compatibility, open risk dispositions, and realistic workflow evidence. After an escaped defect, add a focused regression and update the relevant playbook. Review curated decisions when their revisit conditions occur.

Track usefulness through confirmed findings, escaped regressions, false positives on known clean cases, review latency/cost, and overdue accepted-risk follow-ups. Do not optimize for finding count or an invented overall quality score.

Scheduled maintenance can be added once there is a repository and useful recurring work. This plan does not create a calendar or background automation.

# First development session

1. Select the local repository location and agent runner.
2. Scaffold Electron/React/TypeScript/Vite and load the shared project instructions.
3. Implement a single sandboxed artboard with explicit viewport dimensions.
4. Record the first short architecture decision about preview origins and asset access.
5. Run a focused Frontend/Security review of that boundary and retain the evidence.
6. Leave a handoff that identifies the next step: document commands and persistent project state.

# References

The role allocation, milestone sequence, review routing, and application invariants are design recommendations for this project. The following primary references support the underlying platform and agent-workflow concepts:

- [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security): isolation, sandboxing, privileged APIs, runtime and dependency maintenance.
- [MCP Streamable HTTP specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http): transport behavior and local endpoint protections; confirm compatibility with the actual chosen client.
- [Anthropic Building effective agents](https://www.anthropic.com/research/building-effective-agents): composable orchestration and evaluation patterns. The article's specific tooling has evolved; use it for workflow principles.
- [Anthropic Effective harnesses for long-running agents](https://www.anthropic.com/research/effective-harnesses-for-long-running-agents): bounded progress and durable handoff artifacts across sessions.

