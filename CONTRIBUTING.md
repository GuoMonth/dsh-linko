# Contributing

English | [中文](CONTRIBUTING.zh.md)

Linko is early and specification-driven. Design review is a contribution, not a waiting room before code.

## Before opening a change

- Read AGENTS.md, the relevant specification, and any decision record it cites.
- For a new behavior, write or update a specification before implementing it.
- Keep English and Chinese Markdown paired.
- Explain privacy, failure, resource, and compatibility consequences.
- Do not copy implementation from Rellopn/dsh-p2p-lan; see ADR 0001.

## TypeScript and verification

The development baseline follows [DeepSeek Harness v0.2.2-rc.5](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.5). It uses type-aware Oxlint, Vitest with forked Node workers, and a strict shared TypeScript configuration. Package configs check Node ESM and browser DOM types against their respective runtimes.

Use pnpm 12 and TypeScript 7. Linko requires Node.js 24.22.3 or later within the 24.x series, or Node.js 26.13.1 or later. pnpm checks this range during installation. CI runs the full suite on both minimum versions.

- Install with `pnpm install --frozen-lockfile`. Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` before opening a pull request.
- Place Vitest specs under `packages/<package>/tests/` as `*.spec.ts`. Test public behavior and keep process restarts, compiled entry points, and package integration covered by their smoke checks.
- Run `pnpm docs:check` for documentation and the affected smoke commands from [CI](.github/workflows/ci.yml) for changes that cross runtime boundaries.

## Coding conventions

- Validate untrusted data as `unknown` at the boundary. Pass the narrowed type onward and use `satisfies` to check literals. Avoid `any`, unchecked assertions, and non-null assertions.
- Give exported functions explicit return types and let local values infer theirs. Use discriminated unions for mutually exclusive states and derive related shapes from their owning types.
- Name quantities with their units and booleans with words such as `is`, `has`, or `should`. Preserve established wire fields and database names.
- Await, return, or explicitly handle every promise. Let failures remain observable, preserve the cause when wrapping errors, and use fallbacks for values that can be absent.
- Keep related code near its callers. Extract a helper when it removes actual duplication or expresses a distinct responsibility. Use comments to document invariants, side effects, or reasoning that the types cannot convey.

Adapted from [clean-typescript](https://github.com/hikariming/anti-slop/blob/main/skills/clean-typescript/SKILL.md).

## Useful contributions

- Review the product scope and unresolved questions.
- Propose protocol fixtures and adversarial network scenarios.
- Test local-first storage and replay designs.
- Build independent DSH or non-DSH client experiments once the protocol is stable.

## Pull requests

Use a focused title and explain the observable behavior, decision records, and validation evidence. A documentation-only change should say which future implementation decision it enables.
