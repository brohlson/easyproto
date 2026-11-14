# Run a specialist review with Codex

Use this workflow when the user asks for independent review or says a batch is ready to commit. Select reviewers using [review routing](review-routing.md) from the trusted base. The coordinator owns changes and re-verification.

1. Stage only the proposed changes. For a review-only request, use a temporary Git index to preserve the user's staging area. Record the current base and create an unpublished candidate commit object from the staged tree. Export the candidate to a fresh disposable workspace. Build and verify there, recording the command, environment, exit status, and artifacts.
2. Export the [prompt adapter](codex-review-prompt.sh) from the trusted base and run that copy with each selected role, trusted base, candidate ID, and absolute evidence directory. The adapter also loads role files and policy from the trusted base.
3. Launch the required reviewers in parallel in fresh contexts. For runtime-enforced read-only review, pass the prompt to `codex exec --ephemeral --sandbox read-only -C "$REVIEW_DIR" --skip-git-repo-check -` and save its report outside the source folder. The coordinator runs requested checks separately in the disposable workspace and attaches the observed output.
4. In a Codex session with native delegation, spawn reviewers with no inherited conversation and pass the rendered prompt individually. Native reviewers can inspect immutable Git objects and evidence directly. If this runner shares writable workspaces, the coordinator must disclose that permission limitation. Keep native reviewers off the implementation checkout for writing.
5. Use the report schema and template. Fix substantive findings, freeze a new candidate, and rerun the affected checks and reviews. Record missing evidence and remaining gates in the handoff.
6. Before making an authorized commit, confirm the staged tree and current parent match the reviewed candidate. If either changed, review the updated candidate. Verify the resulting commit has that tree and parent before recording it as reviewed.

Example review preparation from the repository root after staging the proposed batch. Set `EVIDENCE_DIR` to the absolute path of the review evidence directory. Creating the candidate leaves the branch tip and working tree in place.

```sh
BASE=$(git rev-parse HEAD)
TREE=$(git write-tree)
CANDIDATE=$(git commit-tree "$TREE" -p "$BASE" -m "Review candidate")
REVIEW_DIR=$(mktemp -d)
git archive -o "$REVIEW_DIR/candidate.tar" "$CANDIDATE"
tar -xf "$REVIEW_DIR/candidate.tar" -C "$REVIEW_DIR"
rm "$REVIEW_DIR/candidate.tar"
git show "$BASE:agents/review-routing.md"
TRUSTED_ADAPTER=$(mktemp)
git show "$BASE:agents/codex-review-prompt.sh" > "$TRUSTED_ADAPTER"
sh "$TRUSTED_ADAPTER" security "$BASE" "$CANDIDATE" "$EVIDENCE_DIR"
rm -f "$TRUSTED_ADAPTER"
```

Confirm the staged tree and parent immediately before committing.

```sh
test "$(git write-tree)" = "$(git rev-parse "${CANDIDATE}^{tree}")" &&
  test "$(git rev-parse HEAD)" = "$(git rev-parse "${CANDIDATE}^")"
```
