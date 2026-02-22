use anyhow::{Context, Result};
use sqlx::SqlitePool;

pub async fn run_migrations(pool: &SqlitePool) -> Result<()> {
    sqlx::migrate!("../../infrastructure/migrations")
        .run(pool)
        .await
        .context("failed to run storage migrations")?;
    Ok(())
}
