# Merge Notes: v0.4.0 Handoff Package into v0.4.1 Repo

This document records the audit of integrating the `gardenos-location-v0.4.0.zip`
handoff package into the GardenOS Location repository, which had already moved
on to v0.4.1.

## Source package

The handoff package was provided as a single ZIP file with a `SHA256SUMS.txt`
inside it. The package contained 13 files:

- `index.html`
- `VERSION`
- `RELEASE-NOTES.md`
- `PRD-001.md`
- `PRD-002.md`
- `PRD-003.md`
- `HANDOFF.md`
- `REPO-STATE.md`
- `ONE-SHOT-LLM-PROMPT.md`
- `PUSH-TO-GITHUB.md`
- `deploy.sh`
- `verify-deployment.sh`
- `SHA256SUMS.txt`

All 12 listed entries (every file except `SHA256SUMS.txt` itself) verified OK
against the package's own `SHA256SUMS.txt` using `shasum -a 256 -c
SHA256SUMS.txt`. The checksum verification was the gateway to the integration
work below.

## Decision table

| File | Decision | Why |
|------|----------|-----|
| `index.html` | KEPT REPO VERSION (v0.4.1) | byte-identical to commit `8471a6c` (v0.4.0); strictly older than main |
| `VERSION` | KEPT REPO VERSION (0.4.1) | byte-identical to commit `8471a6c`; strictly older than main |
| `RELEASE-NOTES.md` | KEPT REPO VERSION (v0.4.1) | byte-identical to commit `8471a6c`; strictly older than main |
| `PRD-001.md` | KEPT REPO VERSION | byte-identical to commit `8471a6c` |
| `PRD-002.md` | KEPT REPO VERSION | byte-identical to commit `8471a6c` |
| `PRD-003.md` | KEPT REPO VERSION | byte-identical to commit `8471a6c` |
| `HANDOFF.md` | INTEGRATED (as `docs/HANDOFF.md`, updated by another ranger) | refit for v0.4.1, not blind-copied |
| `REPO-STATE.md` | INTEGRATED (as `docs/REPO-STATE.md`, updated by another ranger) | refit for v0.4.1, not blind-copied |
| `ONE-SHOT-LLM-PROMPT.md` | INTEGRATED (as `docs/ONE-SHOT-LLM-PROMPT.md`, archived) | all 19 steps were already done by v0.4.1 |
| `PUSH-TO-GITHUB.md` | NOT INTEGRATED | would copy v0.4.0 files over the live v0.4.1 app and re-tag |
| `deploy.sh` | INTEGRATED (as `scripts/deploy.sh`, rewritten by another ranger) | the handoff version was written for v0.4.0 |
| `verify-deployment.sh` | INTEGRATED (as `scripts/verify-deployment.sh`, rewritten by another ranger) | the handoff version was written for v0.4.0 |
| `SHA256SUMS.txt` | NOT CARRIED INTO REPO | used for verification only; describes the old package, not the current release |

## The identical-files finding

Six files in the ZIP are byte-identical to commit `8471a6c` (the v0.4.0 release
commit) and were therefore deliberately NOT copied over the repo:

- `index.html`
- `VERSION`
- `RELEASE-NOTES.md`
- `PRD-001.md`
- `PRD-002.md`
- `PRD-003.md`

These six files were confirmed byte-for-byte identical to their counterparts in
the repository at commit `8471a6c` via `git show 8471a6c:<file> | shasum -a 256`
compared against the handoff ZIP's files. The hashes match exactly:

- `index.html`: `5f9418e500569f7eaefffbdaeb71f92d37ca636fa60a67560185af4e2201f040`
- `VERSION`: `40b8eb4000a913a7791090535f291d3d369874162a89ef3c9e3d4e887a1b9e79`
- `RELEASE-NOTES.md`: `62c140dc729f9875f42a10b89d9135db78db1f65801d162d9ebc6a680fd02b29`
- `PRD-001.md`: `7d818c5ba74758adfee600ceb0b4d8244a64e5549a81365df0b47c8215ae51a4`
- `PRD-002.md`: `8051928e5c01d39a84606f941764dd77f444e4882daa7e69986de36a2d09e64a`
- `PRD-003.md`: `1e19d1c47f6528c412588bdbf4a8cb92629319591d115a024a7dd31657da7266`

Commit `8471a6c` ("Force deploy GardenOS Location v0.4.0") is an ancestor of
the current `main` (`19f0048`, v0.4.1). The repository has since shipped v0.4.1,
which added `sw.js`, `manifest.webmanifest`, the multi-reading GPS acquisition
loop, the `Excellent` / `Good` / `Poor` quality labels, the Google Maps link
format, and the `v: 0.4.1` version badge. None of those things are in the ZIP.
The ZIP is therefore strictly older than what is on `main` now.

Because of this, the live app was kept on v0.4.1 and was NOT overwritten back
to v0.4.0. No previous GPS or voice-recording work was lost: that exact content
is preserved in git history at commit `8471a6c` and reachable from `main`.

## PUSH-TO-GITHUB.md was deliberately not integrated

`PUSH-TO-GITHUB.md` was deliberately NOT integrated. Following that runbook
would:

1. `cp` the package's `index.html` (and other listed files) directly over
   the working tree, regressing the live app from v0.4.1 back to v0.4.0.
2. `git tag -a "v0.4.0"` and `git push origin "v0.4.0"`, which would either
   re-push a tag that already exists (with a different commit) or overwrite the
   remote tag.

The dangerous runbook was therefore not followed and its `cp
/tmp/gardenos-location-v0.4.0/index.html` instruction does not survive anywhere
in the repository. The new release runbook is `docs/RELEASING.md`.

## SHA256SUMS.txt was used for verification, then left in the handoff

`SHA256SUMS.txt` was used to verify the handoff ZIP (all 12 entries OK) and was
not carried into the repository. It describes the v0.4.0 package, not the
current v0.4.1 release, so it has no ongoing role in the repo.

## Pre-existing defect: the v0.4.0 tag is misplaced

The annotated tag `v0.4.0` points at commit `673bfdd` ("Improve GPS reliability
and map debugging") rather than at the actual v0.4.0 release commit `8471a6c`
("Force deploy GardenOS Location v0.4.0"). This is a pre-existing defect not
caused by this integration work.

The tag was left unchanged. Moving a published annotated tag is the repository
owner's call; it changes downstream fetches and would silently rewrite what
other tooling sees as the v0.4.0 release. Recording it here is the correct
action for this slice.

## ONE-SHOT-LLM-PROMPT.md was archived as completed

The handoff's `ONE-SHOT-LLM-PROMPT.md` enumerates 19 steps covering demo
removal, GPS acquisition, recording, PWA service worker, version badge, and
deployment. All 19 steps were already completed by v0.4.1 (commit `19f0048`).
The file is therefore archived at `docs/ONE-SHOT-LLM-PROMPT.md` with a header
marking it completed, kept as a record of the original brief rather than as
pending work.
