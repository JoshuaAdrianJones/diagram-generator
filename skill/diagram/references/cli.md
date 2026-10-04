# CLI and review workflow

Use `node <skill-directory>/scripts/launcher.mjs` followed by the commands below. The installed skill's `install.json` locates the application. All commands accept `--json`, return absolute artifact paths, and write logs to stderr. Treat command output as the source of candidate IDs and hashes.

Read the application's generated `schemas/diagram.schema.json` and `schemas/patch.schema.json` for exact fields. The TypeScript definitions in `src/schema.ts` generate those schemas. JSON files are internal artifacts. Do not ask the user to author them.

| Command | Purpose |
| --- | --- |
| `doctor --json` | Check runtime, fonts, browser, storage, and installed integration. |
| `validate --spec <path> --json` | Check an unsaved spec, including spec-only mode. |
| `create --spec <path> --json` | Save a new diagram without replacing an existing ID. |
| `validate --diagram <id> --json` | Validate a saved diagram. |
| `status --diagram <id> --json` | Read the current edit base and latest published revision. |
| `revise --diagram <id> --patch <path> --base <revision> --json` | Apply a validated patch against the expected current revision. |
| `render --diagram <id> --json` | Produce candidate geometry, SVG, PNG, and diagnostics. |
| `inspect --diagram <id> --revision <candidate> --json` | Capture that candidate's overview and readable details. |
| `capture --diagram <id> --revision <candidate> --region <region> --json` | Request an overview, an element region, or a document rectangle. |
| `publish --diagram <id> --revision <candidate> --review <path> --json` | Promote the exact reviewed candidate to the public latest revision. |
| `preview --diagram <id> --open --json` | Start or reuse the verified loopback server and open the stable URL. |
| `preview --stop --json` | Stop this application's verified preview server. |
| `export --diagram <id> --format svg,png --json` | Export the latest successful revision. |
| `history --diagram <id> --json` | Inspect saved revisions and the current base. |
| `restore --diagram <id> --revision <historical-revision> --json` | Create a candidate from history, preserving later revisions. |
| `cleanup --diagram <id> --age-days 7 --json` | Remove older failed inactive attempts while preserving head/public history. |

The `revisionId` returned by `create` or `revise` is the next expected base. Use `status --diagram <id>` when picking up an older diagram. `capture --region` accepts `overview`, a node/group/note/edge ID, or `x,y,width,height` in document coordinates. Capture scale ranges from 0.25 to 2. `inspect` can include `--debug --preview-page` for diagnostic and interface evidence.

Export supports `--scale 1` or `--scale 2`, `--background transparent` or a hexadecimal colour, and `--out <directory>`. An unpublished candidate needs explicit `--draft --revision <candidate>`, and its output filename includes `unverified`. Quote hexadecimal colours as separate argument values to avoid shell interpretation.

## Patch examples

Rename one concept with its stable ID. Preserve unrelated positions and seeds:

```json
{
  "schemaVersion": 1,
  "operations": [
    { "op": "updateNode", "id": "learning", "changes": { "label": "Shared learning" } }
  ]
}
```

For an explicit request to rearrange the whole map:

```json
{
  "schemaVersion": 1,
  "operations": [
    { "op": "setLayout", "layout": { "strategy": "cycle", "gap": 96, "relayout": true } }
  ]
}
```

`setLayout` and `setTheme` replace their objects. Preserve still-relevant existing fields when writing a patch. Element updates merge their supplied changes. Supported operations are add/update/remove for nodes, edges, groups, and notes, plus `setTitle`, `setLayout`, and `setTheme`. Removing a node with references requires `cascade: true`; do this only when the requested semantic edit includes those removals. Dissolving a populated group similarly needs explicit cascade.

## Screenshots and review record

Candidate artifacts are `spec.json`, `layout.json`, `diagram.svg`, `diagram.png`, `debug.svg`, `diagnostics.json`, and `screenshots.json`. `screenshots.json` contains `diagramId`, `revisionId`, `specHash`, `viewport`, `pixelScale`, and `images`. Each image has a path relative to the candidate directory, kind, document-coordinate rectangle, and associated finding IDs. Use the returned absolute path or resolve a manifest path against the candidate directory to open the image.

