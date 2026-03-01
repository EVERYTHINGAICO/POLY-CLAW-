use anyhow::{Context, Result};
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use std::future::Future;
use std::pin::Pin;

pub struct Database {
    pub pool: SqlitePool,
}

pub async fn connect(database_url: &str) -> Result<Database> {
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .after_connect(|conn, _meta| {
            Box::pin(async move {
                sqlx::query("PRAGMA journal_mode=WAL;")
                    .execute(&mut *conn)
                    .await?;
                sqlx::query("PRAGMA synchronous=NORMAL;")
                    .execute(&mut *conn)
                    .await?;
                sqlx::query("PRAGMA foreign_keys=ON;")
                    .execute(&mut *conn)
                    .await?;
                Ok(())
            })
        })
        .connect(database_url)
        .await
        .with_context(|| format!("failed to initialize sqlite database at {database_url}"))?;

    Ok(Database { pool })
}

impl Database {
    pub async fn atomic<F, T>(&self, f: F) -> Result<T>
    where
        F: for<'a> FnOnce(
            &'a mut sqlx::Transaction<'_, sqlx::Sqlite>,
        ) -> Pin<Box<dyn Future<Output = Result<T>> + Send + 'a>>,
        T: Send,
    {
        let mut tx = crate::tx::begin_immediate(&self.pool)
            .await
            .context("failed to begin atomic transaction with BEGIN IMMEDIATE")?;

        match f(&mut tx.tx).await {
            Ok(value) => {
                tx.commit()
                    .await
                    .context("failed to commit atomic transaction")?;
                Ok(value)
            }
            Err(operation_error) => {
                let operation_error = operation_error.context("atomic operation failed");
                match tx.rollback().await {
                    Ok(()) => Err(operation_error),
                    Err(rollback_error) => Err(operation_error
                        .context(format!("atomic rollback failed: {rollback_error:#}"))),
                }
            }
        }
    }
}
