use std::sync::Arc;
use std::time::Duration;

use tokio::task::JoinHandle;
use tokio::time::MissedTickBehavior;

use crate::market_registry::MarketRegistry;

pub fn start_sync_loop_task(
    registry: Arc<MarketRegistry>,
    interval: Duration,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let _ = registry.initialize().await;
        let mut ticker = tokio::time::interval(interval);
        ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);

        loop {
            ticker.tick().await;
            let _ = registry.sync_all_markets().await;
        }
    })
}
