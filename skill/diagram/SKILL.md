---
name: diagram
description: Create and revise local sketch concept maps and feedback loops from conversation or notes, inspect screenshots, and return a browser preview plus SVG and PNG exports.
---

# Diagram

Turn the user's model into a saved diagram with the installed `sketch-diagram` application. Keep the specification internal. The user gives natural-language instructions and receives a preview and exports.

Read [references/cli.md](references/cli.md) for commands, the review contract, and failure handling. Resolve the launcher relative to this skill's directory. Invoke `node <skill-directory>/scripts/launcher.mjs <command> --json`, with paths passed as separate arguments. The launcher finds the application through installation metadata and works from any current directory.

## Convert or revise

Identify the model and the question the map should answer from the current conversation, accessible attachments, or explicitly supplied local files. Do not assume access to another conversation. Latest explicit instructions win. Ask only if ambiguity changes the model's meaning, or if several saved diagrams are plausible revision targets.

Extract concepts, relationships, groups, and notes faithfully. Preserve explicit labels, direction, uncertainty, and line breaks. An association defaults to `direction: "none"`. A hypothesis uses `certainty: "hypothesis"`, whether the user supplied it or you inferred it. Record content inferences separately in provenance. Do not add causal arrows, reword relationship labels, omit content, or reverse direction to make a layout easier.

For a concept map, use its focus question to select and organise the supplied concepts. A labelled relationship should read as a meaningful proposition. These heuristics follow Novak and Cañas. Keep model fidelity separate from visual readability, following Munzner's validation approach. [references/design.md](references/design.md) contains the sources and practical guidance.

Use stable IDs and the application's schemas. `install.json` records the application root. Read `<application-root>/schemas/diagram.schema.json` when translating the model, and `<application-root>/schemas/patch.schema.json` for revisions. Choose a supported initial layout and default sketch theme. Ordinary revisions preserve positions and seeds. Set an explicit relayout request only when the user asks to rearrange the map. Use a small local position or routing patch for repairs, with pinned positions treated as hard constraints.

For a new diagram, write the specification to an accessible temporary file and run `create --spec <path>`. For a revision, use `status --diagram <id>` and inspect the current spec/layout, write a validated patch, and run `revise --diagram <id> --patch <path> --base <revision>`. Preserve unrelated content. A stale base is a conflict to resolve, not permission to overwrite.

If the user asks for `spec-only`, write and validate the specification with `validate --spec <path>`. Return its location and any material ambiguity. Do not render, capture, publish, or start the preview in this mode.

## Render, inspect, and publish

1. Run `render --diagram <id>` and retain the returned candidate revision ID, spec hash, and absolute artifact paths. Run `inspect --diagram <id> --revision <candidate-id>` for diagnostics and screenshots of that exact candidate.
2. Read the screenshot manifest. Open the actual overview image with the host image-viewing tool, such as `view_image`, and open relevant detail images at a scale where labels are readable. Large tiled overviews require inspection of every overview tile. Open detail crops for reported problems and dense areas. Use `capture` to request more regions if the existing images cannot verify label ownership or arrow direction. Generating an image or listing its path does not count as looking at it.
3. Check semantic fidelity, legibility, whitespace, clipping, overlap, arrow endpoints/direction, parallel-edge distinction, relationship-label ownership, group boundaries, notes, title, and full bounds. Combine your observations with geometry findings. Record concrete issues with element IDs.
4. Apply the smallest layout/style patch that addresses a defect. Rewording a label, reversing an arrow, removing a concept, hiding an edge, or turning an association into causation is a semantic change. Never perform one as a layout repair. Render and inspect fresh images after each repair. Earlier images cannot verify a later candidate.
5. Allow up to three repair cycles after the first render. If blockers remain, preserve the last published revision and return the candidate/debug artifacts with unresolved status. If image viewing is unavailable, report `visual_review_unavailable`; retain screenshots and diagnostics, and do not publish as verified. Do not add a paid vision API or use image generation.
6. When the candidate passes, write the review record specified in [references/cli.md](references/cli.md). Include only images you actually opened, geometry results, observations, repair attempts, and outstanding issues. Record the exact candidate ID and spec hash. Run `publish --diagram <id> --revision <candidate-id> --review <path>`. A rejection requires fixing the reported issue and inspecting the resulting candidate.
7. Run `preview --diagram <id> --open` and `export --diagram <id> --format svg,png`. Return the working URL, absolute export links, and any material inference or unresolved warning. Keep the response brief. The user never needs to paste JSON.

The CLI's review checks prevent stale publication and missing evidence. They cannot prove that you looked at an image. Your review record must describe the work you actually did.
