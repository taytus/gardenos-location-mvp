# Releasing GardenOS Location

A short, accurate runbook for cutting the next release of GardenOS Location.
It replaces the handoff's `PUSH-TO-GITHUB.md`, which is dangerous and must not
be reproduced.

## Tools

The release pipeline has two scripts:

- `scripts/deploy.sh` — bumps the version, commits, annotates the tag, and
  pushes both `main` and the tag.
- `scripts/verify-deployment.sh` — checks the live GitHub Pages site after
  deployment (badge, demo string absence, PWA assets, etc.).

These scripts are the only authorized way to ship. Read both scripts before
running them; they are short and explicit.

## Order of operations

1. **Inspect the working tree.** Make sure `git status -sb` is clean and you
   are on `main`. Pull the latest: `git pull --ff-only origin main`.
2. **Decide the next version.** Read `VERSION` and pick the next semantic
   version. The current version is whatever is in `VERSION`; pick the next
   number according to the change. Never hardcode a version into scripts or
   notes; the scripts read `VERSION` as the source of truth.
3. **Bump `VERSION` and `APP_VERSION` together.** `VERSION` is the file on
   disk. `APP_VERSION` lives inside `index.html` and renders the visible `v:
   X.Y.Z` badge. They must match. The release gate checks this.
4. **Update `RELEASE-NOTES.md`.** Add a section for the new version with the
   date, the change set, and any behaviour the user will notice.
5. **Run the release gate.** `bash tests/validate-release.sh` must print
   `RESULT=PASS` before you push anything. If it prints `RESULT=FAIL`, fix the
   failures and re-run. Do not push a release that does not pass the gate.
6. **Commit.** `git add` the changed files and commit on `main` with a clear
   message such as `Release GardenOS Location vX.Y.Z`.
7. **Annotate the tag.** `git tag -a "vX.Y.Z" -m "GardenOS Location vX.Y.Z"`
   using the same version. The deploy script handles the tag if you let it.
8. **Push.** Push both `main` and the tag. The deploy script does this.
9. **Wait for GitHub Pages.** Pages re-deploys after the push. Give it a minute
   before verifying.
10. **Verify the live site.** Run `bash scripts/verify-deployment.sh`. It
    checks that the site root serves the merged GardenOS app, that the
    `/location/` voice recorder still carries the `v: X.Y.Z` badge, that
    none of the demo strings or fake coordinates reappear, and that the
    root `sw.js` and `manifest.webmanifest` are served with the versioned
    cache name.

## Hard rules

- Never copy files out of an old zip over the working tree. The handoff package
  is a reference, not a deployment artifact. The previous `PUSH-TO-GITHUB.md`
  runbook did this and would have regressed the live app from the current
  release back to the previous one. Do not reproduce it.
- Never hardcode a version number in scripts, notes, or commit messages that
  should derive from `VERSION`. The scripts read `VERSION` at runtime.
- The release gate must print `RESULT=PASS` before any push. There is no
  exception. If it fails, the release is not ready.
- The tag must be annotated, not lightweight, and must match `VERSION`
  exactly.
- `APP_VERSION` (in `index.html`) and `VERSION` (the file) must always match.
  The release gate enforces this.

## What to do if something goes wrong

- **The version badge is wrong on the live site:** the service worker is
  serving old content. Bump the cache name in `sw.js`, redeploy, and verify
  on a fresh browser profile.
- **An old tag from a previous run is in the way:** the deploy script
  tolerates an already-existing tag. Re-run it; it will handle the conflict.
- **The release gate fails:** read the failure, fix the underlying problem,
  re-run. Do not push around the gate.
- **The live site shows the demo button or fake coordinates:** you have
  shipped the wrong content. Stop, revert the tag, fix the file, and re-run
  the full pipeline.
