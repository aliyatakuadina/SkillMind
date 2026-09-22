-- Create the local SkillMind database on an existing Postgres.
-- Connect to the maintenance database (usually postgres), not to skillmind:
--   psql -h 127.0.0.1 -p 5440 -U postgres -d postgres -f scripts/ops/create_skillmind_db.sql
-- Password comes from the environment or a prompt. Do not put it in this file.

SELECT format('CREATE DATABASE %I', 'skillmind')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'skillmind')\gexec
