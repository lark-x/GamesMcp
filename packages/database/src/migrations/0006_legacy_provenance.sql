-- Legacy rows created before immutable content manifests are deliberately
-- quarantined. They remain available for audit but cannot become public data.
UPDATE knowledge.dataset_revisions
SET is_current = false
WHERE manifest_id IS NULL AND is_current;

UPDATE knowledge.dataset_revisions
SET lifecycle_status = 'retired',
    archived_reason = COALESCE(archived_reason, 'legacy revision has no immutable content manifest'),
    archived_at = COALESCE(archived_at, now())
WHERE manifest_id IS NULL
  AND lifecycle_status <> 'retired';

UPDATE knowledge.release_candidate_builds
SET status = 'failed',
    archived_reason = COALESCE(archived_reason, 'legacy build has no immutable content manifest'),
    archived_at = COALESCE(archived_at, now()),
    failure_details = COALESCE(failure_details, '{}'::jsonb) || jsonb_build_object('code', 'legacy_manifest_missing')
WHERE manifest_id IS NULL
  AND status <> 'failed';
