# Graph Schema Migrations

MindGraph graph documents now include a top-level integer field:

- `schemaVersion`

The canonical current value is exported as `CURRENT_GRAPH_SCHEMA_VERSION` from
`js/core/graph-migrations.js`.

## Migration Flow

All incoming documents are migrated before normalization and validation:

1. `migrateGraphDocument(documentLike)` runs first.
2. The migrated document is normalized with `normalizeGraphDocument(...)`.
3. The normalized document is validated with `validateGraphDocument(...)`.

This flow is centralized in `graphStore.load(...)`, so it automatically applies to:

- JSON file import
- autosave restore
- any `GRAPH_DOCUMENT_LOAD_REQUESTED` event path

## Adding Future Migrations

Add one migration object per schema step in `js/core/graph-migrations.js`:

```js
{
  from: 3,
  to: 4,
  description: "Describe what changed in this schema step.",
  migrate: (document) => {
    // mutate/copy as needed
    return document;
  }
}
```

Guidelines:

- keep migration steps ordered by `from`
- only do one-version jumps (`N -> N+1`)
- do not put migration logic in UI components
- keep `graph-store` as the canonical owner of load-time migration

## Forward Safety

If a document has a future schema version, migration returns a readable error object:

- `code`
- `message`
- `sourceVersion`
- `targetVersion`
- optional `details`

The store wraps this as `GraphSchemaMigrationError` and aborts load safely.
