# Engineering Guardrails

MindGraph intentionally optimizes for low operational complexity and direct local hackability.

## Non-Negotiables

- No required build step for local development.
- No framework/runtime lock-in (browser-native ES modules + Web Components).
- Keep runtime dependencies minimal and explicit.
- Prefer platform APIs and simple local scripts over toolchain expansion.
- Preserve direct browser execution for the UI (`python3 -m http.server` is sufficient).

## JavaScript + Typing Strategy

- JavaScript remains the source language.
- JSDoc + `@ts-check` are used for editor intelligence and safer refactors.
- Avoid introducing TypeScript compile/transpile requirements.
- Prefer shared JSDoc typedefs for core domain objects and event payloads.

## Change Gate

Before merging architecture-level changes:

1. Does this introduce a build requirement for contributors?
2. Does this introduce avoidable dependency surface?
3. Does this preserve browser-native execution and simple local setup?
4. Does this improve maintainability without violating the above constraints?

Any answer of "no" blocks the change unless explicitly approved.
