# Run a specialist review with Codex

Select reviewers with [review routing](review-routing.md). The canonical roles and playbooks live in this directory. The coordinator owns changes and re-verification.

1. Commit the source, then export that commit to a fresh disposable workspace using `git archive HEAD | tar -x -C "$REVIEW_DIR"`. Keep the genuine base and head IDs with the export. Build and test inside the disposable workspace and record the exact command, environment, exit status and artifacts.
2. Use the [prompt adapter](codex-review-prompt.sh) with the selected role, base and head, and absolute evidence directory. Keep the role files from the trusted baseline when policy changes are under review.
3. Launch a fresh reviewer per role. For runtime-enforced read-only review, pass the prompt to `codex exec --ephemeral --sandbox read-only -C "$REVIEW_DIR" --skip-git-repo-check -` and save its report outside the source folder. The reviewer may inspect source, evidence and accepted references. The coordinator runs requested checks separately in the disposable workspace and attaches the observed output.
4. In a Codex session with native delegation, spawn reviewers with no inherited conversation and pass the rendered prompt individually. Native reviewers can inspect immutable Git objects and evidence directly. If this runner shares writable workspaces, the coordinator must disclose that permission limitation. Keep native reviewers off the implementation checkout for writing.
5. Use the provided report schema and readable template. Fix substantive findings, run affected checks on a new commit, and ask the affected reviewers to verify that revision. Record missing evidence and remaining gates in the handoff.

Example prompt generation from the repository root:

```sh
sh agents/codex-review-prompt.sh security "$(git rev-list --max-parents=0 HEAD)" "$(git rev-parse HEAD)" "$PWD/evidence"
```
