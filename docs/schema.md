# Specifications, patches, and revisions

The diagram skill writes JSON for the CLI. You only need this contract when debugging or building another integration. TypeScript and JSON Schema share one definition in `src/schema.ts`. Run `sketch-diagram schema` after changing that definition to refresh `schemas/diagram.schema.json` and `schemas/patch.schema.json`.

Specifications require `schemaVersion: 1`, `id`, `title`, and at least one node. Unknown properties fail validation. IDs contain ASCII letters, numbers, underscores, and hyphens. The first character must be a letter or number. IDs have at most 64 characters and must be unique across nodes, edges, groups, and notes. A diagram ID identifies saved data independently of its title.

`subtitle`, `legend`, `edges`, `groups`, `notes`, `layout`, `theme`, and `provenance` are optional. Titles and group titles have at most 1,000 characters. Labels, notes, subtitles, legends, source summaries, and unresolved questions have at most 4,000 characters. Explicit line breaks remain part of the text. Display text never becomes HTML or JavaScript.

The JSON document limit is 2 MiB. A diagram may have at most 500 nodes, 2,000 edges, 100 groups, and 500 notes. Coordinates must be finite numbers between -100,000 and 100,000. Explicit dimensions must be positive and at most 10,000 pixels.

| Element | Fields and supported values |
| --- | --- |
| Node | `id`, `label`, optional `shape`, `group`, `style`, `width`, `height`, `position: {x,y}`, and `pinned` |
| Shape | `text`, `rectangle`, `roundedRectangle`, `ellipse` |
| Edge | `id`, `source`, `target`, optional `direction`, `label`, `certainty`, `routing`, and `style` |
| Direction | `forward`, `both`, `none` |
| Certainty | `asserted`, `hypothesis` |
| Routing | `auto`, `straight`, `curve`, `outside` |
| Group | `id`, `title`, `members`, optional `boundary`, `fill`, and `style` |
| Boundary | `solid`, `dashed`, `none` |
| Note | `id`, `text`, optional `attachTo`, `position`, and `style` |

Edges reference existing nodes. Parallel edges and self-loops are legal. Groups contain node IDs only. A node belongs to at most one group. If a node also supplies `group`, that group's `members` must include the node. Notes attach to a node ID, a group ID, the diagram ID, or the reserved target `diagram`. An omitted attachment makes the note a diagram annotation.

Style fields are `font`, `fontSize`, `stroke`, `fill`, `roughness`, `strokeWidth`, and `emphasis`. Fonts are `body` or `heading`. Emphasis is `normal`, `strong`, or `muted`. Font sizes range from 12 to 96 pixels. Stroke widths range from 0.25 to 8 pixels. Roughness ranges from 0 to 3. Colours must be hexadecimal with 3, 6, or 8 digits, `transparent`, or `none`. These limits apply to theme overrides as well as individual elements.

The theme accepts `preset: "sketch"` or `preset: "clean"`, `background`, and the style fields. Presets provide defaults. Explicit overrides take precedence. The renderer applies defaults without adding fields to the saved specification. This keeps the specification hash tied to its actual contents.

Layout fields are `strategy`, `orientation`, `gap`, `order`, `alignment`, `relative`, `fixed`, `pins`, and `relayout`. Strategies are `flow`, `radial`, `cycle`, or `manual`. Orientation is `horizontal` or `vertical`. Alignment is `start`, `center`, or `end`. Gap ranges from 16 to 1,000 pixels.

`order` is an ordered list of distinct node IDs. `relative` accepts up to 1,000 constraints shaped as `{nodeId,relativeTo,direction,gap}`. Directions are `left`, `right`, `above`, or `below`. Relative gap ranges from 0 to 1,000 pixels. Relative constraints must form an acyclic placement order. `fixed` accepts up to 500 `{nodeId,x,y}` positions, with at most one per node. `pins` lists node IDs that already have a node position or a fixed constraint. Conflicting fixed positions or relative directions fail validation. The renderer reports collisions between hard pins instead of moving them.

