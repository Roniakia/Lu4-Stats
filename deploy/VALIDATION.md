# Separate repository verification — 2026-10-02

Lu4-Stats independently builds Dockerfile.tools and Dockerfile.collector without app files or sibling contexts. Local ARM64 images pass schema/role setup, protected-directory initialization, collector limited-writer authentication/idempotent ingestion/delete denial and non-root Chromium against offline HTML. No live source collection was run.

npm run test:homelab passes five existing parser tests, embedded storage/transaction/query-count/gap/rollback tests, four-language report escaping and archive format corruption/count/path checks. Native PostgreSQL18 tests/storage.cjs and tests/operations.cjs pass isolated schema/DB/role tests, fixture collector locking/cooldown/shutdown, pinned fixture importer replay, archives/exports/prune/baseline/idempotent restore and PostgreSQL18.4 dump/restore parity. Tests clean their disposable schemas/databases/roles.

The separate app repo passes its complete suites, TypeScript/production build and app-only Docker build. Its test-only schema snapshot is byte-identical to this operational schema1. The app image reads this repository's initialized DB as lu4_app; HTTP smoke passes, and the compiled runtime excludes operational tools, test writers and ingestion SQL. Disposable Docker interop resources are removed; legacy publisher and native development preview remain unchanged.

Changed GitHub workflow is prepared but not executed remotely. Native AMD64 homelab runtime, full history reconciliation, real-source throughput, off-host recovery, encrypted tunnel/TLS and hardware capacity still need host verification. Commits are local until separately authorized to push. Do not merge the obsolete app-repository homelab PR25.
