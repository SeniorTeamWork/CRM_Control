# CRM Design Consistency Plan

**Goal:** Make the CRM feel consistent across pages while preserving its existing blue identity and workflows.

**Architecture:** Tune the shared app content wrapper and add conservative global refinements in `src/styles/global.css`. Keep page-specific layouts and behavior intact; scope generic rules to shared shell/components and add responsive overflow safeguards.

**Tech Stack:** React, existing CSS, Tailwind utility classes.

**Spec:** User request “Butun CRM sayti”; prior reference screenshots define the existing blue CRM visual language.

## Global Constraints

- Preserve existing sales, inventory, and navigation behavior.
- Keep current brand colors and theme variables.
- Do not add dependencies or tests.

## Review Focus

- Wide screens: content should use available space without excessive side gutters.
- Small screens: shared shell should avoid horizontal overflow.
- Dark theme: shared surfaces should continue using theme variables.
- Custom POS/modal styles: global control refinements must not resize specialized controls unexpectedly.

### Task 1: Shared page width and spacing

**Files:** Modify `src/App.jsx`, `src/styles/global.css`.

- [x] Replace the inline default content width with a shared `app-page-content` class capped at 1600px; keep POS and drafts fluid.
- [x] Add responsive shell gutters that tighten on tablet/mobile while preserving POS-specific sizing.
- [x] Inspect diff for unchanged page-routing and interaction logic.

### Task 2: Shared controls and responsive polish

**Files:** Modify `src/styles/global.css`, `src/components/Sidebar.jsx`, `src/components/Sidebar.css`, `src/components/Topbar.jsx`, `src/components/Topbar.css`.

- [x] Normalize only `.input-base`, `.btn-primary`, and `.btn-ghost` heights, radii, and focus/disabled states.
- [x] Refine the shared light/dark surface tokens, page heading/card treatment, sidebar navigation states, and topbar search surface.
- [x] Add safe min-width/overflow handling for shared app content without forcing all tables or page-specific cards into a new layout.
- [x] Run `git diff --check` on changed source files; do not run tests/build.

**Verification:** `git diff --check -- src/App.jsx src/styles/global.css docs/superpowers/plans/2026-11-05-crm-design-consistency.md` completed without whitespace errors. Tests/build were not run per project instructions.
