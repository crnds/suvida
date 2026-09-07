// Bootstraps the single owner account from env vars. Idempotent: running
// twice does not error and does not touch an existing owner row. Runs
// standalone: `node scripts/seed.js` (or `npm run seed`).
import { createClient } from '@libsql/client';
import { hashPassword } from '../api/_lib/auth.js';

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const username = process.env.OWNER_USERNAME;
  const password = process.env.OWNER_PASSWORD;

  if (!url) {
    console.error('TURSO_DATABASE_URL is not set.');
    process.exit(1);
  }
  if (!username || !password) {
    console.error('OWNER_USERNAME and OWNER_PASSWORD must both be set.');
    process.exit(1);
  }

  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  const passwordHash = await hashPassword(password);

  const result = await client.execute({
    sql: `INSERT INTO owner (username, password_hash, created_at)
          SELECT ?, ?, unixepoch()
           WHERE NOT EXISTS (SELECT 1 FROM owner WHERE username = ?)`,
    args: [username, passwordHash, username],
  });

  client.close();

  if (result.rowsAffected > 0) {
    console.log(`seed: created owner "${username}".`);
  } else {
    console.log(`seed: owner "${username}" already exists, nothing to do.`);
  }
}

main().catch((err) => {
  console.error('seed failed:', err);
  process.exit(1);
});
