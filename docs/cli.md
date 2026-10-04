# Sketch diagram CLI

The user workflow is `$diagram` plus natural-language instructions. This reference is for debugging and implementation. Run `sketch-diagram <command> --help` for the installed options. Every command accepts `--json`, writes structured output to stdout, and logs to stderr. Returned artifact paths are absolute.

| Command | Result |
| --- | --- |
| `doctor` | Runtime, font, browser, writable data, and integration checks. |
| `create --spec <path>` | A saved candidate, rejecting an existing diagram ID. |
| `validate --spec <path>` | Validation without creating or rendering a diagram. |
| `validate --diagram <id>` | Validation of the current saved spec. |
| `status --diagram <id>` | Current edit revision, latest successful revision, and artifact paths. |
| `revise --diagram <id> --patch <path> --base <revision>` | A candidate after an atomic, validated patch. |
| `render --diagram <id>` | Candidate SVG/PNG, layout state, and geometry diagnostics. |
| `inspect --diagram <id> --revision <revision>` | Screenshots and a manifest for the exact revision/hash. |
| `capture --diagram <id> --revision <revision> --region <region>` | Additional overview, element, or rectangular capture. |
| `publish --diagram <id> --revision <revision> --review <path>` | Exact reviewed candidate becomes latest. |
| `preview --diagram <id> --open` | Start or reuse a verified local server and open its stable URL. |
| `preview --stop` | Stop this application's verified server. |
| `export --diagram <id> --format svg,png` | Exports of the selected public revision. |
| `history --diagram <id>` | Revision metadata without modifying history. |
| `restore --diagram <id> --revision <revision>` | New candidate referencing a historical revision. |
| `cleanup --diagram <id> --age-days <days>` | Remove older failed inactive attempts, keeping current head and public history. |

`create`, `revise`, and `restore` return the current edit `revisionId`. That ID is the expected `--base` for the next change. `status` finds it in a new session. The current edit head may be an unpublished candidate; `latest` means the most recent successfully reviewed public revision. A rerender of unchanged inputs does not create another public revision.

Capture `--region` accepts `overview`, an element ID, or a comma-separated rectangle `x,y,width,height` in document coordinates. `--scale` accepts values between 0.25 and 2. `inspect --debug --preview-page` adds diagnostic and interface captures. Overview and detail images come from the same SVG as the preview and exports, after fonts and the expected revision/hash are ready.

Export `--scale` accepts 1 or 2. `--background` accepts `transparent` or a hexadecimal colour. `--out` selects the destination directory. A candidate requires `--draft --revision <revision>` and its export filename includes `unverified`. Draft export does not change the public latest pointer.

Exit code `0` indicates success. `2` is validation failure, `3` a blocking layout defect, `4` a dependency/browser failure, and `5` a revision conflict. Warnings need not cause command failure. Failures include status, code, message, and actionable findings in JSON.

## Internal schemas and patches

The exact machine contract lives in [diagram schema](../schemas/diagram.schema.json) and [patch schema](../schemas/patch.schema.json), generated from `src/schema.ts`. Unknown properties fail validation. IDs are unique across all element kinds, have at most 64 characters, and use letters, digits, underscores, or hyphens. Documents are bounded at 2 MiB, 500 nodes, 2,000 edges, 100 groups, and 500 notes. Coordinates are finite within 100,000 units in either direction; dimensions are positive and at most 10,000 units. Fonts use `body` or `heading`; external font names and filesystem resources are not accepted.

Defaults and actual placement choices are visible in saved layout state. Supported shapes are `text`, `rectangle`, `roundedRectangle`, and `ellipse`. Directions are `forward`, `both`, and `none`; certainty is `asserted` or `hypothesis`; routing is `auto`, `straight`, `curve`, or `outside`. Layout strategies are `flow`, `radial`, `cycle`, and `manual`. The theme preset is `sketch` or `clean`. Explicit associations should use `none` rather than imply causation.

Patches have `schemaVersion: 1` and an `operations` array. Use add/update/remove operations for each element kind, plus `setTitle`, `setTheme`, and `setLayout`. See the [skill CLI reference](../skill/diagram/references/cli.md) for concrete patch and review examples. Updates merge supplied element changes; theme/layout operations replace their objects. Preserve fields you still want when replacing a theme/layout. A whole-map rearrangement uses `relayout: true`. A style-only change or rename should preserve unrelated positions and sketch seeds.

Deleting an attached node requires explicit `cascade: true`, which removes incident edges, attached notes, group membership, and layout/provenance references. Group cascade dissolves the group, leaves its nodes, and removes attached notes. The validator rejects unsupported nesting, invalid references, contradictory pins, and cyclic relative constraints.

