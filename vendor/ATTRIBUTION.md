# Upstream Attribution

This directory contains vendored source derived from Excalidraw upstream.

- Upstream project: https://github.com/excalidraw/excalidraw
- Upstream commit SHA: `1caec99b290c75cda05385e637138998807a65ae`
- Vendored package paths:
  - `vendor/excalidraw`
  - `vendor/common`
  - `vendor/math`
  - `vendor/element`

License:

- Upstream license file is preserved at `vendor/LICENSE.UPSTREAM`.

Local adjustments in this repository:

- Internal vendored package links use local `file:` dependencies for private/local development.
- App integration wiring uses local vendored package paths.
