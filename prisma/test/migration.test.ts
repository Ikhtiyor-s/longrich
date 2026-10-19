import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const TEST_DB_NAME = 'longrich_migration_test';

function urlFor(dbName: string): string {
  const base = new URL(
    process.env.DATABASE_URL ??
      'postgresql://longrich:longrich@localhost:5432/longrich?schema=public',
  );
  base.pathname = `/${dbName}`;
  return base.toString();
}

const adminUrl = urlFor('postgres');
const testUrl = urlFor(TEST_DB_NAME);

// Prisma's $executeRawUnsafe rejects a string containing more than one SQL
// command ("cannot insert multiple commands into a prepared statement") —
// splits a migration.sql file into individually-executable statements,
// treating `$$ ... $$` (plpgsql function bodies, e.g. 0001's audit_logs
// trigger) as opaque so semicolons inside them are not split points.
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inDollarQuote = false;
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === '$' && sql[i + 1] === '$') {
      inDollarQuote = !inDollarQuote;
      current += '$$';
      i++;
      continue;
    }
    current += sql[i];
    if (sql[i] === ';' && !inDollarQuote) {
      const trimmed = current.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      current = '';
    }
  }
  const trimmed = current.trim();
  if (trimmed.length > 0) statements.push(trimmed);
  return statements;
}

async function applyMigrationSqlDirectly(
  client: PrismaClient,
  migrationFolder: string,
): Promise<void> {
  const sql = readFileSync(
    path.resolve(__dirname, '../migrations', migrationFolder, 'migration.sql'),
    'utf8',
  );
  for (const statement of splitSqlStatements(sql)) {
    await client.$executeRawUnsafe(statement);
  }
}

async function resetTestDatabase(): Promise<void> {
  const admin = new PrismaClient({ datasourceUrl: adminUrl });
  try {
    await admin.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${TEST_DB_NAME}' AND pid <> pg_backend_pid();`,
    );
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEST_DB_NAME}";`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB_NAME}";`);
  } finally {
    await admin.$disconnect();
  }
}

async function dropTestDatabase(): Promise<void> {
  const admin = new PrismaClient({ datasourceUrl: adminUrl });
  try {
    await admin.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${TEST_DB_NAME}' AND pid <> pg_backend_pid();`,
    );
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEST_DB_NAME}";`);
  } finally {
    await admin.$disconnect();
  }
}

function migrateDeploy(): void {
  execSync('pnpm exec prisma migrate deploy --schema prisma/schema.prisma', {
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'pipe',
  });
}

function runSeed(): void {
  execSync('pnpm exec tsx prisma/seed.ts', {
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'pipe',
  });
}

after(async () => {
  await dropTestDatabase();
});

test('migrations apply cleanly to a fresh database and create exactly the T-G0-3 + T-G0-4 + T-G1-1 + T-G2-1 + T-G2-8 tables', async () => {
  await resetTestDatabase();
  migrateDeploy();

  const client = new PrismaClient({ datasourceUrl: testUrl });
  try {
    const tables = await client.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema IN ('public','platform','commerce') AND table_name <> '_prisma_migrations'
       ORDER BY table_name;`,
    );
    assert.deepEqual(
      tables.map((t) => t.table_name),
      [
        'admin_members',
        'admin_permissions',
        'admin_role_permissions',
        'admin_roles',
        'audit_logs',
        'brands',
        'catalog_import_errors',
        'catalog_import_jobs',
        'catalog_import_rows',
        'categories',
        'category_attributes',
        'idempotency_keys',
        'inbox_processed_events',
        'moderation_cases',
        'moderation_decisions',
        'offer_price_history',
        'otp_challenges',
        'outbox_events',
        'product_attribute_values',
        'product_identifiers',
        'product_media',
        'product_merge_cases',
        'product_variants',
        'products',
        'refresh_tokens',
        'seller_applications',
        'seller_bank_accounts',
        'seller_contracts',
        'seller_documents',
        'seller_members',
        'seller_offers',
        'sellers',
        'sessions',
        'users',
      ],
    );
  } finally {
    await client.$disconnect();
  }
});

test('migrations 0001-0009 re-deploy against an already-migrated database is a clean no-op', () => {
  assert.doesNotThrow(() => migrateDeploy());
});

test('0004 applies cleanly directly on top of only T-G0-3 (0001), with no hidden dependency on 0002/0003', async () => {
  // Per the ticket's own bar: "Migration test passes on a fresh DB and on a
  // DB with only T-G0-3's migration already applied." Applies 0001's and
  // 0004's raw SQL directly (bypassing 0002/0003 entirely, and bypassing
  // `prisma migrate deploy`'s strict sequential gate) to prove 0004's own
  // FKs (seller_members.user_id, seller_applications.reviewer_id -> users.id)
  // only ever need the `users` table from 0001, not anything 0002/0003 add.
  await resetTestDatabase();
  try {
    const client = new PrismaClient({ datasourceUrl: testUrl });
    try {
      await applyMigrationSqlDirectly(client, '0001_identity_rbac_outbox');
      await applyMigrationSqlDirectly(client, '0004_seller_onboarding');

      const tables = await client.$queryRawUnsafe<{ table_name: string }[]>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name LIKE 'seller%'
         ORDER BY table_name;`,
      );
      assert.deepEqual(
        tables.map((t) => t.table_name),
        [
          'seller_applications',
          'seller_bank_accounts',
          'seller_contracts',
          'seller_documents',
          'seller_members',
          'sellers',
        ],
      );
    } finally {
      await client.$disconnect();
    }
  } finally {
    // Leave the DB back in a known, fully-migrated state for the remaining
    // tests in this file, which assume the full 0001-0004 chain via
    // `prisma migrate deploy`'s own ledger — restored even if an assertion
    // above failed, so one failing test doesn't cascade into every test
    // that runs after it in this file.
    await resetTestDatabase();
    migrateDeploy();
  }
});

