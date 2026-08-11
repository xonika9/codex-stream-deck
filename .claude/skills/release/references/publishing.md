# Publishing transaction

Publication changes durable public state. Use this order so every step has a single safe resume point:

1. Require a clean `main`, a passing release gate, no existing version tag or release, and a candidate that fast-forwards `origin/main`.
2. Commit only the release-owned files with `chore(release): prepare vX.Y.Z`, then rerun the checks whose output depends on the committed tree.
3. Push `main` to the verified `origin` without force and confirm the remote branch resolves to the candidate commit.
4. Create one annotated local tag `vX.Y.Z` at that commit and push only that tag. Never recreate, retarget, or overwrite it.
5. Create a draft GitHub Release for the existing tag with the changelog section as release notes and every file from `outputs/release-vX.Y.Z/` as an asset.
6. Verify the draft's tag target, title, notes, and asset names, then make it public and mark it latest.
7. Read the public release back from GitHub and compare its target commit and asset inventory with the local candidate.

Use the repository's configured `origin` owner and name rather than a hard-coded account. Never upload source archives or generated files beyond the audited release directory.

If a step fails, do not repeat non-idempotent operations blindly. Reconcile the durable state first:

- after a `main` push, resume from tag creation;
- after a tag push, resume from draft creation;
- after draft creation, edit that draft or upload missing audited assets;
- after publication, issue a new patch version for corrections rather than changing the released tag or assets in place.
