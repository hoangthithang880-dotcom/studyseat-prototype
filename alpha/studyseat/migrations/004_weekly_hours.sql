ALTER TABLE rooms ADD COLUMN weekly_version INTEGER NOT NULL DEFAULT 1;
CREATE TABLE room_weekly_hours (
  room_id TEXT NOT NULL REFERENCES rooms(id),
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
  opens_minute INTEGER,
  closes_minute INTEGER,
  CHECK((opens_minute IS NULL AND closes_minute IS NULL) OR
        (opens_minute IS NOT NULL AND closes_minute IS NOT NULL AND
         0 <= opens_minute AND opens_minute < closes_minute AND closes_minute <= 1440)),
  PRIMARY KEY(room_id, weekday)
);