test('0005 applies cleanly directly on top of only 0001+0004, with no hidden dependency on 0002/0003', async () => {
  // Same bar as the 0004-on-0001 test above: 0005 only ALTERs the sellers
  // table 0004 created, so it must not implicitly need anything 0002/0003
  // add (sessions/refresh_tokens/outbox updated_at).
  await resetTestDatabase();
  try {
    const client = new PrismaClient({ datasourceUrl: testUrl });
    try {
      await applyMigrationSqlDirectly(client, '0001_identity_rbac_outbox');
      await applyMigrationSqlDirectly(client, '0004_seller_onboarding');
      await applyMigrationSqlDirectly(client, '0005_seller_profile_fields');

      const columns = await client.$queryRawUnsafe<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'sellers' AND column_name IN ('description','logo_object_key','working_hours','delivery_terms')
         ORDER BY column_name;`,
      );
      assert.deepEqual(
        columns.map((c) => c.column_name),
        ['delivery_terms', 'description', 'logo_object_key', 'working_hours'],
      );
    } finally {
      await client.$disconnect();
    }
  } finally {
    await resetTestDatabase();
    migrateDeploy();
  }
});

test('0006 applies cleanly directly on top of only 0001+0004, with no hidden dependency on 0002/0003/0005', async () => {
  // Same bar as the 0004-on-0001 and 0005-on-0001+0004 tests above: 0006
  // only ALTERs the seller_bank_accounts table 0004 created and FKs to the
  // users table 0001 created, so it must not implicitly need 0002/0003/0005.
  await resetTestDatabase();
  try {
    const client = new PrismaClient({ datasourceUrl: testUrl });
    try {
      await applyMigrationSqlDirectly(client, '0001_identity_rbac_outbox');
      await applyMigrationSqlDirectly(client, '0004_seller_onboarding');
      await applyMigrationSqlDirectly(client, '0006_seller_bank_account_review');

      const columns = await client.$queryRawUnsafe<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'seller_bank_accounts' AND column_name IN ('reviewer_id','reviewed_at')
         ORDER BY column_name;`,
      );
      assert.deepEqual(
        columns.map((c) => c.column_name),
        ['reviewed_at', 'reviewer_id'],
      );
    } finally {
      await client.$disconnect();
    }
  } finally {
    await resetTestDatabase();
    migrateDeploy();
  }
});

test('0007 applies cleanly directly on top of only 0001+0004, with no hidden dependency on 0002/0003/0005/0006', async () => {
  // Same bar as the other "...applies cleanly directly on top of only..."
  // tests above: 0007 only RENAMEs a column on the seller_bank_accounts
  // table 0004 created, so it must not implicitly need 0002/0003/0005/0006.
  await resetTestDatabase();
  try {
    const client = new PrismaClient({ datasourceUrl: testUrl });
    try {
      await applyMigrationSqlDirectly(client, '0001_identity_rbac_outbox');
      await applyMigrationSqlDirectly(client, '0004_seller_onboarding');
      await applyMigrationSqlDirectly(client, '0007_seller_bank_account_raw_reference_rename');

      const columns = await client.$queryRawUnsafe<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'seller_bank_accounts' AND column_name IN ('encrypted_reference','raw_reference')
         ORDER BY column_name;`,
      );
      assert.deepEqual(
        columns.map((c) => c.column_name),
        ['raw_reference'],
      );
    } finally {
      await client.$disconnect();
    }
  } finally {
    await resetTestDatabase();
    migrateDeploy();
  }
});

test('0007: seller_bank_accounts.raw_reference preserves pre-existing encrypted_reference data (including a leading zero) across the rename, and the old column name is gone', async () => {
  // G1 QA review major #4: the rename must be additive-safe — no data loss.
  // Applies the full chain up to (but excluding) 0007 directly — Prisma
  // Client's generated queries always project every column the full schema
  // knows about, so sellers needs 0005's columns present before
  // client.seller.create() can succeed even though this test is only about
  // seller_bank_accounts. The bank account row itself is still written via
  // raw SQL under the OLD column name (Prisma Client only knows the NEW
  // field name, which doesn't exist in the DB yet at this point), then 0007
  // is applied and the row is read back under the NEW name via Prisma
  // Client.
  await resetTestDatabase();
  try {
    const client = new PrismaClient({ datasourceUrl: testUrl });
    try {
      await applyMigrationSqlDirectly(client, '0001_identity_rbac_outbox');
      await applyMigrationSqlDirectly(client, '0004_seller_onboarding');
      await applyMigrationSqlDirectly(client, '0005_seller_profile_fields');
      await applyMigrationSqlDirectly(client, '0006_seller_bank_account_review');

      const seller = await client.seller.create({
        data: {
          legalName: 'Pre-Rename Trading LLC',
          taxId: '0099988877',
          legalType: 'LLC',
          displayName: 'Pre-Rename Store',
        },
      });
      const [preRenameRow] = await client.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO "seller_bank_accounts" (id, seller_id, encrypted_reference, updated_at)
         VALUES (gen_random_uuid(), '${seller.id}', '00112233445566', now())
         RETURNING id;`,
      );
      assert.ok(preRenameRow);

      await applyMigrationSqlDirectly(client, '0007_seller_bank_account_raw_reference_rename');

      const bankAccount = await client.sellerBankAccount.findUniqueOrThrow({
        where: { id: preRenameRow.id },
      });
      assert.equal(bankAccount.rawReference, '00112233445566');

      const oldColumn = await client.$queryRawUnsafe<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'seller_bank_accounts' AND column_name = 'encrypted_reference';`,
      );
      assert.equal(oldColumn.length, 0);
    } finally {
      await client.$disconnect();
    }
  } finally {
    await resetTestDatabase();
    migrateDeploy();
  }
});

test('0008 applies cleanly directly on top of only 0001+0004, with no hidden dependency on 0002/0003/0005/0006/0007', async () => {
  // Same bar as the other "...applies cleanly directly on top of only..."
  // tests above: 0008's only cross-migration FK dependency is
  // seller_offers.seller_id -> sellers(id) (0004), which itself depends on
  // users (0001) via seller_applications/seller_members — no dependency on
  // 0002/0003/0005/0006/0007's auth-session/profile/bank-review additions.
  await resetTestDatabase();
  try {
    const client = new PrismaClient({ datasourceUrl: testUrl });
    try {
      await applyMigrationSqlDirectly(client, '0001_identity_rbac_outbox');
      await applyMigrationSqlDirectly(client, '0004_seller_onboarding');
      await applyMigrationSqlDirectly(client, '0008_catalog_offers');

      const tables = await client.$queryRawUnsafe<{ table_name: string }[]>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name IN ('categories','category_attributes','brands','products',
             'product_variants','product_attribute_values','product_identifiers',
             'seller_offers','offer_price_history','product_media',
             'product_merge_cases','moderation_cases','moderation_decisions')
         ORDER BY table_name;`,
      );
      assert.deepEqual(
        tables.map((t) => t.table_name),
        [
          'brands',
          'categories',
          'category_attributes',
          'moderation_cases',
          'moderation_decisions',
          'offer_price_history',
          'product_attribute_values',
          'product_identifiers',
          'product_media',
          'product_merge_cases',
          'product_variants',
          'products',
          'seller_offers',
        ],
      );
    } finally {
      await client.$disconnect();
    }
  } finally {
    await resetTestDatabase();
    migrateDeploy();
  }
});

