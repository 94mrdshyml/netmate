-- Spike 3: which SQL features does real (remote) D1 support? Run against a throwaway
-- database by .github/workflows/spike-d1.yml. Each SELECT is one result in the log.

-- 1. Version
SELECT 'sqlite_version' AS check_name, sqlite_version() AS result;

-- 2. Math functions the For you score would use (the plan scores in TypeScript, so this is optional)
SELECT 'ln_pow' AS check_name, ln(1) AS ln_one, pow(2, 3) AS two_cubed;

-- 3. Defaults the auth migration relies on (needs SQLite 3.42+)
SELECT 'unixepoch_subsecond' AS check_name, cast(unixepoch('subsecond') * 1000 AS integer) > 1700000000000 AS ok;

-- 4. Window functions (author decay in For you, ranking)
SELECT 'window_functions' AS check_name, n, row_number() OVER (ORDER BY n DESC) AS rn
FROM (SELECT 1 AS n UNION ALL SELECT 2 UNION ALL SELECT 3);

-- 5. Recursive CTE (daily series for analytics)
WITH RECURSIVE d(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM d WHERE n < 6)
SELECT 'recursive_cte' AS check_name, count(*) AS days FROM d;

-- 6. JSON functions
SELECT 'json' AS check_name, json_extract('{"a":[1,2,3]}', '$.a[1]') AS second;

-- 7. Foreign keys with cascade
CREATE TABLE t_parent (id TEXT PRIMARY KEY);
CREATE TABLE t_child (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES t_parent(id) ON DELETE CASCADE);
INSERT INTO t_parent VALUES ('p');
INSERT INTO t_child VALUES ('c', 'p');
DELETE FROM t_parent WHERE id = 'p';
SELECT 'fk_cascade' AS check_name, count(*) AS children_left FROM t_child;

-- 8. INSERT OR IGNORE and RETURNING
CREATE TABLE t_ign (k TEXT PRIMARY KEY, v INTEGER);
INSERT OR IGNORE INTO t_ign VALUES ('a', 1);
INSERT OR IGNORE INTO t_ign VALUES ('a', 2);
SELECT 'insert_or_ignore' AS check_name, count(*) AS rows_, max(v) AS v FROM t_ign;
INSERT INTO t_ign VALUES ('b', 3) RETURNING k;

-- 9. FTS5 with accent-insensitive prefix matching, kept in step by triggers
CREATE TABLE t_docs (id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE VIRTUAL TABLE t_docs_fts USING fts5(body, content='t_docs', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2', prefix='2 3 4');
CREATE TRIGGER t_docs_ai AFTER INSERT ON t_docs BEGIN INSERT INTO t_docs_fts(rowid, body) VALUES (new.rowid, new.body); END;
CREATE TRIGGER t_docs_ad AFTER DELETE ON t_docs BEGIN INSERT INTO t_docs_fts(t_docs_fts, rowid, body) VALUES ('delete', old.rowid, old.body); END;
INSERT INTO t_docs (id, body) VALUES ('1', 'Café opening in Kolkata');
INSERT INTO t_docs (id, body) VALUES ('2', 'Totally unrelated');
SELECT 'fts5_prefix_accent' AS check_name, d.id FROM t_docs_fts f JOIN t_docs d ON d.rowid = f.rowid WHERE t_docs_fts MATCH 'cafe' ORDER BY d.id;
SELECT 'fts5_prefix_star' AS check_name, d.id FROM t_docs_fts f JOIN t_docs d ON d.rowid = f.rowid WHERE t_docs_fts MATCH 'kolk*' ORDER BY d.id;
DELETE FROM t_docs WHERE id = '1';
SELECT 'fts5_after_delete' AS check_name, count(*) AS hits FROM t_docs_fts WHERE t_docs_fts MATCH 'cafe';

-- 10. FTS5 trigram tokenizer (true "contains" matching and scripts without spaces)
CREATE VIRTUAL TABLE t_tri USING fts5(body, tokenize='trigram');
INSERT INTO t_tri VALUES ('Kolkata nights');
SELECT 'fts5_trigram' AS check_name, count(*) AS hits FROM t_tri WHERE t_tri MATCH 'olka';

-- 11. LIKE and case: SQLite folds case for plain English letters only
SELECT 'like_english' AS check_name, 'Riya' LIKE 'riya' AS matches;
SELECT 'like_non_english' AS check_name, 'Éla' LIKE 'éla' AS matches;
SELECT 'lower_non_english' AS check_name, lower('ÉLA') AS lowered;

-- 12. Partial and expression indexes
CREATE TABLE t_idx (id TEXT PRIMARY KEY, deleted INTEGER NOT NULL DEFAULT 0, name TEXT);
CREATE INDEX t_idx_alive ON t_idx (name) WHERE deleted = 0;
CREATE INDEX t_idx_lower ON t_idx (lower(name));
SELECT 'partial_expression_indexes' AS check_name, count(*) AS indexes FROM sqlite_master WHERE type = 'index' AND name LIKE 't_idx_%';
