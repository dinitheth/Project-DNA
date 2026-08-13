# Contributing to Project DNA

Project DNA is an offline, deterministic software intelligence platform. Contributions must preserve
its frozen architecture, package boundaries, dependency direction, and public contracts unless a
critical implementation issue has been documented and approved.

## Prerequisites

- Node.js 22.23.2
- pnpm 9.15.4
- Git

The repository includes `.node-version` and declares the required pnpm version in `package.json`.

## Setup

```bash
pnpm install
pnpm check:workspace
```

`pnpm check:workspace` validates workspace registration, required scripts, test discovery, and
cross-platform package configuration. During an active migration milestone, it may report known
findings that are being resolved incrementally.

## Development Standards

- Keep changes scoped to one objective.
- Follow the existing package structure and dependency direction.
- Do not create packages or change public APIs without explicit approval.
- Keep analysis deterministic and fully offline.
- Do not add telemetry, cloud dependencies, placeholders, or TODO comments.
- Use typed boundaries instead of `any` or broad type assertions.
- Preserve backward compatibility unless a reviewed specification permits a breaking change.
- Add or update tests for every behavioral change.
- Use `rimraf` in package clean scripts so commands work across supported platforms.

## Package Boundaries

Project DNA follows the package layers documented in `README.md`. Implementations depend on domain
contracts and shared infrastructure, not on presentation packages or unrelated engine
implementations. Cross-package imports must use public package exports rather than private source
paths.

Before changing a dependency, verify that it does not introduce a circular dependency or reverse
the documented dependency direction.

## Verification

Run focused checks while developing, then run the complete pipeline before requesting review:

```bash
pnpm verify
```

The verification pipeline is intentionally sequential:

1. Workspace validation
2. Prettier formatting check
3. ESLint with zero warnings
4. TypeScript typecheck
5. Automated tests
6. Production build

Format only files changed by the contribution:

```bash
pnpm exec prettier --write path/to/changed-file
```

Do not include unrelated repository-wide formatting in a functional change.

## Tests

- Keep tests deterministic and independent of network services.
- Prefer unit tests for pure logic and integration tests for package boundaries.
- Read real local manifests or fixtures when contract alignment is under test.
- Do not use `--passWithNoTests` in packages that contain tests.
- Keep `test:watch` scripts standardized as `vitest`.

## Commits and Pull Requests

Commits should be small, buildable, and focused on one reviewable objective. Use an imperative,
specific subject such as:

```text
Normalize workspace verification scripts
```

Pull requests must describe:

- The objective and affected packages
- Public API or runtime behavior impact
- Tests added or updated
- Verification commands and results
- Any known limitations or follow-up work

Do not commit generated build output, local databases, environment files, editor state, or dependency
directories.

## License

By contributing, you agree that your contribution is licensed under the repository's MIT License.
