#!/usr/bin/env bash
# Creates the PostgreSQL fixture used by test/connectors.test.js (idempotent: drops and
# recreates the `bank_demo` database). Run as a Postgres superuser, e.g.:
#   su postgres -c "bash server/test/fixtures/setup-pg.sh"          # local
#   PGHOST=localhost PGUSER=postgres PGPASSWORD=... bash server/test/fixtures/setup-pg.sh   # CI
set -euo pipefail
psql -v ON_ERROR_STOP=1 -qd postgres <<'SQL'
DROP DATABASE IF EXISTS bank_demo;
CREATE DATABASE bank_demo;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'scanner')    THEN CREATE ROLE scanner    LOGIN PASSWORD 'scanner-pw'; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'writer')     THEN CREATE ROLE writer     LOGIN PASSWORD 'writer-pw'; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'admin_role') THEN CREATE ROLE admin_role LOGIN SUPERUSER PASSWORD 'admin-pw'; END IF;
END $$;
SQL
psql -v ON_ERROR_STOP=1 -qd bank_demo <<'SQL'
CREATE TABLE customers (id serial PRIMARY KEY, full_name text, email text, phone text, pan_number text, aadhaar_number text, city text, notes text);
INSERT INTO customers (full_name, email, phone, pan_number, aadhaar_number, city, notes) VALUES
 ('Ritika Gupta','ritika.gupta@abcbank.demo','9876543210','ABCDE1234F','234123412346','Pune','vip'),
 ('Sana Verma','sana.verma@abcbank.demo','9123456780','PQRSX5678K','234123412346','Delhi','standard'),
 ('Arjun Rao','arjun.rao@abcbank.demo','9988776655','ZXCVB4321L','999999999999','Mumbai','standard');
CREATE TABLE cards (id serial PRIMARY KEY, holder text, card_number text, status text);
INSERT INTO cards (holder, card_number, status) VALUES ('Ritika Gupta','4111111111111111','active'),('Sana Verma','4111111111111111','blocked');
CREATE TABLE branches (id serial PRIMARY KEY, branch_code text, region text);
INSERT INTO branches (branch_code, region) VALUES ('MUM01','West'),('DEL02','North');
CREATE TABLE web_logins (id serial PRIMARY KEY, user_email text, ip_address text);
INSERT INTO web_logins (user_email, ip_address)
  SELECT 'user'||g||'@abcbank.demo', '10.0.'||(g%250)||'.'||(g%200+1) FROM generate_series(1,3000) g;
CREATE SCHEMA hr;
CREATE TABLE hr.employees (emp_id text, employee_name text, personal_email text);
INSERT INTO hr.employees VALUES ('E001','Kabir Singh','kabir.singh@abcbank.demo');
GRANT USAGE ON SCHEMA public, hr TO scanner, writer;
GRANT SELECT ON ALL TABLES IN SCHEMA public, hr TO scanner, writer;
GRANT INSERT ON branches TO writer;
GRANT USAGE ON SEQUENCE branches_id_seq TO writer;
SQL
echo "bank_demo fixture ready"
