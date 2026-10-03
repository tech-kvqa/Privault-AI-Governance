# SQLite local development

This project uses SQLite for local development. PostgreSQL remains preserved for production.

## Local development

1. Copy `.env.example` to `.env`.
2. Ensure `DATABASE_URL="file:../data/privault-dev.db"`.
3. Install dependencies:

```powershell
npm install
```

4. Generate Prisma Client:

```powershell
npx prisma generate
```

5. Create/update the SQLite schema:

```powershell
npx prisma db push --force-reset
```

6. Seed the development database:

```powershell
npm run seed
```

7. Start the server:

```powershell
npm start
```

The SQLite file is created at `server/data/privault-dev.db`.

## PostgreSQL production setup

The original PostgreSQL Prisma schema is preserved as `prisma/schema.postgres.prisma`.
The PostgreSQL adapter and `pg` dependency remain in the project for the production deployment path.
Do not run the PostgreSQL migration runner against the local SQLite database.

For local development, `npm run migrate:dev` intentionally maps to `prisma db push`.
The existing `npm run migrate` script remains the PostgreSQL deployment migration runner.
