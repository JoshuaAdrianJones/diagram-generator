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

## Version 2 graphs and canvases

Version 1 remains accepted and retains its original rendering defaults. New graph documents use `schemaVersion: 2`, `kind: "graph"`, and the existing graph fields. Canvas documents use `schemaVersion: 2`, `kind: "canvas"`, `id`, `title`, and `frames`. The generated contracts are [graph.schema.json](../schemas/graph.schema.json), [graph-patch.schema.json](../schemas/graph-patch.schema.json), [canvas.schema.json](../schemas/canvas.schema.json), and [canvas-patch.schema.json](../schemas/canvas-patch.schema.json).

Graph `model` is `path`, `dag`, `network`, or `lanes`. It defaults to network. Paths must be a connected nonbranching directed sequence. DAGs must be directed and acyclic. Networks permit cycles, self-loops, reciprocal, undirected, and parallel relationships. A model does not create relationships. The default layouts are path, DAG layers, deterministic force placement, and lanes respectively. Explicit radial, cycle, flow, or manual layouts remain available. New `path`, `dag`, `force`, and `lanes` layout strategies supplement the legacy strategies. Fixed positions and pins remain hard constraints.

Nodes also accept `shape: "circle"`, `labelPosition: "inside" | "above" | "below" | "left" | "right"`, `caption`, `lane`, and `row`. Circle dimensions must agree when both are explicit. Outside labels and captions contribute to spacing and bounds. Lane graphs supply ordered `lanes: [{id,label,caption?}]` and optional `rows` in the same form. Every node requires a lane and, when rows are declared, a row. Horizon captions remain supplied text. They are not parsed as dates or durations.

Version 2 styles add `font: "sans"`, `highlight` as a supported colour, and `presentation: "plain" | "sticky"`. Sketch uses the existing Caveat and Bangers fonts. Clean uses bundled Noto Sans and zero roughness by default. Graph theme defaults override canvas defaults. A frame theme overrides its graph theme, and explicit element styles override the frame theme. A version 1 clean diagram retains its handwritten fonts. Imports materialize its font choices before converting it to version 2.

A graph frame has `{id,kind:"graph",graph}`. A panel frame has `{id,kind:"panel",blocks}`. Both accept `title`, `caption`, `position`, `width`, `height`, `theme`, and import `source: {diagramId,revisionId,specHash}`. Panel blocks use `kind: "heading" | "paragraph" | "quote" | "list"`, optional emphasis and style. Lists require `items`; other blocks require `text`. Panels contain inert plain text, not HTML or Markdown. Frames grow to contain measured content unless dimensions are explicit. Undersized frames block publication.

IDs are unique across frames, links, regions, and annotations. Graph element IDs are local to each frame. Canvas links have `{id,source:{frameId,elementIds?},target:{frameId},label,provenance?,style?}`. Provenance is `supplied` or `inferred`. Source element references may identify nodes, edges, groups, or notes. Dashed explanatory links connect frame boundaries; their selected source elements receive outlines. They do not become graph relationships or synchronize content.

Regions have `{id,title,shape,position,width,height,members,style?}`. Shapes are rectangle or ellipse. Members identify frames or other regions. Each member has at most one parent and containment must be acyclic. Membership is visual only. Nested members retain their independent graph models. Every frame placed in a region needs an explicit position. Canvas annotations have `{id,text,position,style?}`.

Canvas layout accepts `strategy: "grid" | "row" | "column" | "manual"`, `gap`, and `relayout`. New canvases default to a grid with up to three columns and 96 px gaps. Existing frame positions survive ordinary revisions. Explicit frame positions take precedence over packing. Manual compositions require explicit positions. Relayout applies to one revision. Graph relayout and canvas relayout are separate requests.

Canvas patches use `schemaVersion: 2`. Operations include add/update/remove for frames, links, regions, and annotations; `patchGraph: {id,patch,cascade?}`; `setPanel: {id,blocks}`; and `setTheme`, `setLayout`, `setTitle`. `updateFrame` changes placement, dimensions, captions, title, theme, and source metadata. Graph contents are changed through `patchGraph`. Graph patches use version 2 graph element operations, `setModel`, and `setLanes` in addition to the existing title/theme/layout operations. Removal requires cascade when references exist. Cascading region removal dissolves membership without deleting contained frames. Cascading graph element removal clears affected source references; a link becomes frame-wide if no selected elements remain.

Canvases have the same 2 MiB document limit and existing per-graph limits. A canvas may contain up to 100 frames, 100 regions, 500 links, and 500 annotations. Canvas bundles live in `canvases/<id>/attempts/<revision>` and `canvases/<id>/revisions/<revision>`. Their stored metadata retains `diagramId` internally for compatibility with the shared revision machinery. The canvas CLI reports `canvasId`.

Publication requires inspection of the canvas overview and all readable detail tiles for every frame. Screenshot manifests identify these tiles with `frameId`. Missing or stale coverage blocks publication. Review records retain the existing contract. Geometry errors block publication and a failed candidate leaves the previous reviewed revision available.

Imported graph frames also retain `initialLayout`, a validated snapshot of node/note coordinates and node/edge/group/note seeds from the selected published revision. Rendering uses it until the frame has its own saved layout. Derived placement is preserved without turning every imported node into a hard pin. Graph patches remove snapshot entries for deleted elements. New nodes can be positioned beside existing content, and explicit relayout still works.