`relayout: true` requests a new arrangement for that revision. The next ordinary patch clears this flag. Existing coordinates and sketch seeds otherwise come from the companion layout state. Explicit width or height constraints can still fail geometry checks if they cannot contain the measured text.

The renderer's initial defaults are flow layout, horizontal orientation, an 80 pixel gap, rounded rectangles, forward edges, asserted certainty, automatic routing, dashed group boundaries, and the sketch theme. Body labels use the bundled handwritten font at 24 pixels. Relationship labels and notes use 22 pixels. Titles use the bundled comic font at 32 pixels, with group titles at 25 pixels. Nodes have 16 pixel padding. The default stroke is `#28303a`, fill is white, stroke width is 1.5 pixels, and roughness is 0.6. The layout engine measures those fonts before placement. Defaults come from the renderer rather than JSON Schema.

Provenance accepts `supplied`, `inferred`, `unresolvedQuestions`, and `sourceSummary`. Supplied and inferred arrays reference existing element IDs, with at most 3,100 entries each. An ID cannot occur in both. A user-supplied relationship may still have hypothesis certainty. Provenance and certainty describe different things.

```json
{
  "schemaVersion": 1,
  "id": "feedback-map",
  "title": "A synthetic feedback model",
  "nodes": [
    {"id": "practice", "label": "Practice"},
    {"id": "learning", "label": "Learning"}
  ],
  "edges": [
    {"id": "learn", "source": "practice", "target": "learning", "label": "builds", "direction": "forward"},
    {"id": "feedback", "source": "learning", "target": "practice", "label": "may improve", "certainty": "hypothesis", "routing": "outside"}
  ],
  "layout": {"strategy": "flow", "gap": 96},
  "theme": {"preset": "sketch"}
}
```

Patches require `schemaVersion: 1` and an `operations` array with 1 to 1,000 operations. Operations execute in order, then the CLI validates the whole resulting specification. A failed patch leaves saved data unchanged.

| Operation | Required payload |
| --- | --- |
| `addNode`, `addEdge`, `addGroup`, `addNote` | A complete `node`, `edge`, `group`, or `note` object |
| `updateNode`, `updateEdge`, `updateGroup`, `updateNote` | `id` and `changes`, with allowed fields excluding `id` |
| `removeNode`, `removeGroup` | `id`, optional `cascade` |
| `removeEdge`, `removeNote` | `id` |
| `setTheme` | `theme`, replacing the theme object |
| `setLayout` | `layout`, replacing the layout object |
| `setTitle` | `title`, optional `subtitle` and `legend` |

Removing a node with edges, notes, or group membership requires `cascade: true`. Cascade also removes placement and provenance references. Removing a populated group requires cascade, which dissolves membership and removes notes attached to the group. It preserves the member nodes.

```json
{
  "schemaVersion": 1,
  "operations": [
    {"op": "updateNode", "id": "learning", "changes": {"label": "Learning from feedback"}}
  ]
}
```

Each mutation requires the current working head as its expected base revision. The working head may be an unpublished candidate. The latest successful revision is a separate pointer used by the preview. This lets repairs continue without replacing the public diagram. A stale base fails with exit code 5. An unchanged patch returns the existing revision. Rendering a published revision reuses its immutable artifacts.

Candidates live in `diagrams/<id>/attempts/<revision>`. Successful bundles live in `diagrams/<id>/revisions/<revision>`. Revision IDs use the form `r000001`. Failed attempts may leave gaps in successful history. Restoring a successful revision creates a new candidate with `restoredFrom` metadata. It keeps all later successful revisions.

Publication requires the exact candidate hash, all render artifacts, a current screenshot manifest, and a verified review that identifies the overview image actually inspected. Geometry errors or outstanding errors block publication. The CLI cannot prove that an agent looked at the images. The review is an audit record of its observations. Publication stages the complete bundle before atomically updating `latest.json` under a per-diagram lock.