test('0008: categories/category_attributes/brands/products/product_variants/product_attribute_values/seller_offers/product_media/product_merge_cases carry updated_at + version; product_identifiers/offer_price_history/moderation_decisions (append-only) do not; moderation_cases carries updated_at but no version', async () => {
  const client = new PrismaClient({ datasourceUrl: testUrl });
  try {
    const mutableTables = [
      'categories',
      'category_attributes',
      'brands',
      'products',
      'product_variants',
      'product_attribute_values',
      'seller_offers',
      'product_media',
      'product_merge_cases',
    ];
    const appendOnlyTables = ['product_identifiers', 'offer_price_history', 'moderation_decisions'];
    const columns = await client.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_name IN (${[...mutableTables, ...appendOnlyTables, 'moderation_cases']
         .map((t) => `'${t}'`)
         .join(',')})
         AND column_name IN ('updated_at','version')
       ORDER BY table_name, column_name;`,
    );
    for (const table of mutableTables) {
      assert.ok(
        columns.some((c) => c.table_name === table && c.column_name === 'updated_at'),
        `${table} missing updated_at`,
      );
      assert.ok(
        columns.some((c) => c.table_name === table && c.column_name === 'version'),
        `${table} missing version`,
      );
    }
    for (const table of appendOnlyTables) {
      assert.ok(
        !columns.some((c) => c.table_name === table && c.column_name === 'updated_at'),
        `${table} unexpectedly has updated_at`,
      );
      assert.ok(
        !columns.some((c) => c.table_name === table && c.column_name === 'version'),
        `${table} unexpectedly has version`,
      );
    }
    assert.ok(
      columns.some((c) => c.table_name === 'moderation_cases' && c.column_name === 'updated_at'),
    );
    assert.ok(
      !columns.some((c) => c.table_name === 'moderation_cases' && c.column_name === 'version'),
    );
  } finally {
    await client.$disconnect();
  }
});

test('0008: seller_offers(seller_id, variant_id) and product_identifiers(type, value) hot indexes exist exactly as named', async () => {
  const client = new PrismaClient({ datasourceUrl: testUrl });
  try {
    const offerIndexes = await client.$queryRawUnsafe<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes
       WHERE tablename = 'seller_offers' AND indexdef LIKE '%(seller_id, variant_id)%';`,
    );
    assert.equal(offerIndexes.length, 1);

    const identifierIndexes = await client.$queryRawUnsafe<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes
       WHERE tablename = 'product_identifiers' AND indexdef LIKE '%(type, value)%';`,
    );
    assert.equal(identifierIndexes.length, 1);
  } finally {
    await client.$disconnect();
  }
});

test('0008: seller_offers.price_minor > 0 CHECK constraint rejects a non-positive price', async () => {
  const client = new PrismaClient({ datasourceUrl: testUrl });
  try {
    const seller = await client.seller.create({
      data: {
        legalName: 'Price Check Trading LLC',
        taxId: '0033445566',
        legalType: 'LLC',
        displayName: 'Price Check Store',
      },
    });
    const category = await client.category.create({
      data: { slug: `price-check-${Date.now()}`, name: 'Price Check Category' },
    });
    const product = await client.product.create({
      data: { categoryId: category.id, title: 'Price Check Product' },
    });
    const variant = await client.productVariant.create({
      data: { productId: product.id, options: { size: 'L' }, optionsHash: 'a'.repeat(64) },
    });

    await assert.rejects(
      client.$executeRawUnsafe(
        `INSERT INTO seller_offers (id, seller_id, variant_id, sku, price_minor, currency, fulfillment_mode, created_at, updated_at)
         VALUES (gen_random_uuid(), '${seller.id}', '${variant.id}', 'SKU-NEG', -100, 'UZS', 'SELLER_WAREHOUSE', now(), now());`,
      ),
      /seller_offers_price_minor_positive_check/,
    );

    const offer = await client.sellerOffer.create({
      data: {
        sellerId: seller.id,
        variantId: variant.id,
        sku: 'SKU-POS',
        priceMinor: 100n,
        currency: 'UZS',
        fulfillmentMode: 'SELLER_WAREHOUSE',
      },
    });
    assert.equal(offer.priceMinor, 100n);
  } finally {
    await client.$disconnect();
  }
});

test('0008: categories self-reference via parent_id for nested taxonomy, slug is unique', async () => {
  const client = new PrismaClient({ datasourceUrl: testUrl });
  try {
    const suffix = Date.now();
    const parent = await client.category.create({
      data: { slug: `parent-${suffix}`, name: 'Parent' },
    });
    const child = await client.category.create({
      data: { slug: `child-${suffix}`, name: 'Child', parentId: parent.id },
    });
    assert.equal(child.parentId, parent.id);

    await assert.rejects(
      client.category.create({ data: { slug: `parent-${suffix}`, name: 'Duplicate Slug' } }),
    );
  } finally {
    await client.$disconnect();
  }
});

test('0008: products.canonical_id is a nullable self-referencing FK (merge-redirect) — a merged-away product is never deleted, only redirected', async () => {
  const client = new PrismaClient({ datasourceUrl: testUrl });
  try {
    const category = await client.category.create({
      data: { slug: `merge-redirect-${Date.now()}`, name: 'Merge Redirect Category' },
    });
    const winning = await client.product.create({
      data: { categoryId: category.id, title: 'Winning Product' },
    });
    const losing = await client.product.create({
      data: { categoryId: category.id, title: 'Losing Product' },
    });
    assert.equal(losing.canonicalId, null);

    const redirected = await client.product.update({
      where: { id: losing.id },
      data: { canonicalId: winning.id },
    });
    assert.equal(redirected.canonicalId, winning.id);

    const stillExists = await client.product.findUniqueOrThrow({ where: { id: losing.id } });
    assert.equal(stillExists.id, losing.id);
  } finally {
    await client.$disconnect();
  }
});

test('0008: category_attributes.type, seller_offers.currency and seller_offers.fulfillment_mode are VARCHAR, not a native Postgres enum', async () => {
  const client = new PrismaClient({ datasourceUrl: testUrl });
  try {
    const columns = await client.$queryRawUnsafe<
      { table_name: string; column_name: string; data_type: string }[]
    >(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
       WHERE (table_name = 'category_attributes' AND column_name = 'type')
          OR (table_name = 'seller_offers' AND column_name IN ('currency','fulfillment_mode'))
       ORDER BY table_name, column_name;`,
    );
    assert.equal(columns.length, 3);
    for (const column of columns) {
      assert.equal(column.data_type, 'character varying');
    }
  } finally {
    await client.$disconnect();
  }
});

