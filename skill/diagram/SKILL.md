---
name: diagram
description: Create and revise local diagrams and shared canvases with independent views, panels, lanes, and visual regions; inspect screenshots and return a browser preview plus SVG and PNG exports.
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

## Shared canvases and modeling choices

Use a version 2 canvas when the user requests several diagrams together, overview/detail views, comparison panels, scenario panels, time horizons, or nested models. Read the application canvas, canvas-patch, graph, and graph-patch schemas. Keep the specification internal. A canvas owns independent graph snapshots. Do not combine their edges into one graph or imply automatic synchronization. Explain abstraction changes with labeled canvas links whose source names the relevant frame and optional element IDs. Record link provenance as supplied or inferred.

Choose a model from the supplied relationships. Use path for a single nonbranching sequence, DAG for directed acyclic dependencies, network for feedback and other relationships, and lanes for explicitly supplied ordered horizons. Do not invent edges, omit cycles, or change direction to fit a model. Use independent overview and detail graphs when abstraction differs. Groups remain within a graph. Regions contain frames visually and do not define expandable models.

Default to sketch and a consistent theme. Use clean when requested. Choose a different per-frame theme only when it helps the requested comparison or the user asks. Circular nodes can have outside labels and captions. Panels support headings, paragraphs, quotations, and lists with emphasis. Time horizons remain supplied labels and captions, not inferred calendar dates. Concentric regions require explicit frame positions and clear labels.

Run `canvas create --spec`, or `canvas status --canvas` followed by `canvas revise --canvas --patch --base`. Import saved published diagrams with `canvas add-diagram` and an exact source revision. Ordinary revisions preserve unrelated frame and graph positions and sketch seeds. Moving a frame changes its canvas placement only. Request graph relayout through a targeted graph patch; request canvas relayout only to rearrange the composition.

Follow the existing render, inspect, repair, and publish workflow using `canvas` commands. Open the actual canvas overview and every frame detail tile in the screenshot manifest. Check each model's meaning, labels, arrow direction, captions, panel text, and layout. Also check frame overlap, explanatory-link ownership, source selection outlines, region containment, and canvas labels. Repair the affected frame or canvas placement without changing unrelated content. Capture another region if ownership or text cannot be checked at the supplied scale. Never record unread images as inspected.

Publish the exact candidate only after the overview and all frame tiles pass review. If blockers remain after three repairs, preserve the previous published canvas and report unresolved findings. Return the `/c/<id>` preview URL and canvas SVG/PNG exports. Export individual frames when requested; they omit canvas explanatory links. Keep subject matter, screenshots, and review records local.
