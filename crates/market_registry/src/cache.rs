use std::collections::HashMap;

use crate::models::{MarketCacheSnapshot, MarketMetadata};

#[derive(Debug, Clone, Default)]
pub struct MarketCache {
    pub markets: HashMap<String, MarketMetadata>,
    pub token_id_to_market_id: HashMap<String, String>,
    pub last_sync_ts_ms: i64,
}

impl MarketCache {
    pub fn clear(&mut self) {
        self.markets.clear();
        self.token_id_to_market_id.clear();
        self.last_sync_ts_ms = 0;
    }

    pub fn upsert_market(&mut self, metadata: MarketMetadata) {
        let market_id = metadata.market.market_id.clone();

        if let Some(existing) = self.markets.get(&market_id) {
            if let Some(existing_yes) = existing.market.yes_token_id.as_ref() {
                self.token_id_to_market_id.remove(existing_yes);
            }
            if let Some(existing_no) = existing.market.no_token_id.as_ref() {
                self.token_id_to_market_id.remove(existing_no);
            }
        }

        if metadata.token_mapping_valid {
            if let (Some(yes_token_id), Some(no_token_id)) = (
                metadata.market.yes_token_id.as_ref(),
                metadata.market.no_token_id.as_ref(),
            ) {
                self.token_id_to_market_id
                    .insert(yes_token_id.clone(), market_id.clone());
                self.token_id_to_market_id
                    .insert(no_token_id.clone(), market_id.clone());
            }
        }

        self.markets.insert(market_id, metadata);
    }

    pub fn get_market_by_token(&self, token_id: &str) -> Option<&MarketMetadata> {
        let market_id = self.token_id_to_market_id.get(token_id)?;
        self.markets.get(market_id)
    }

    pub fn snapshot(&self) -> MarketCacheSnapshot {
        MarketCacheSnapshot {
            markets: self.markets.clone(),
            token_id_to_market_id: self.token_id_to_market_id.clone(),
            last_sync_ts_ms: self.last_sync_ts_ms,
        }
    }
}
