# Agent skill packages

```sh
npm ci
npm run package:skill
```

The build requires the project's Node.js range, npm, Python 3, `tar`, and network access to install pinned dependencies into a temporary directory. It writes:

- `artifacts/packages/diagram-skill.zip`. One top-level `diagram/` folder for Claude.ai, Claude Code, and Codex.
- `artifacts/packages/sketch-diagram-plugin.zip`. Root `plugin.json`, a Claude manifest, and `skills/diagram/` for Claude Code and ChatGPT/Codex plugin distribution.
- `artifacts/packages/manifest.json`. Sizes, SHA-256 hashes, and the skill file inventory.

The packages contain application source, the compiled CLI, production dependencies, schemas, fonts and license notices, command documentation, and synthetic examples. No repository clone or npm install is needed to use the packaged application. Node and Chromium are separate prerequisites. The application archive is unpacked into a writable cache on first use. Packaging never installs skills into accounts or publishes code.

After packaging, run `npm run test:package` to check extraction, offline runtime preparation, draft diagrams and canvases, integrity failures, and browser rendering/export with the installed Chromium. Application changes also require `npm test`. Launcher or installer changes require `npm run test:integration-install`.

Run `npm run test:claude-plugin` with Claude Code installed to validate manifests, install into an isolated configuration, discover the skill, build a source runtime, render a synthetic diagram, and confirm uninstall preserves diagram data. This test uses package-registry access and the installed Chromium. It does not modify your active Claude configuration.

## Claude Code

### Install from GitHub as a plugin

Run these commands inside Claude Code:

```text
/plugin marketplace add https://github.com/JoshuaAdrianJones/diagram-generator
/plugin install sketch-diagram@sketch-diagram-marketplace
/reload-plugins
/sketch-diagram:diagram Draw a simple Collect → Check → Save sequence.
```

For a branch such as `preview`, use:

```text
/plugin marketplace add https://github.com/JoshuaAdrianJones/diagram-generator.git#preview
/plugin install sketch-diagram@sketch-diagram-marketplace
```

If your Claude Code version lacks `/reload-plugins`, restart the session. The equivalent terminal installation is:

```sh
claude plugin marketplace add https://github.com/JoshuaAdrianJones/diagram-generator
claude plugin install sketch-diagram@sketch-diagram-marketplace --scope user
```

Use a current Claude Code version with plugin support, Node.js `>=22.19.0 <27`, npm, and network access for first setup. The skill runs its setup script from the installed plugin directory. It builds the application from the pinned lockfile in a separate cache and installs Chromium. No clone, global npm install, or Codex installation is needed. Later calls reuse the runtime. Keep `SKETCH_DIAGRAM_DATA` outside repositories. On Linux, Chromium also needs its system libraries.

The repository's `.claude-plugin/marketplace.json` points at `./`, and `.claude-plugin/plugin.json` declares `skills: "./skill/"`. This loads the canonical skill without duplicating it or checking compiled output into Git. Without a branch suffix, the GitHub commands use the remote's default branch. To install another branch, append `#<branch>` to the marketplace URL. The manifests and source must be committed and pushed on that branch. Because this marketplace uses `source: "./"`, the plugin comes from the same selected checkout. See [Claude plugin manifest](https://code.claude.com/docs/en/plugins-reference) and [GitHub marketplace hosting](https://code.claude.com/docs/en/plugin-marketplaces).

To update or uninstall:

```text
/plugin marketplace update sketch-diagram-marketplace
/plugin update sketch-diagram@sketch-diagram-marketplace
/plugin uninstall sketch-diagram@sketch-diagram-marketplace
```

Plugin uninstall leaves the application's external diagram data and runtime cache in place. Remove only those directories separately if you intend to delete them. The Claude Code GitHub plugin is distinct from a Claude.ai uploaded skill. Use the ZIP instructions below for Claude.ai.

### Install the standalone skill ZIP

Extract `diagram-skill.zip` into `~/.claude/skills/`, producing `~/.claude/skills/diagram/SKILL.md`. For project scope, use `.claude/skills/`. Preserve an existing `diagram` skill by extracting elsewhere if that directory already exists.

```sh
node ~/.claude/skills/diagram/scripts/setup.mjs --browser --json
```

Invoke `/diagram` or ask Claude Code to create a sketch diagram. See [Claude Code skills](https://code.claude.com/docs/en/skills).

## Codex

Extract the same ZIP into `~/.agents/skills/` or the project's `.agents/skills/`, producing `diagram/SKILL.md`. Preserve an existing skill at that path. The checkout-linked `install:local` flow remains available.

```sh
node ~/.agents/skills/diagram/scripts/setup.mjs --browser --json
```

Invoke `$diagram` or choose it in `/skills`. Restart only if discovery has not refreshed. See [OpenAI skill locations and invocation](https://learn.chatgpt.com/docs/build-skills).

## Claude web / claude.ai

Enable code execution and file creation. In **Customize > Skills**, choose **+ Create skill > Upload a skill**, upload `diagram-skill.zip`, and enable it. Ask Claude to use the Diagram skill. Organization settings can control availability. See [Use skills in Claude](https://support.claude.com/en/articles/12512180-use-skills-in-claude).

The skill checks the sandbox's Node version, writable storage, and browser support. Bundled dependencies need no network. Chromium installation needs network unless a matching browser is already available. Without Chromium, the package produces draft SVGs with the same renderer. Screenshot review and PNG export depend on sandbox capabilities. Live account upload and execution are not verified by local package tests.

## ChatGPT web

Use `sketch-diagram-plugin.zip` for the plugin import/submission flow available to your account or workspace. It follows the portable Agent Plugins layout. OpenAI documents standalone local skills for desktop/Codex and skills bundled in plugins for ChatGPT web. A generic chat attachment is not a persistent skill installation. See [Build skills](https://learn.chatgpt.com/docs/build-skills) and [Package your plugin](https://developers.openai.com/plugins/build/plugins).

Import, installation, or publication must be completed in the relevant account. This build does not register or publish a plugin. Imported scripts still require shell execution, supported Node, and image inspection for verified output. A skill package does not grant tools the host lacks.

For a single chat with code execution, attach `diagram-skill.zip` and instruct ChatGPT to extract it, read `diagram/SKILL.md`, and use its scripts. This is a per-chat workflow, conditional on the host accepting/extracting the archive and providing the runtime. It does not install the skill. Without Node, return a spec for a local agent. Without Chromium, return draft SVGs. Hosted loopback URLs cannot be opened from your browser; return file attachments.

## Storage and revisions

Set `SKETCH_DIAGRAM_DATA` before creating diagrams. Use an absolute writable directory outside repositories. Portable local defaults are the macOS Application Support directory or `~/.local/share/sketch-diagram` on other platforms. `SKETCH_DIAGRAM_CACHE` selects the runtime cache; `PLAYWRIGHT_BROWSERS_PATH` selects the browser cache. Both can point to writable sandbox directories.

Local agents support the complete revision, loopback preview, capture, review, and SVG/PNG workflow when prerequisites pass. Web sessions may discard files. Download specs, layouts, and exports for later revisions. User labels, notes, diagrams, screenshots, and review records never belong in a distributable package.

## Packaging design sources

Barry Zhang, Keith Lazuka, and Mahesh Murag's [Agent Skills engineering article](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) recommends loading instructions first and resources when needed. This package keeps runtime guidance in a reference and deterministic setup in scripts. The [Agent Skills specification](https://agentskills.io/specification) defines shared frontmatter and relative resources. Model fidelity continues to follow the existing Novak/Cañas and Munzner guidance in `references/design.md`.