## Review and publication

The skill validates, renders, opens the overview and readable detail crops with an image-viewing tool, and records concrete findings. It makes at most three layout/style repairs after the first render. Every repair needs new screenshots of its exact candidate. Semantic changes require user intent; they are not geometry repairs.

Review records contain `revisionId`, `specHash`, `inspectedImages`, `geometryResults`, `visualObservations`, `repairAttempts`, `outstandingIssues`, and `status`. Screenshot paths are relative to that revision directory and must occur in its manifest. Geometry and outstanding findings use severity, code, IDs, message, repair classes, and optional path/bounds. A verified review needs overview evidence and no outstanding blocking findings. `visual_review_unavailable` and `blocked` retain candidate evidence but cannot publish.

The CLI checks stale evidence, missing artifacts, exact hash, and blocking diagnostics before switching `latest.json`. It cannot establish that an agent actually inspected an image. The review is a record of the agent's work. Publication leaves the previous latest bundle usable on failure.

## Storage and cleanup

The default root is `~/Library/Application Support/sketch-diagram`, overridden by `SKETCH_DIAGRAM_DATA`. Files under `diagrams/<id>/attempts/<revision>/` are candidates. Files under `diagrams/<id>/revisions/<revision>/` are public history. Both contain `metadata.json` and `spec.json`; rendered bundles add `layout.json`, `diagram.svg`, `diagram.png`, `debug.svg`, `diagnostics.json`, and `screenshots.json`. Published bundles retain `review.json` and reviewed screenshots.

Use `cleanup --diagram <id> --age-days 7` to remove older failed inactive attempts. Cleanup preserves the current head and all public revisions. Candidate region captures join that candidate's screenshot manifest and may supply review evidence. Extra captures of an already published revision live under `captures/<id>/<revision>/<timestamp>/` and do not modify the retained review bundle. Portable revision contents use relative artifact paths; installation metadata alone records application paths.

The preview server exposes read-only diagram routes on loopback. It serves consistent published bundles with fresh metadata and revision-qualified assets. Labels are escaped text, and the spec cannot execute HTML, JavaScript, shell commands, or external resources.

## Shared canvases

Canvas commands use `sketch-diagram canvas <command>` and `--canvas <id>`. All data remains local in the configured data directory. Existing diagram commands also accept version 2 graph specs and patches.

```sh
sketch-diagram canvas create --spec <canvas-spec.json>
sketch-diagram canvas validate --spec <canvas-spec.json>
sketch-diagram canvas status --canvas <id>
sketch-diagram canvas revise --canvas <id> --patch <canvas-patch.json> --base <revision>
sketch-diagram canvas render --canvas <id>
sketch-diagram canvas inspect --canvas <id> --revision <candidate> --debug --preview-page
sketch-diagram canvas capture --canvas <id> --revision <candidate> --frame <frame-id>
sketch-diagram canvas publish --canvas <id> --revision <candidate> --review <review.json>
sketch-diagram canvas preview --canvas <id> --open
sketch-diagram canvas export --canvas <id> --format svg,png
sketch-diagram canvas export --canvas <id> --frame <frame-id> --background transparent --scale 2
sketch-diagram canvas history --canvas <id>
sketch-diagram canvas restore --canvas <id> --revision <published> --base <current>
sketch-diagram canvas cleanup --canvas <id> --age-days 7
```

`capture --region` accepts `overview` or `x,y,width,height`. `--frame` selects a frame crop. `inspect` captures every frame at readable scale and tiles large frames. A review must identify every generated frame tile and the overview. Published captures are written outside immutable revision bundles.

Canvas exports default to the latest published revision. Use `--draft --revision <candidate>` for an explicitly unverified export. `--out` selects the export directory. Frame exports omit canvas explanatory links and selection outlines. Fonts are embedded and text remains selectable. Export PNGs are 1x or 2x with the existing 32 megapixel and 16,000 pixel side limits. Preview PNGs may be reduced to fit those limits; the render result reports the canvas preview scale. SVG and readable tiled review remain available for large canvases.

Import an exact published diagram revision as an independent frame snapshot:

```sh
sketch-diagram canvas add-diagram --canvas <id> --diagram <diagram-id> --revision <published> --frame <new-frame-id> --base <canvas-head> --position 32,120
```

The position is optional for automatically arranged canvases. The imported graph retains source revision provenance and does not change when its source is edited. Browser previews use `/c/<id>` with frame selection, Fit frame, Overview, explanatory-link navigation, pan, zoom, refresh, and exports. The server remains read-only and bound to loopback.

`schema --out <directory>` now exports all six version 1 and version 2 schema files.
