# Sketch Diagram

Create and revise sketch concept maps and feedback loops from natural-language prompts in Codex. The included `diagram` skill builds a diagram specification, runs the local renderer, inspects screenshots, and repairs layout before publishing a reviewed revision. Open the result in a local browser or export SVG and PNG.

The renderer uses TypeScript, Rough.js, bundled fonts, and Playwright. Rendering and storage run locally. Codex handles the language reasoning in your session.

## Example sketches

These images were rendered by this tool from generic synthetic [fixtures](fixtures/). They contain no user subject matter.

### Concept map

Text, different node shapes, labelled relationships, colour, and a dashed hypothesis connection.

![Concept map connecting a focus question, concepts, relationships, and evidence](docs/images/concept-map.png)

Example prompt:

> Use $diagram to map a focus question, concepts, relationships, and evidence. The question guides concept selection. Concepts and relationships have an undirected connection labelled “connected by”. Relationships are tested against evidence. Mark that last connection as a hypothesis.

[Source fixture](fixtures/concept-map.json)

### Feedback loop

A cycle layout with directed relationships and a curved return connection.

![Learning loop from Observe to Interpret to Experiment and back to Observe](docs/images/feedback-loop.png)

Example prompt:

> Use $diagram to draw a learning loop. Observe leads to Interpret, labelled “make sense of”. Interpret leads to Experiment, labelled “choose a test”. Experiment returns to Observe, labelled “learn from results”.

[Source fixture](fixtures/cycle.json). This example has an edge crossing. Automatic layouts can need manual routing or a different arrangement.

### Groups and notes

A dashed group boundary, an attached note, and a hypothesis connecting the model to an evidence check.

![Grouped local notes and a conceptual model, with an attached caution note and an evidence check](docs/images/groups-and-notes.png)

[Source fixture](fixtures/groups-notes.json)

Prompts illustrate the intended content. Exact placement can vary with the generated specification.

## Quick start

The installation workflow targets macOS. Other operating systems have not been verified. Requirements:

- Node.js `>=22.19.0 <27` and npm.
- Codex with support for skills, local commands, and image inspection.
- Internet access to install dependencies and Playwright Chromium.

Clone the repository and run:

```sh
git clone https://github.com/JoshuaAdrianJones/diagram-generator.git
cd diagram-generator
npm ci
npm run build
npm run browser:install
npm run install:local -- --json
```

The installer copies the [diagram skill](skill/diagram/SKILL.md) into `${CODEX_HOME:-~/.codex}/skills/diagram`, links it at `~/.agents/skills/diagram`, and links `sketch-diagram` at `~/.local/bin/sketch-diagram`. It preserves unrelated skills and refuses path collisions. Preview the installation with `npm run install:local -- --dry-run`.

Restart Codex if the skill does not appear. Invoke `$diagram` or select Diagram in the skill picker. A custom `/diagram` slash command is not registered.

If `~/.local/bin` is on your PATH, check the installation with:

```sh
sketch-diagram doctor --json
```

Otherwise, use `node bin/sketch-diagram.mjs doctor --json` from the repository directory. The installed skill launcher works independently of PATH and your current directory.

## Create and revise

Use one of the prompts above to create a diagram. The skill handles the JSON specification, rendering, screenshot review, and exports.

To revise the learning loop:

> Use $diagram to rename Experiment to Try a change in the diagram we just made. Keep the arrangement.

Ordinary revisions preserve unrelated positions and sketch seeds. Request a new layout explicitly when you want the whole diagram rearranged. Ask for `spec-only` to inspect the internal JSON without rendering.

The workflow is: convert input, validate, render, inspect actual images, repair if needed, then publish the reviewed revision. A failed candidate leaves the last published revision available. Here, publication means selecting the current revision in local storage.

## Preview and export

```sh
sketch-diagram preview --diagram <id> --open
sketch-diagram export --diagram <id> --format svg,png --scale 2
sketch-diagram preview --stop
```

The preview binds to `127.0.0.1` and reports its actual port. Each diagram has a stable URL with refresh, pan, zoom, Fit, export buttons, and optional diagnostics.

SVG exports embed bundled fonts and retain selectable text. PNG exports support 1x and 2x scale. Use `--background transparent` or a hexadecimal colour such as `--background '#ffffff'`.

See the [CLI reference](docs/cli.md) for commands, draft exports, revision history, review records, and failure codes. The [schema reference](docs/schema.md) describes the specification format.

## Data and privacy

Saved diagrams default to `~/Library/Application Support/sketch-diagram`. Set `SKETCH_DIAGRAM_DATA` to another absolute directory outside the repository to change the location. The installer also accepts `--data-dir <directory>`.

Each successful revision retains its specification, layout, exports, diagnostics, screenshots, and review. Restoring an older revision creates a new candidate and preserves history. To remove old failed attempts without deleting published revisions:

```sh
sketch-diagram cleanup --diagram <id> --age-days 7
```

Keep user subject matter out of GitHub, including private repositories. Store private notes, real diagram specifications, and working images outside the repository or under ignored `.local/`. `.installation.json` and generated `artifacts/` are also ignored. Only generic synthetic examples belong in committed documentation and fixtures. [AGENTS.md](AGENTS.md) defines the repository rules.

Rendering, preview, capture, and export use local resources after installation. No renderer API key or CDN is required. Codex session processing is separate from the local renderer.

## Capabilities and limits

- Text nodes, rectangles, rounded rectangles, ellipses, groups, and attached notes.
- Directed, undirected, and bidirectional relationships, parallel connections, curves, return loops, and self-loops.
- Flow, radial, cycle, and manual layouts, with pinned positions and local repair.
- Stable revisions, screenshot review, and self-contained SVG and PNG exports.

There is no drag editor, hosted service, collaboration, Miro synchronisation, or specialised matrix, roadmap, or opportunity-tree layout. Dense diagrams can remain crowded, and paths can cross. The skill attempts up to three repairs and reports unresolved blockers. Geometry checks support image inspection. A review record cannot prove that an agent looked at its images.

Bangers provides headings and Caveat provides body labels. Both fonts are bundled with their [SIL Open Font License notices](assets/fonts/). Missing fonts or unsupported glyphs produce explicit failures.

## Development

```sh
npm ci
npm test
```

`npm test` builds the TypeScript sources and runs schema, storage, renderer, and browser integration tests. Browser tests need Chromium installed with `npm run browser:install`. Installer changes also require:

```sh
npm run test:integration-install
```

Use synthetic fixtures and isolate test data from saved user diagrams. Source code lives in `src/`, schemas in `schemas/`, and the canonical skill in `skill/diagram/`.

## Update and uninstall

After updating the source, run `npm ci`, `npm run build`, and `npm run install:local`. Reinstall Chromium if the pinned Playwright browser changes. If you move the repository, run `npm run install:local -- --update` to refresh managed integration paths.

To uninstall, stop the preview and run:

```sh
npm run uninstall:local -- --json
```

Uninstall removes the managed skill, discovery link, command link, and installation metadata. It preserves user diagrams, exports, source code, and browser files.