The overview is usually `screenshots/overview.png`; large maps may use multiple overview tiles. Detail images are `screenshots/detail-N.png`. Optional `debug.png` and `preview.png` show diagnostic bounds and the browser interface. Candidate `capture` images join its retained screenshot manifest and can supply additional reviewed detail evidence. Captures of published revisions stay separately under the data directory's `captures/` tree and do not change the existing review bundle. Review clean diagram pixels for exports, and use debug pixels to locate defects.

After you actually open the relevant images, write a review record such as:

```json
{
  "revisionId": "RETURNED_CANDIDATE_ID",
  "specHash": "RETURNED_SPEC_HASH",
  "inspectedImages": ["screenshots/overview.png", "screenshots/detail-1.png"],
  "geometryResults": [],
  "visualObservations": [
    {
      "ids": ["learning", "confidence", "learning-confidence"],
      "observation": "Both labels are readable. The confidence arrow ends at the intended node and its label is separate from the return path."
    }
  ],
  "repairAttempts": 0,
  "outstandingIssues": [],
  "status": "verified"
}
```

Replace the example IDs, hash, paths, and observations with the actual candidate and findings. Copy the candidate's geometry findings into `geometryResults`, including warnings. `inspectedImages` contains relative paths from the exact candidate's screenshot manifest. Do not list an image you did not open. Include every overview tile and relevant readable detail images. Record the number of repairs after the first render, from zero through three.

Each finding uses `severity`, `code`, `ids`, `message`, and `repairClasses`, with optional JSON `path` and document-coordinate `bounds`. `outstandingIssues` records any unresolved visual or geometry finding. Only `status: "verified"` can publish. Use `blocked` for unresolved visual blockers or `visual_review_unavailable` when the host cannot open images. A review is an audit record, not proof of visual correctness.

Publication rejects mismatched revision/hash, missing reviewed overview evidence, missing screenshot files, and blocking diagnostics. If capture reports an unexpected revision or hash, discard that evidence and recapture the requested candidate. After a patch, all review evidence must come from fresh screenshots of the new candidate.

Exit codes are `0` for success, `2` for schema/reference validation, `3` for layout blockers, `4` for dependencies/browser failures, and `5` for revision conflicts. A warning may accompany a successful command. Read the structured result rather than treating empty terminal output as success.

On a conflict, read the latest state and apply the user's intended change against that base. On a render/capture failure, keep the last successful public revision available. Failed attempts remain separate from public history. A user may explicitly request draft export, but that draft remains unverified.

## Canvas workflow

Use the same launcher with `canvas` before the command. Canvas commands require `--canvas <id>` where diagram commands require `--diagram <id>`. `create --spec`, `revise --patch --base`, `render`, `inspect --revision`, `publish --revision --review`, `preview --open`, `export`, `status`, `history`, `restore`, and `cleanup` follow the existing revision workflow. Canvas reviews use the same record fields. The screenshot manifest must include an inspected overview and every readable `frameId` detail tile.

Read the application schemas `canvas.schema.json`, `canvas-patch.schema.json`, `graph.schema.json`, and `graph-patch.schema.json` before writing version 2 documents. Use `canvas capture --canvas <id> --revision <candidate> --frame <id>` for another frame crop. `canvas export --canvas <id> --frame <id>` produces standalone SVG and PNG without explanatory links. `canvas add-diagram --canvas <id> --diagram <source-id> --revision <published-source> --frame <new-id> --base <canvas-head>` copies an exact published snapshot. Imported content does not synchronize.

A canvas review must inspect all frame tiles at readable scale, even if the overall overview is small. Record only images actually opened. Large canvas render PNGs may be reduced previews; SVG exports retain full resolution. Requested 1x/2x PNG exports that exceed the pixel limit fail explicitly. Keep source notes, real diagrams, captures, provenance, and review records in ignored local working directories or outside the repository.
