# One-shot prompt for the next coding LLM

**STATUS: COMPLETED by v0.4.1 (commit 19f0048, released as tag v0.4.1).**

This file is the original brief from the v0.4.0 handoff package, kept here for
provenance. It is NOT a pending to-do list. All 19 numbered steps below were
already delivered by v0.4.1. See `docs/MERGE-NOTES.md` for the integration
audit and `docs/RELEASING.md` for the current release runbook.

---

You have terminal access, GitHub access, and permission to modify and deploy this repository:

- Repository: https://github.com/taytus/gardenos-location-mvp
- GitHub Pages: https://taytus.github.io/gardenos-location-mvp/

Read all files in this handoff package first, especially:

- `HANDOFF.md`
- `PRD-001.md`
- `PRD-002.md`
- `PRD-003.md`
- `VERSION`
- `RELEASE-NOTES.md`

Then complete the following without asking follow-up questions:

1. Clone or open `taytus/gardenos-location-mvp`.
2. Inspect the current repository and deployed GitHub Pages site.
3. Determine whether the live app matches the current source.
4. Remove any remaining preview/demo behavior and hardcoded coordinates.
5. Ensure all production coordinates come only from the browser Geolocation API.
6. Implement reliable multi-reading GPS acquisition:
   - `enableHighAccuracy: true`
   - `maximumAge: 0`
   - `timeout: 20000`
   - keep the most accurate reading
   - stop early at 15 meters or better
   - show Excellent, Good, or Poor quality
7. Keep the main UI voice-first with one dominant record button.
8. Store audio and metadata in IndexedDB.
9. Make every coordinate card large and open Google Maps at the exact saved point.
10. Fix service worker caching so `index.html` updates promptly.
11. Choose the next semantic version after `0.4.0` based on repository state.
12. Render a visible header badge: `v: X.Y.Z`.
13. Keep `APP_VERSION`, `VERSION`, release notes, and service-worker cache version synchronized.
14. Update PRDs and README when implementation differs.
15. Run repository searches to confirm production code does not create demo records or hardcoded locations.
16. Commit to `main`, create an annotated tag, and push both.
17. Ensure GitHub Pages is configured from `main` and `/`.
18. Wait for deployment and verify the live page.
19. Report:
    - version
    - commit SHA
    - tag
    - live URL
    - files changed
    - validation results
    - any remaining browser limitations

Do not stop after editing files. Complete deployment and verify the live site.
