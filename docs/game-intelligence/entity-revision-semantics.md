# Entity Revision Semantics

## Decision

The entity model uses **B: stable entities plus revision visibility/materialization**.

- `knowledge.entities` is the stable identity table. Its `(game_id, source_key)` identity and
  `first_revision_id` / `last_revision_id` bookkeeping allow the same entity to be referenced by
  bindings, claims, relationships, and mentions across releases.
- `knowledge.entity_revision_materializations` is the revision-scoped read model for the entity's
  visible type, canonical name, normalized name, and summary.
- `knowledge.entity_aliases` is revision-scoped through `revision_id`. An alias is visible only
  when both its entity materialization and its alias row belong to the requested revision.

This matches the existing schema: documents, dialogue, structured records, bindings, claims, and
relationships already carry `revision_id`, while `entities` deliberately has stable identity
fields rather than a revision key. Revision materialization also makes historical canonical names
and deletions independent of the mutable current entity row.

## Query rule

Every entity candidate query must receive `gameId`, `revisionId`, and `query`. Entity matching is
performed against the requested revision's materialization and its aliases joined on the same
`revision_id`; callers must not load aliases by `entity_id` alone. Candidate filtering and ordering
for exact canonical, exact alias, prefix, and trigram matches are performed in PostgreSQL.

## Write rule

Revision materialization writes one materialization row per visible stable entity and one alias row
per alias for that revision. Retrying or rebuilding a revision clears only rows owned by that
revision. It never removes aliases or materializations belonging to another revision.
