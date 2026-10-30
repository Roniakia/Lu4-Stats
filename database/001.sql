CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS collections (
 id text PRIMARY KEY, server text NOT NULL CHECK(server IN ('gamma','white','black','carmine')),
 captured_at timestamptz NOT NULL, imported_at timestamptz NOT NULL DEFAULT now(),
 checksum text NOT NULL, source jsonb NOT NULL DEFAULT '{}',
 hall_coverage boolean NOT NULL, UNIQUE(server,captured_at)
);
CREATE INDEX IF NOT EXISTS collections_server_time ON collections(server,captured_at DESC,id);
CREATE TABLE IF NOT EXISTS entities (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, server text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('player','clan','castle','hall')),
 lookup_key text NOT NULL, name text NOT NULL, first_seen timestamptz NOT NULL, last_seen timestamptz NOT NULL,
 UNIQUE(server,kind,lookup_key)
);
CREATE TABLE IF NOT EXISTS observations (
 collection_id text NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
 entity_id bigint NOT NULL REFERENCES entities(id), captured_at timestamptz NOT NULL,
 kind text NOT NULL CHECK(kind IN ('player','clan','castle','hall')), ordinal integer NOT NULL,
 payload jsonb NOT NULL, PRIMARY KEY(collection_id,entity_id)
);
CREATE INDEX IF NOT EXISTS observations_entity_time ON observations(entity_id,captured_at);
CREATE INDEX IF NOT EXISTS observations_collection_kind ON observations(collection_id,kind,ordinal);
INSERT INTO schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS known_options (server text NOT NULL,kind text NOT NULL CHECK(kind IN ('class','clan')),value text NOT NULL,PRIMARY KEY(server,kind,value));

CREATE TABLE IF NOT EXISTS import_sources (
 collection_id text NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
 revision text NOT NULL CHECK(revision ~ '^[a-f0-9]{40}$'), url text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(collection_id,revision)
);

CREATE TABLE IF NOT EXISTS collector_runs (
 id uuid PRIMARY KEY, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 status text NOT NULL CHECK(status IN ('running','complete','failed')), details jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS collector_runs_time ON collector_runs(started_at DESC);
