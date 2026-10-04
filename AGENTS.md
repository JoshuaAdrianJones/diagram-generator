# Project instructions

## Project

Sketch Diagram is a local TypeScript and Node.js application for rendering, reviewing, revising, and exporting diagrams. It includes a CLI, a loopback browser preview, and a reusable Codex diagram skill.

- `src/` contains application code. `schemas/` defines the JSON interfaces.
- `skill/diagram/` contains the canonical skill and launcher.
- `fixtures/` and `tests/` contain synthetic examples and tests.
- `scripts/` contains installation and verification tools.
- Use the Node.js version range and pinned dependencies in `package.json`. Preserve the lockfile.

## Subject matter must stay local

Never commit or upload user subject matter to GitHub, including private repositories. This applies to source notes, pasted conversations, reference material, real diagram specifications, labels, provenance, screenshots, exports, review records, and examples derived from user content.

- Keep subject-specific working files under the ignored `.local/` directory or outside the repository. Keep generated artifacts under ignored `artifacts/` when needed.
- Keep saved user diagrams in the application's configured data directory outside the repository. Check `SKETCH_DIAGRAM_DATA` before running commands that write diagram data.
- Use independently invented, generic synthetic content in committed fixtures, tests, documentation, and prompt examples. Removing names from user material does not make it suitable for GitHub.
- Do not copy private content into application code, documentation, commit messages, pull requests, issues, or GitHub attachments.
- Preserve ignore rules for `.local/`, `artifacts/`, `.installation.json`, `installation.json`, dependencies, and build output. Never force-add private or generated files.
- Do not commit credentials, personal filesystem paths, or machine-specific installation metadata.
- If uncertain whether content is user subject matter, keep it local and ask before including it in a commit.

## Git and GitHub

- Inspect `git status`, the active branch, and configured remotes before Git operations. Do not assume a repository is private or that a remote is the intended destination.
- Before committing, inspect every staged filename and the complete staged diff for subject matter, credentials, personal paths, and generated artifacts. Use explicit paths when staging files.
- `.gitignore` does not protect files already tracked by Git. Check tracked files as well as ignore rules. If private material is staged, unstage it without deleting the local file.
- Before pushing, review all outgoing commits for private content, including content removed in later commits. A clean current tree does not make earlier commits safe to upload.
- Commit, push, create repositories, or publish releases only when authorized by the user. Authorization to publish code never authorizes publishing subject matter.
- If private content has entered commit history, stop publication and report the affected paths. Do not rewrite shared history or delete user data without explicit authorization.

## Implementation and verification

- Preserve diagram meaning, labels, direction, uncertainty, and provenance during layout changes. Ordinary revisions should preserve unrelated positions and sketch seeds.
- Keep rendering and preview resources local. Escape user labels as inert text and keep the preview server bound to loopback.
- Keep installation and uninstall operations separate from normal development. Preserve unrelated skills and user diagrams.
- Run `npm test` for application changes. Run `npm run test:integration-install` when changing installation behavior. Documentation-only changes need content and diff review.
- Use synthetic content for verification. Do not publish a diagram as visually reviewed unless its actual screenshots have been inspected.

## Communication

Start with the result or substantive information. Use short, precise sentences. State verified facts separately from uncertainty. Avoid filler, promotional language, and unnecessary personal details.