test('0008: category_attributes.validation is stored as JSON (jsonb), not relational columns', async () => {
  const client = new PrismaClient({ datasourceUrl: testUrl });
  try {
    const [column] = await client.$queryRawUnsafe<{ data_type: string }[]>(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name = 'category_attributes' AND column_name = 'validation';`,
    );
    assert.equal(column?.data_type, 'jsonb');
  } finally {
    await client.$disconnect();
  }
});

test('0004: sellers.legal_type and seller_documents.type are VARCHAR, not a native Postgres enum (docs/open-questions.md #6)', async () => {
  const client = new PrismaClient({ datasourceUrl: testUrl });
  try {
    const columns = await client.$queryRawUnsafe<
      { table_name: string; column_name: string; data_type: string; udt_name: string }[]
    >(
      `SELECT table_name, column_name, data_type, udt_name FROM information_schema.columns
       WHERE (table_name = 'sellers' AND column_name = 'legal_type')
          OR (table_name = 'seller_documents' AND column_name = 'type')
       ORDER BY table_name;`,
    );
    assert.equal(columns.length, 2);
    for (const column of columns) {
      assert.equal(column.data_type, 'character varying');
    }
  } finally {
    await client.$disconnect();
  }
});

test('0004+0007: sellers.tax_id and seller_bank_accounts.raw_reference round-trip a leading zero unchanged (TZ §28)', async () => {
  const client = new PrismaClient({ datasourceUrl: testUrl });
  try {
    const seller = await client.seller.create({
      data: {
        legalName: 'Leading Zero Trading LLC',
        taxId: '0012345678',
        legalType: 'LLC',
        displayName: 'Leading Zero Store',
      },
    });
    assert.equal(seller.taxId, '0012345678');

    const reloadedSeller = await client.seller.findUniqueOrThrow({ where: { id: seller.id } });
    assert.equal(reloadedSeller.taxId, '0012345678');

    const bankAccount = await client.sellerBankAccount.create({
      data: { sellerId: seller.id, rawReference: '00998877665544' },
    });
    assert.equal(bankAccount.rawReference, '00998877665544');

    const reloadedBankAccount = await client.sellerBankAccount.findUniqueOrThrow({
      where: { id: bankAccount.id },
    });
    assert.equal(reloadedBankAccount.rawReference, '00998877665544');
  } finally {
    await client.$disconnect();
  }
});

test('0004: seller_members has the composite (seller_id, user_id) index named exactly as TZ §30 lists it', async () => {
  const client = new PrismaClient({ datasourceUrl: testUrl });
  try {
    const indexes = await client.$queryRawUnsafe<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes
       WHERE tablename = 'seller_members' AND indexdef LIKE '%(seller_id, user_id)%';`,
    );
    assert.equal(indexes.length, 1);
  } finally {
    await client.$disconnect();
  }
});

