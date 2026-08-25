# Section 8 — Knowledge-Aware Content Readiness

Section 8 adds a versioned deterministic intelligence layer on top of the
Section 7 Knowledge Base. It does not replace Phase 7.2 records, the human
review workflow, rights governance, the CONTENT_READY gate, or the Meta
publishing boundary.

## Inputs and versions

The canonical input is `src/data/knowledge-base/vargen-fe-knowledge-base-master.json`.
The local pipeline reads it as UTF-8, checks its declared record count and
unique `song_id`/`slug` values, and stores a SHA-256 context hash with every
Section 8 result. The public application continues to use the typed
Knowledge Base loader in `src/data/knowledge-base/`.

The tools-side loader exists because the media pipeline has its own TypeScript
build boundary. It does not duplicate the 79 records.

Section 8 versions are:

- `phase8-knowledge-bible-v1` — Knowledge Base Bible classification;
- `knowledge-aware-editorial-v1` — contextual editorial suggestions;
- `phase8-generic-language-v1` — generic-language classifier;
- `phase8-knowledge-calibration-v1` — quality and review queues.

## Biblical resolution

Knowledge Base references are suggestions only. `HUMAN_VERIFIED` remains
reserved for an explicit operator verification in the existing Bible
workflow. A conflict with a human-verified reference is surfaced as
`CONFLICT`; the human reference remains authoritative.

The resolver uses the primary reference, evidence level, confidence,
verification state, story, core message, secondary references and local
editorial alignment. It never invents verse ranges or calls an external Bible
service. Every suggestion retains the Knowledge Base path, provenance and a
safe reasoning summary.

## Editorial intelligence

Section 8 writes a separate `KNOWLEDGE_AWARE_SUGGESTION`. Current editorial
packages and Phase 7.2 suggestions remain intact. Suggested copy is derived
from the song title, biblical story, core message, themes, collection and
calendar/liturgical context. Audio characteristics do not supply theological
meaning.

Quality is separate from structural compliance. The score includes
specificity, biblical alignment, song context, distinctiveness, brand voice,
narrative value, CTA quality and retention potential, with an explicit
duplication penalty. Hooks, titles, covers, CTAs and hashtags are compared
independently enough to avoid treating the repeated brand signature in every
caption as a duplicate by itself.

## Review queues

Section 8 assigns PRIMARY candidates to:

- `FAST_PATH` — a high-value accelerated human-review priority, never an
  approval or rights shortcut;
- `STANDARD_REVIEW` — normal contextual review;
- `EDITORIAL_CHANGES_REQUIRED` — quality, generic-language or duplication
  concerns;
- `BIBLE_VERIFICATION_REQUIRED` — evidence needs deliberate human action;
- `CONFLICT_REVIEW` — conflicting references require human resolution.

No queue changes curation status. Secondary and HOLD candidates are not
processed by the full Section 8 command.

## Commands and reports

Run the representative calibration first:

```text
npm run editorial:knowledge-calibrate
```

The full PRIMARY run is explicit:

```text
npm run editorial:knowledge-run
```

Other commands:

```text
npm run editorial:knowledge-report
npm run bible:knowledge-resolve
npm run editorial:knowledge-apply -- <reel-id> --fields=caption,selected_hook --by=<operator>
```

Reports are runtime artifacts under the configured Reels root:
`section8-calibration.json/html` and `section8-primary.json/html`. They are
not public website assets and must not be committed.

## Governance and operations

The localhost Review Cockpit displays authoritative song context, the Section
8 Bible resolution, quality metrics, queue and current versus
Knowledge-Aware suggestion. It remains bound to `127.0.0.1` by default and
serves only approved generated output paths.

Rights remain `RIGHTS_PENDING_CONFIRMATION` until an operator deliberately
uses the existing rights workflow. `CONTENT_READY` still requires human
editorial approval, human Bible verification where required, rights
confirmation, technical validation and source integrity. `META_PRODUCTION_ELIGIBLE`
is unchanged and no Meta call is made by Section 8.
