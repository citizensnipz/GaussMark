CREATE TABLE IF NOT EXISTS results (
 id TEXT PRIMARY KEY, received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 methodology TEXT NOT NULL, benchmark_version TEXT NOT NULL,
 renderer TEXT NOT NULL, api TEXT NOT NULL, browser TEXT NOT NULL, gpu TEXT NOT NULL,
 scene_id TEXT NOT NULL, scene_version TEXT NOT NULL, scene_source TEXT NOT NULL,
 format TEXT NOT NULL, configuration TEXT NOT NULL, payload TEXT NOT NULL
);
CREATE INDEX results_method_time ON results(methodology, received_at DESC);
CREATE INDEX results_scene ON results(scene_source,scene_id,scene_version);
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE INDEX rate_limits_expiry ON rate_limits(expires);