test('0004: sellers/seller_applications/seller_documents/seller_members/seller_bank_accounts carry updated_at + version; seller_contracts (append-only) does not', async () => {
  const client = new PrismaClient({ datasourceUrl: testUrl });
  try {
    const mutableTables = [
      'sellers',
      'seller_applications',
      'seller_documents',
      'seller_members',
      'seller_bank_accounts',
    ];
    const columns = await client.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_name IN ('sellers','seller_applications','seller_documents','seller_members','seller_bank_accounts','seller_contracts')
         AND column_name IN ('updated_at','version')
       ORDER BY table_name, column_name;`,
    );
    for (const table of mutableTables) {
      assert.ok(
        columns.some((c) => c.table_name === table && c.column_name === 'updated_at'),
        `${table} missing updated_at`,
      );
      assert.ok(
        columns.some((c) => c.table_name === table && c.column_name === 'version'),
        `${table} missing version`,
      );
    }
    // seller_contracts has no updated_at (append-only, never mutated after
    // creation). It does have its own `version` column, but that is the
    // contract template version number (business data, TZ §06's literal
    // column), not an optimistic-concurrency counter — so only updated_at
    // is checked here, not the absence of `version` itself.
    assert.ok(
      !columns.some((c) => c.table_name === 'seller_contracts' && c.column_name === 'updated_at'),
    );
  } finally {
    await client.$disconnect();
  }
});

test('0005: sellers gains description/logo_object_key/working_hours/delivery_terms as nullable TEXT columns', async () => {
  const client = new PrismaClient({ datasourceUrl: testUrl });
  try {
    const columns = await client.$queryRawUnsafe<
      { column_name: string; data_type: string; is_nullable: string }[]
    >(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
       WHERE table_name = 'sellers'
         AND column_name IN ('description','logo_object_key','working_hours','delivery_terms')
       ORDER BY column_name;`,
    );
    assert.deepEqual(
      columns.map((c) => c.column_name),
      ['delivery_terms', 'description', 'logo_object_key', 'working_hours'],
    );
    for (const column of columns) {
      assert.equal(column.data_type, 'text');
      assert.equal(column.is_nullable, 'YES');
    }
  } finally {
    await client.$disconnect();
  }
});

test('0005: a pre-existing sellers row created before this migration (none of the new columns set) still reads back with those columns null', async () => {
  const client = new PrismaClient({ datasourceUrl: testUrl });
  try {
    const seller = await client.seller.create({
      data: {
        legalName: 'Profile Fields Migration LLC',
        taxId: '5551234567',
        legalType: 'LLC',
        displayName: 'Profile Fields Store',
      },
    });
    assert.equal(seller.description, null);
    assert.equal(seller.logoObjectKey, null);
    assert.equal(seller.workingHours, null);
    assert.equal(seller.deliveryTerms, null);

    const updated = await client.seller.update({
      where: { id: seller.id },
      data: {
        description: 'Best honey in town',
        logoObjectKey: 'seller-logos/seller-1/logo.png',
        workingHours: 'Mon-Fri 09:00-18:00',
        deliveryTerms: 'Tashkent shahri boylab 1-2 kun',
      },
    });
    assert.equal(updated.description, 'Best honey in town');
    assert.equal(updated.logoObjectKey, 'seller-logos/seller-1/logo.png');
    assert.equal(updated.workingHours, 'Mon-Fri 09:00-18:00');
    assert.equal(updated.deliveryTerms, 'Tashkent shahri boylab 1-2 kun');
  } finally {
    await client.$disconnect();
  }
});

test('0006: seller_bank_accounts gains reviewer_id/reviewed_at as nullable columns, no new status enum', async () => {
  const client = new PrismaClient({ datasourceUrl: testUrl });
  try {
    const columns = await client.$queryRawUnsafe<
      { column_name: string; data_type: string; udt_name: string; is_nullable: string }[]
    >(
      `SELECT column_name, data_type, udt_name, is_nullable FROM information_schema.columns
       WHERE table_name = 'seller_bank_accounts' AND column_name IN ('reviewer_id','reviewed_at')
       ORDER BY column_name;`,
    );
    assert.deepEqual(
      columns.map((c) => c.column_name),
      ['reviewed_at', 'reviewer_id'],
    );
    for (const column of columns) {
      assert.equal(column.is_nullable, 'YES');
    }
    assert.equal(columns.find((c) => c.column_name === 'reviewer_id')?.udt_name, 'uuid');
    assert.equal(columns.find((c) => c.column_name === 'reviewed_at')?.udt_name, 'timestamptz');
  } finally {
    await client.$disconnect();
  }
});

