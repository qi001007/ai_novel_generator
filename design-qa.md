# Design QA Report

**Final result:** `blocked`

## Evidence

- Source visual truth: `figma-workspace.png`
- Implementation screenshot: `implementation-workspace.png`
- Viewport: `1440 x 1024`
- Source pixels: `1440 x 1024`
- Implementation pixels: `1440 x 1024`
- Density normalization: 1:1
- State: writing tab, local demo data, chapter 42 selected
- Figma file: https://www.figma.com/design/zWDyGqBZxiIZEZIu9uzEPz

## Comparison

The implementation now follows the source design's primary information architecture: dark top bar, left novel rail, central manuscript workspace, and right records/controls rail. Typography, spacing rhythm, surface treatment, button hierarchy, and panel density are materially closer to the source.

## Findings

- [P2] AI seven-dimension review panel is missing
  - Location: right rail
  - Evidence: the Figma source has a dedicated AI review panel; the implementation only has generation/review records.
  - Impact: the author cannot see the required evidence-backed seven-dimension review state.
  - Fix: implement the AI review API response and surface it as a right-rail panel.

- [P2] Toolbar action set is narrower than the source
  - Location: editor toolbar
  - Evidence: source shows AI generation, machine validation, seven-dimension review, save, final review, and reject; implementation currently exposes a smaller action set.
  - Impact: the writing flow is usable, but the primary pipeline is not fully visible.
  - Fix: add the remaining pipeline actions as their backend services come online.

- [P2] Left navigation depth differs
  - Location: sidebar
  - Evidence: source includes planning, review, settings, foreshadowing, and feedback entry points; implementation currently emphasizes briefs and chapters.
  - Impact: secondary workspaces are reachable but less discoverable.
  - Fix: consolidate workspace navigation once all panels are polished.

## Intentional Differences

- The implementation deliberately keeps generation in the left rail because the current generation action depends on a selected D-layer brief.
- The right rail currently prioritizes settings and character cards because those are functional in v1; the source design's AI panel depends on unfinished backend behavior.

## Implementation Checklist

1. Implement LLM-backed draft generation.
2. Implement AI seven-dimension review generation.
3. Promote the review panel into the right rail.
4. Expand the editor toolbar as pipeline actions become real.
5. Add persistent left navigation once secondary panels are stable.

## Follow-up Polish

- Add empty, loading, and error states to all panels.
- Add responsive breakpoints below `1200px`.
- Add hover and focus states for card navigation.
- Replace raw enum status labels with human-readable labels.
