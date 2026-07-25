# Repository and deployment state

This document records what was checked and what was established. The
open question that this file used to pose is no longer open.

## Verified facts

- Repository: `taytus/gardenos-location-mvp`
- Public site: https://taytus.github.io/gardenos-location-mvp/
- GitHub Pages is configured with:
  - branch: `main`
  - path: `/` (repository root)
  - HTTPS enforced: yes
- Current shipped version: `0.4.1`
- Current release commit on `main`: `19f0048` ("Release GardenOS
  Location v0.4.1")
- Current annotated tag: `v0.4.1`
- Live site at the time of writing matches `main` and shows the
  visible badge `v: 0.4.1`.

## Where the old demo UI came from (resolved)

The screenshot that showed `GardenOS Voice`, `Capture now. Understand
later.`, a `Run preview demo` button, and no visible version badge
corresponds to the very first commit of the project: `1a41e60`
("Initial GardenOS location MVP"). It was the initial MVP preview
build, not a release.

That preview was removed in commit `8471a6c` ("Force deploy GardenOS
Location v0.4.0"). The demo button and the hardcoded fake coordinates
`36.3990` and `-92.9099` are already removed from `main`. They are
not in the live site today.

`v0.4.1` is what is live now.

## Service worker and manifest (resolved)

Before v0.4.1, `sw.js` and `manifest.webmanifest` did not exist.
Both paths returned HTTP 404 on the live site. No service worker was
ever involved in serving stale code, because no service worker was
ever registered. The PWA install prompt and offline shell did not
work prior to v0.4.1; they work now.

`sw.js` was first added in the v0.4.1 release commit. Its cache is
named after the app version, deletes older caches on `activate`, and
applies network-first to navigation requests and `index.html`, with
cache-first for other same-origin static assets.

## Pre-existing repo defect (recorded, not fixed here)

The annotated tag `v0.4.0` points at commit `673bfdd` ("Improve GPS
reliability and map debugging"), not at `8471a6c` which is the actual
v0.4.0 release commit. The tag was created at `673bfdd` and was
never moved. Moving a published tag is a repository-owner decision
and is not part of this slice.

## How these findings were established

The following commands were used to confirm the current state of the
repository and the live site. They are recorded here as evidence, not
as a checklist for the next reader.

```bash
git -C /Users/taytus/Projects/gardenos-location-mvp log --oneline --decorate -10
git -C /Users/taytus/Projects/gardenos-location-mvp show --stat 1a41e60
git -C /Users/taytus/Projects/gardenos-location-mvp show --stat 8471a6c
git -C /Users/taytus/Projects/gardenos-location-mvp tag --list
git -C /Users/taytus/Projects/gardenos-location-mvp show v0.4.0 --no-patch
```

The presence of `sw.js` and `manifest.webmanifest` on `main` and
their absence from every ancestor prior to the v0.4.1 release was
confirmed by walking the history of `main`. The fake coordinates
`36.3990` and `-92.9099` and the string `Run preview demo` are not
present in `index.html`, `sw.js`, `manifest.webmanifest`,
`RELEASE-NOTES.md`, `README.md`, or any PRD file at the current
`HEAD`. This is enforced mechanically by
`tests/validate-release.sh`.

The live site was checked with `curl` against
`https://taytus.github.io/gardenos-location-mvp/` and found to
contain the visible `v: 0.4.1` badge and the documented Google Maps
link form, and not to contain the preview demo strings or the fake
coordinates.

## What this means for the next maintainer

Nothing in this document represents an open investigation. The
demo-UI mystery is resolved. The stale-service-worker possibility is
resolved. The current release is `v0.4.1` at commit `19f0048`, the
service worker and manifest are present, and the release validator
keeps it that way.