test('0006: a pre-existing seller_bank_accounts row (created before this migration) reads back with reviewer_id/reviewed_at null, then records a reviewer on approval', async () => {
  const client = new PrismaClient({ datasourceUrl: testUrl });
  try {
    const seller = await client.seller.create({
      data: {
        legalName: 'Bank Review Migration LLC',
        taxId: '0019876543',
        legalType: 'LLC',
        displayName: 'Bank Review Store',
      },
    });
    const reviewer = await client.user.create({ data: { phone: `+99890${Date.now()}` } });

    const bankAccount = await client.sellerBankAccount.create({
      data: { sellerId: seller.id, rawReference: '00112233445566' },
    });
    assert.equal(bankAccount.reviewerId, null);
    assert.equal(bankAccount.reviewedAt, null);

    const approved = await client.sellerBankAccount.update({
      where: { id: bankAccount.id },
      data: { verified: true, reviewerId: reviewer.id, reviewedAt: new Date() },
    });
    assert.equal(approved.reviewerId, reviewer.id);
    assert.ok(approved.reviewedAt instanceof Date);
    // raw_reference's leading zero is unaffected by this migration.
    assert.equal(approved.rawReference, '00112233445566');

    // Cleanup, not a resetTestDatabase()+migrateDeploy() round trip like the
    // "applies cleanly directly on top of only ..." tests above (this test
    // never leaves the migration ledger): the seed-determinism test later in
    // this same file asserts an exact `users` row count, so the extra
    // reviewer user (and its seller/bank-account rows) created here must not
    // leak past this test.
    await client.sellerBankAccount.delete({ where: { id: bankAccount.id } });
    await client.seller.delete({ where: { id: seller.id } });
    await client.user.delete({ where: { id: reviewer.id } });
  } finally {
    await client.$disconnect();
  }
});

test('0003: refresh_tokens and platform.outbox_events have a NOT NULL updated_at column', async () => {
  const client = new PrismaClient({ datasourceUrl: testUrl });
  try {
    const columns = await client.$queryRawUnsafe<
      { table_schema: string; table_name: string; is_nullable: string }[]
    >(
      `SELECT table_schema, table_name, is_nullable FROM information_schema.columns
       WHERE column_name = 'updated_at'
         AND (table_name, table_schema) IN (('refresh_tokens', 'public'), ('outbox_events', 'platform'))
       ORDER BY table_name;`,
    );
    assert.equal(columns.length, 2);
    for (const column of columns) {
      assert.equal(column.is_nullable, 'NO');
    }
  } finally {
    await client.$disconnect();
  }
});

test('admin_roles.scope CHECK constraint rejects a non-GLOBAL scope', async () => {
  const client = new PrismaClient({ datasourceUrl: testUrl });
  try {
    await assert.rejects(
      client.$executeRawUnsafe(
        `INSERT INTO admin_roles (id, code, name, scope, created_at, updated_at)
         VALUES (gen_random_uuid(), 'T_SCOPE_CHECK', 'x', 'SELLER', now(), now());`,
      ),
      /admin_roles_scope_g0_check/,
    );
  } finally {
    await client.$disconnect();
  }
});

test('audit_logs is append-only: INSERT succeeds, UPDATE and DELETE are blocked by trigger', async () => {
  const client = new PrismaClient({ datasourceUrl: testUrl });
  try {
    await client.$executeRawUnsafe(
      `INSERT INTO audit_logs (id, actor_type, action, entity_type) VALUES (gen_random_uuid(), 'SYSTEM', 'migration.test', 'test_entity');`,
    );
    await assert.rejects(
      client.$executeRawUnsafe(
        `UPDATE audit_logs SET action = 'tampered' WHERE action = 'migration.test';`,
      ),
      /audit_logs is append-only/,
    );
    await assert.rejects(
      client.$executeRawUnsafe(`DELETE FROM audit_logs WHERE action = 'migration.test';`),
      /audit_logs is append-only/,
    );
  } finally {
    await client.$disconnect();
  }
});

