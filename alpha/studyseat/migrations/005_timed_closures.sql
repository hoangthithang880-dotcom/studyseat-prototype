ALTER TABLE resource_closures ADD COLUMN start_at TEXT;
ALTER TABLE resource_closures ADD COLUMN end_at TEXT
  CHECK((start_at IS NULL AND end_at IS NULL) OR
        (start_at IS NOT NULL AND end_at IS NOT NULL AND start_at < end_at));
