# Workspace switching stability — 2026-10-17

Normal in-feature updates retain the current viewport and stable input focus/caret. New feature navigation clears the temporary viewport floor and starts at the top. Explicit anchors and invalid-field location remain available.

The shared synchronous view transaction reserves only enough height for the current viewport, disables native anchoring on the updated region, and restores position only if the synchronous update moved it. Async results capture position at the actual DOM write, never before the request. Native disclosure toggles use the same transaction. Existing focused inputs are left untouched to avoid interrupting composition.

Coverage: local/account projects, assets, tasks; writing and thesis steps; literature; research; presentation; formatting; revision/detection; membership and payment views; settings; help; account draft editing. No backend, payment settlement, pricing, model, or generation logic changes.

Validation:
- Build, syntax checks, and all 797 automated tests passed.
- Isolated local UI fixture; no real payments or model generation.
- Native browser interaction: research pro → formula at scrollY 128 → 128.
- PPT AI → proposal at scrollY 128 → 128; disclosure open and close 128 → 128.
- Help result refresh while search already focused: 148 → 148, focus and caret retained.
- Graduation writing steps 1 → 2, 2 → 3, and 3 → 4 each 561.3333 → 561.3333.
- Screenshot: workspace-stable-switching-2026-10-17.png.

Browser automation can scroll controls into view before clicking/focusing them. Measurements use native controls already in view to separate that behavior from application updates.