test('commerce.idempotency_keys has composite primary key (scope, key)', async () => {
  const client = new PrismaClient({ datasourceUrl: testUrl });
  try {
    const pk = await client.$queryRawUnsafe<{ constraint_name: string }[]>(
      `SELECT constraint_name FROM information_schema.table_constraints
       WHERE table_schema = 'commerce' AND table_name = 'idempotency_keys' AND constraint_type = 'PRIMARY KEY';`,
    );
    assert.equal(pk.length, 1);

    const cols = await client.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.key_column_usage
       WHERE table_schema = 'commerce' AND table_name = 'idempotency_keys' AND constraint_name = '${pk[0]?.constraint_name}'
       ORDER BY ordinal_position;`,
    );
    assert.deepEqual(
      cols.map((c) => c.column_name),
      ['scope', 'key'],
    );
  } finally {
    await client.$disconnect();
  }
});

test('seed.ts is deterministic: expected rows land, and re-running does not duplicate or error', async () => {
  runSeed();
  runSeed();

  const client = new PrismaClient({ datasourceUrl: testUrl });
  try {
    const [counts] = await client.$queryRawUnsafe<
      {
        users: bigint;
        roles: bigint;
        permissions: bigint;
        members: bigint;
        role_permissions: bigint;
      }[]
    >(
      `SELECT
         (SELECT count(*) FROM users) AS users,
         (SELECT count(*) FROM admin_roles) AS roles,
         (SELECT count(*) FROM admin_permissions) AS permissions,
         (SELECT count(*) FROM admin_members) AS members,
         (SELECT count(*) FROM admin_role_permissions) AS role_permissions;`,
    );
    assert.ok(counts);
    assert.equal(Number(counts.users), 6);
    assert.equal(Number(counts.roles), 5);
    assert.equal(Number(counts.permissions), 7);
    assert.equal(Number(counts.members), 4);
    assert.equal(Number(counts.role_permissions), 10);

    const [superAdminGrant] = await client.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::int AS count FROM admin_role_permissions rp
       JOIN admin_roles ar ON ar.id = rp.role_id
       JOIN admin_permissions ap ON ap.id = rp.permission_id
       WHERE ar.code = 'SUPER_ADMIN' AND ap.resource = 'test' AND ap.action = 'read';`,
    );
    assert.equal(Number(superAdminGrant?.count), 1);

    const [supportAgentGrant] = await client.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::int AS count FROM admin_role_permissions rp
       JOIN admin_roles ar ON ar.id = rp.role_id
       JOIN admin_permissions ap ON ap.id = rp.permission_id
       WHERE ar.code = 'SUPPORT_AGENT' AND ap.resource = 'test' AND ap.action = 'read';`,
    );
    assert.equal(Number(supportAgentGrant?.count), 0);

    // T-G1-1: 4th seeded admin member is MODERATOR, idempotent across reruns
    // (runSeed() above already ran twice with no duplication/error).
    const [moderatorMember] = await client.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::int AS count FROM admin_members am
       JOIN users u ON u.id = am.user_id
       JOIN admin_roles ar ON ar.id = am.role_id
       WHERE ar.code = 'MODERATOR' AND u.phone = '+998900000004';`,
    );
    assert.equal(Number(moderatorMember?.count), 1);

    // seller:moderate -> MODERATOR and SUPER_ADMIN; seller:suspend -> SUPER_ADMIN only
    // (docs/open-questions.md #28 narrowest-safe-default).
    const [moderatorSellerModerate] = await client.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::int AS count FROM admin_role_permissions rp
       JOIN admin_roles ar ON ar.id = rp.role_id
       JOIN admin_permissions ap ON ap.id = rp.permission_id
       WHERE ar.code = 'MODERATOR' AND ap.resource = 'seller' AND ap.action = 'moderate';`,
    );
    assert.equal(Number(moderatorSellerModerate?.count), 1);

    const [moderatorSellerSuspend] = await client.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::int AS count FROM admin_role_permissions rp
       JOIN admin_roles ar ON ar.id = rp.role_id
       JOIN admin_permissions ap ON ap.id = rp.permission_id
       WHERE ar.code = 'MODERATOR' AND ap.resource = 'seller' AND ap.action = 'suspend';`,
    );
    assert.equal(Number(moderatorSellerSuspend?.count), 0);

    const [superAdminSellerSuspend] = await client.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::int AS count FROM admin_role_permissions rp
       JOIN admin_roles ar ON ar.id = rp.role_id
       JOIN admin_permissions ap ON ap.id = rp.permission_id
       WHERE ar.code = 'SUPER_ADMIN' AND ap.resource = 'seller' AND ap.action = 'suspend';`,
    );
    assert.equal(Number(superAdminSellerSuspend?.count), 1);

    // T-G2-1: category:manage/merge_case:approve are SUPER_ADMIN-only
    // (narrowest-safe-default, docs/open-questions.md #7's framing);
    // catalog:moderate/offers:moderate go to both SUPER_ADMIN (baseline) and
    // MODERATOR (api-contract-g2.md permission-code table).
    for (const { resource, action } of [
      { resource: 'category', action: 'manage' },
      { resource: 'catalog', action: 'moderate' },
      { resource: 'merge_case', action: 'approve' },
      { resource: 'offers', action: 'moderate' },
    ]) {
      const [superAdminGrant2] = await client.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*)::int AS count FROM admin_role_permissions rp
         JOIN admin_roles ar ON ar.id = rp.role_id
         JOIN admin_permissions ap ON ap.id = rp.permission_id
         WHERE ar.code = 'SUPER_ADMIN' AND ap.resource = '${resource}' AND ap.action = '${action}';`,
      );
      assert.equal(Number(superAdminGrant2?.count), 1, `SUPER_ADMIN missing ${resource}:${action}`);
    }

    for (const { resource, action } of [
      { resource: 'catalog', action: 'moderate' },
      { resource: 'offers', action: 'moderate' },
    ]) {
      const [moderatorGrant] = await client.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*)::int AS count FROM admin_role_permissions rp
         JOIN admin_roles ar ON ar.id = rp.role_id
         JOIN admin_permissions ap ON ap.id = rp.permission_id
         WHERE ar.code = 'MODERATOR' AND ap.resource = '${resource}' AND ap.action = '${action}';`,
      );
      assert.equal(Number(moderatorGrant?.count), 1, `MODERATOR missing ${resource}:${action}`);
    }

    for (const { resource, action } of [
      { resource: 'category', action: 'manage' },
      { resource: 'merge_case', action: 'approve' },
    ]) {
      const [moderatorGrant] = await client.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*)::int AS count FROM admin_role_permissions rp
         JOIN admin_roles ar ON ar.id = rp.role_id
         JOIN admin_permissions ap ON ap.id = rp.permission_id
         WHERE ar.code = 'MODERATOR' AND ap.resource = '${resource}' AND ap.action = '${action}';`,
      );
      assert.equal(
        Number(moderatorGrant?.count),
        0,
        `MODERATOR unexpectedly has ${resource}:${action}`,
      );
    }

    // T-G2-1: 2 nested category fixtures (parent + child), each with 1
    // required + 1 optional category_attributes row, idempotent across
    // reruns (runSeed() above already ran twice with no duplication/error).
    const [categoryCounts] = await client.$queryRawUnsafe<
      { categories: bigint; attributes: bigint }[]
    >(
      `SELECT
         (SELECT count(*) FROM categories WHERE slug IN ('electronics','electronics-phones')) AS categories,
         (SELECT count(*) FROM category_attributes) AS attributes;`,
    );
    assert.equal(Number(categoryCounts?.categories), 2);
    assert.equal(Number(categoryCounts?.attributes), 4);

    const [nested] = await client.$queryRawUnsafe<{ parent_id: string | null }[]>(
      `SELECT parent_id FROM categories WHERE slug = 'electronics-phones';`,
    );
    assert.ok(nested?.parent_id);

    const [requiredCount] = await client.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::int AS count FROM category_attributes WHERE required = true;`,
    );
    assert.equal(Number(requiredCount?.count), 2);
  } finally {
    await client.$disconnect();
  }
});

test('0009 applies cleanly directly on top of only 0001+0004, with no hidden dependency on 0002/0003/0005/0006/0007/0008', async () => {
  // Same bar as the 0008-on-0001+0004 test above: 0009's only cross-migration
  // FK dependency is catalog_import_jobs.seller_id -> sellers(id) (0004) —
  // the seller_offer_id/product_id FKs on catalog_import_rows reference
  // tables 0008 creates, but both columns are nullable and unused by this
  // isolation test, so 0009's own 3 tables + enum apply without 0008 present.
  await resetTestDatabase();
  try {
    const client = new PrismaClient({ datasourceUrl: testUrl });
    try {
      await applyMigrationSqlDirectly(client, '0001_identity_rbac_outbox');
      await applyMigrationSqlDirectly(client, '0004_seller_onboarding');
      await assert.rejects(
        applyMigrationSqlDirectly(client, '0009_catalog_imports'),
        /relation "seller_offers" does not exist|relation "products" does not exist/,
      );
    } finally {
      await client.$disconnect();
    }
  } finally {
    await resetTestDatabase();
    migrateDeploy();
  }
});

test('0009: catalog_import_jobs(seller_id, content_hash) partial unique index rejects a duplicate upload of the same content for the same seller, but allows it once the first job is FAILED', async () => {
  const client = new PrismaClient({ datasourceUrl: testUrl });
  try {
    const seller = await client.seller.create({
      data: {
        legalName: 'Import Dedup Trading LLC',
        taxId: '0055667788',
        legalType: 'LLC',
        displayName: 'Import Dedup Store',
      },
    });

    const first = await client.catalogImportJob.create({
      data: {
        sellerId: seller.id,
        objectKey: 'catalog-imports/fixture-1.csv',
        contentHash: 'a'.repeat(64),
        createdBy: seller.id,
        status: 'READY',
      },
    });
    assert.ok(first.id);

    await assert.rejects(
      client.catalogImportJob.create({
        data: {
          sellerId: seller.id,
          objectKey: 'catalog-imports/fixture-2.csv',
          contentHash: 'a'.repeat(64),
          createdBy: seller.id,
          status: 'VALIDATING',
        },
      }),
      /Unique constraint failed on the fields: \(`seller_id`,`content_hash`\)/,
    );

    // A FAILED job with the same content_hash does not block a fresh upload
    // — the partial index only covers status != 'FAILED' rows.
    await client.catalogImportJob.update({ where: { id: first.id }, data: { status: 'FAILED' } });
    const second = await client.catalogImportJob.create({
      data: {
        sellerId: seller.id,
        objectKey: 'catalog-imports/fixture-3.csv',
        contentHash: 'a'.repeat(64),
        createdBy: seller.id,
        status: 'VALIDATING',
      },
    });
    assert.ok(second.id);
  } finally {
    await client.$disconnect();
  }
});

test('0009: catalog_import_rows/catalog_import_errors are append-only (no updated_at/version); catalog_import_jobs is mutable (has both)', async () => {
  const client = new PrismaClient({ datasourceUrl: testUrl });
  try {
    const columns = await client.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_name IN ('catalog_import_jobs','catalog_import_rows','catalog_import_errors')
         AND column_name IN ('updated_at','version')
       ORDER BY table_name, column_name;`,
    );
    assert.ok(columns.some((c) => c.table_name === 'catalog_import_jobs' && c.column_name === 'updated_at'));
    assert.ok(columns.some((c) => c.table_name === 'catalog_import_jobs' && c.column_name === 'version'));
    for (const table of ['catalog_import_rows', 'catalog_import_errors']) {
      assert.ok(!columns.some((c) => c.table_name === table && c.column_name === 'updated_at'));
      assert.ok(!columns.some((c) => c.table_name === table && c.column_name === 'version'));
    }
  } finally {
    await client.$disconnect();
  }
});
