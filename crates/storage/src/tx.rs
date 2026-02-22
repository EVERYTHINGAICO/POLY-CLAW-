use anyhow::{Context, Result};
use sqlx::{Sqlite, SqlitePool, Transaction};

pub struct Tx<'a> {
    pub tx: Transaction<'a, Sqlite>,
}

pub async fn begin_immediate(pool: &SqlitePool) -> Result<Tx<'_>> {
    let mut tx = pool
        .begin()
        .await
        .context("failed to begin sqlite transaction")?;

    // sqlx 0.7 starts SQLite transactions with `BEGIN` (deferred). Rebind to
    // `BEGIN IMMEDIATE` so all financial writes acquire the writer lock upfront.
    sqlx::query("ROLLBACK")
        .execute(&mut *tx)
        .await
        .context("failed to reset deferred transaction before BEGIN IMMEDIATE")?;

    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut *tx)
        .await
        .context("failed to execute BEGIN IMMEDIATE")?;

    Ok(Tx { tx })
}

impl<'a> Tx<'a> {
    pub async fn commit(self) -> Result<()> {
        self.tx
            .commit()
            .await
            .context("failed to commit sqlite transaction")
    }

    pub async fn rollback(self) -> Result<()> {
        self.tx
            .rollback()
            .await
            .context("failed to rollback sqlite transaction")
    }
}
