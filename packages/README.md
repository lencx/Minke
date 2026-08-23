# Minke product packages

Product capability modules use one naming rule:

| Directory         | Package                        |
| ----------------- | ------------------------------ |
| `im-gateway`      | `@lencx/minke-im-gateway`      |
| `im-weixin`       | `@lencx/minke-im-weixin`       |
| `remote-access`   | `@lencx/minke-remote-access`   |
| `model-runtime`   | `@lencx/minke-model-runtime`   |
| `harness-overlay` | `@lencx/minke-harness-overlay` |

Directories use the capability slug. Private package names use the `@lencx/minke-<capability>` form. A platform adapter is an export of the capability package, such as `@lencx/minke-model-runtime/dsh`; it does not make the capability an implementation detail of that platform package.

`sys` predates this product-package convention and remains the native addon package consumed through `optionalDependencies`.
