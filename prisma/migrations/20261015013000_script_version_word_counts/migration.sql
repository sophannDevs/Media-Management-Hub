-- PERF-05: the workspace lists script versions without their text, so every version must carry its word count.
-- Older rows may have 0. Same rule as wordCount() in src/lib/workflow/rules.ts: trim, split on whitespace.
UPDATE "ScriptVersion"
SET "wordCount" = array_length(regexp_split_to_array(btrim("body"), '\s+'), 1)
WHERE "wordCount" = 0 AND btrim("body") <> '';
