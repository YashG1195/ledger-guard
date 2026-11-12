# Project Guidelines

## Code Style & Humanization
- Write clean, idiomatic, and human-written JavaScript/Node.js code.
- Avoid synthetic AI hallmarks:
  - Do not use decorative Unicode ASCII divider banners (e.g. `// ─── Section ───`).
  - Do not use emojis in code, log statements, commit messages, or Markdown headings.
  - Avoid redundant textbook-style JSDoc comments (`@param`, `@returns`, `@example`) on simple or self-explanatory functions.
  - Keep comments pragmatic and brief, explaining *why* a non-obvious decision was made (e.g. using minor currency units) rather than *what* basic syntax does.
  - Avoid generic numbered step-by-step TODO lists in comments.
- Maintain consistent response envelopes (`{ success, data, error }`) and tenant isolation patterns across backend modules.

