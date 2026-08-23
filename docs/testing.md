# Testing contracts

`assert.match` is appropriate when text itself is the public contract: a CLI diagnostic, a serialized format, a URL shape, or a rendered accessibility attribute. It is not an implementation test tool.

Do not read TypeScript, TSX, JavaScript, or patch files and assert that implementation fragments are present. Those tests survive neither harmless refactors nor alternative implementations, and they can pass while the code is unusable.

Use the narrowest observable contract:

1. Import a Module and exercise its public Interface.
2. Render a component from state and assert the user-visible result.
3. Parse structured artifacts such as JSON, manifests, and workflows before asserting fields.
4. Apply Harness patches to an upstream fixture, then execute or structurally inspect the patched artifact.
5. Keep a text assertion only when the exact text or format is the behavior.

The test loader supports TSX so UI tests do not need to inspect component source. `tests/support/harness-client-module.mjs` stages and executes patched Harness client Modules, while `tests/support/javascript-contract.mjs` inspects non-exported compiled boundaries as JavaScript structure instead of formatting-sensitive regexes.

`pnpm test:assertions` audits `assert.match` and `assert.doesNotMatch` values derived from file reads. `config/source-assertion-baseline.json` is a per-file ratchet: increasing source-text assertion debt fails, and every removal must lower the corresponding baseline count.
