# Portable runtime and web environments

A Claude Code source plugin has `.claude-plugin/plugin.json` at the repository root and no `bundle.json`. The same setup command copies only distributable source files into an external cache, runs `npm ci`, compiles TypeScript, and keeps production dependencies. First setup requires Node, npm, and package-registry access. It does not write build output into the installed plugin, register a Codex skill, or change saved user diagrams. Later invocations reuse the cached runtime. Source changes select a new cache; saved diagrams remain in the configured data directory.

Read this when `bundle.json` exists beside `SKILL.md`, or when running in a web assistant.

The bundle contains the compiled application, TypeScript source, pinned production dependencies, schemas, fonts, license notices, CLI documentation, and two synthetic examples. It contains no browser binary, Node executable, saved user diagrams, or machine installation metadata. It requires Node.js `>=22.19.0 <27` and `tar`. Unpacking works offline and does not register skills or change global packages.

Run `node <skill-directory>/scripts/setup.mjs --json`. Use the returned `applicationRoot` to read schemas. The runtime goes into a writable cache outside the skill directory. Set `SKETCH_DIAGRAM_CACHE` to a writable sandbox directory when needed. Set `SKETCH_DIAGRAM_DATA` to an absolute writable directory outside repositories. For web sessions, use the host's working/output directory. Session storage may be temporary. Preserve downloadable specs and layouts for subsequent revisions.

For the full workflow, run `node <skill-directory>/scripts/setup.mjs --browser --json` to install pinned Chromium. This requires permitted network access and browser system libraries. Reuse a matching existing Playwright browser by setting `PLAYWRIGHT_BROWSERS_PATH`. The package does not install operating-system packages. Run the launcher `doctor --json` to check availability. A portable bundle reports `integration` as `portable_bundle` and needs no global CLI installation. All doctor checks must pass for the full workflow.

## Web delivery

Claude.ai and ChatGPT web execute in remote environments. A `127.0.0.1` preview there is reachable only inside that environment. Return downloadable SVG/PNG files through the host's attachment mechanism. Do not return a loopback link as a working browser preview unless host browser access was actually verified. Do not claim access to the user's local saved diagrams. Request the relevant spec and layout when a revision requires unavailable files.

If Node or shell execution is unavailable, preserve the model and return a specification for a capable local agent. State the missing capability. Do not claim a rendered diagram.

If Node works but Chromium cannot run, use the same renderer without screenshots:

```sh
node <skill-directory>/scripts/render-svg.mjs --spec <spec-path> --out <new-output-directory> --json
```

This produces a draft SVG, original spec, layout, diagnostics, and individual canvas frame SVGs. It never publishes a revision or records a verified visual review. Check geometry findings and return the draft with the status `visual_review_unavailable`. PNG export and screenshot review require Chromium.

To revise a draft, load its saved spec and layout, apply the appropriate schema-valid patch with the application API or launcher, and render with `--previous-layout <layout-path>` into a new output directory. Preserve unrelated positions and seeds. For a full saved revision, continue using `status`, `revise`, and the expected base revision. Do not replace saved revision history with draft files.

Once Chromium works, use the full render/inspect/review/publish workflow. Open the actual screenshots with the host's image-viewing tool. Publication selects the current revision in the private diagram store. It does not upload diagrams to a service.
