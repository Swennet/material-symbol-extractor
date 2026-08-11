# Project map
- Pre-implementation npm package; approved design: `docs/superpowers/specs/2026-08-11-material-symbol-extractor-design.md`.
- Planned package scope: scan configured text sources for Material Symbols ligatures, fetch one Google Fonts `woff2` subset, and skip unchanged output by deterministic signature.
- Package implementation stays independent of Nightscribe; never modify `/Users/swen/Personal/nightscribe` during package work.
- Read `mem:tech_stack` for platform constraints, `mem:conventions` for package boundaries, `mem:suggested_commands` for intended commands, and `mem:task_completion` before claiming implementation complete.