# Prisma 7.1.0 transaction startup timeout fix

`@prisma__client@7.1.0.patch` is applied by pnpm through the root
`patchedDependencies` entry and lockfile hash. Both Node runtime formats are
patched; the generated client and query compiler remain on 7.1.0.

Prisma 7.1.0 races driver transaction startup against `maxWait`. If the timer
wins, the driver's pending connection request can still finish and send `BEGIN`
after Prisma has discarded the transaction. The connection then has no owner.

The patch keeps the startup promise and handles its eventual completion:

```js
const started = driverAdapter.startTransaction(isolationLevel)
// After the existing maxWait race, if the request was abandoned:
transaction.transaction = undefined // only the cleanup below owns the result
void started.then(async tx => {
  if (tx.options.usePhantomQuery) {
    await tx.rollback()
  } else {
    try {
      await tx.executeRaw({ sql: 'ROLLBACK', args: [], argTypes: [] })
    } finally {
      await tx.rollback()
    }
  }
}).catch(() => {}) // the caller has already received the startup timeout
```

The explicit SQL is essential: `@prisma/adapter-pg` 7.1.0's `rollback()` only
releases the connection. Prisma 7.2.0–7.4.0's initial upstream cleanup omits that
SQL and can return a connection still inside a transaction. The complete cleanup
and single-owner handling are also present in the published 7.10.1 transaction
manager (`runtime/client.mjs.map`,
`client-engine-runtime/src/transaction-manager/transaction-manager.ts`). This
backport avoids changing the compiler, schema generation or application APIs.

Regression commands:

```text
pnpm --filter server test:prisma-transaction-start-guards
pnpm --filter server test:prisma-transaction-start-timeout
```

The PostgreSQL regression requires a local `*_pool_test` database. It saturates
eight connections, causes repeated startup timeouts, checks `pg_stat_activity`
and the pool counters, then verifies ordinary commits and rollbacks. CI runs it
against PostgreSQL 16. The release workflow copies this directory before its
frozen production dependency install, so packaged installations use the same
patch. Remove the backport only after a dependency upgrade passes these checks.

Both architecture fresh-install jobs also run the same PostgreSQL regression
from below `/opt/incudal/server`, using the installed production dependencies
and a disposable local database. This checks the packaged runtimes instead of
the source checkout's dependency tree.
