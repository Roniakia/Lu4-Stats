-- Run once as the migration owner. Set passwords through your secret manager/psql,
-- never commit them. These roles intentionally start without login credentials.
DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='lu4_app') THEN CREATE ROLE lu4_app LOGIN; END IF;
IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='lu4_collector') THEN CREATE ROLE lu4_collector LOGIN; END IF;
IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='lu4_admin') THEN CREATE ROLE lu4_admin LOGIN; END IF; END $$;
GRANT CONNECT ON DATABASE lu4 TO lu4_app,lu4_collector,lu4_admin;
GRANT USAGE ON SCHEMA public TO lu4_app,lu4_collector,lu4_admin;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO lu4_app,lu4_admin;
GRANT SELECT,INSERT ON collections,observations,known_options TO lu4_collector;
GRANT SELECT,INSERT,UPDATE ON entities,collector_runs TO lu4_collector;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO lu4_collector;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO lu4_app,lu4_admin;
