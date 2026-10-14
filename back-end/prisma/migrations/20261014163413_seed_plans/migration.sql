-- The two subscription plans the app is built around. Prices start empty ([PREȚ]) and are
-- set by an admin; existing rows (e.g. from the dev seed) are left untouched.
INSERT INTO "plans" ("id", "name", "description", "session_limit", "price") VALUES
  ('sessions12', '12 ședințe / lună', 'Fiecare check-in consumă o ședință. La 12/12 accesul este blocat până la reînnoire sau upgrade.', 12, NULL),
  ('unlimited', 'Nelimitat', 'Acces la orice antrenament din orar, fără limită de ședințe, pe durata lunii.', NULL, NULL)
ON CONFLICT ("id") DO NOTHING;
