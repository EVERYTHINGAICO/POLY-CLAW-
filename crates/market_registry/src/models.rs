use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use storage::models::{Market, MarketToken};

#[allow(non_camel_case_types)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LifecycleState {
    DISCOVERED,
    ELIGIBLE,
    TRADING,
    CLOSING_SOON,
    CLOSED,
    RESOLVED,
    SETTLED,
    DELISTED,
}

impl LifecycleState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::DISCOVERED => "DISCOVERED",
            Self::ELIGIBLE => "ELIGIBLE",
            Self::TRADING => "TRADING",
            Self::CLOSING_SOON => "CLOSING_SOON",
            Self::CLOSED => "CLOSED",
            Self::RESOLVED => "RESOLVED",
            Self::SETTLED => "SETTLED",
            Self::DELISTED => "DELISTED",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "DISCOVERED" => Some(Self::DISCOVERED),
            "ELIGIBLE" => Some(Self::ELIGIBLE),
            "TRADING" => Some(Self::TRADING),
            "CLOSING_SOON" => Some(Self::CLOSING_SOON),
            "CLOSED" => Some(Self::CLOSED),
            "RESOLVED" => Some(Self::RESOLVED),
            "SETTLED" => Some(Self::SETTLED),
            "DELISTED" => Some(Self::DELISTED),
            _ => None,
        }
    }

    pub fn rank(self) -> u8 {
        match self {
            Self::DISCOVERED => 0,
            Self::ELIGIBLE => 1,
            Self::TRADING => 2,
            Self::CLOSING_SOON => 3,
            Self::CLOSED => 4,
            Self::RESOLVED => 5,
            Self::SETTLED => 6,
            Self::DELISTED => 7,
        }
    }
}

#[derive(Debug, Clone)]
pub struct MarketMetadata {
    pub market: Market,
    pub market_token: Option<MarketToken>,
    pub token_mapping_valid: bool,
}

#[derive(Debug, Clone)]
pub struct MarketRegistryConfig {
    pub refresh_interval_ms: u64,
    pub closing_buffer_seconds: i64,
}

impl Default for MarketRegistryConfig {
    fn default() -> Self {
        Self {
            refresh_interval_ms: 30_000,
            closing_buffer_seconds: 60,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct GammaMarket {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub question: String,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub closed: bool,
    #[serde(default)]
    pub resolved: bool,
    #[serde(default)]
    pub archived: bool,
    #[serde(default, rename = "endDate")]
    pub end_date: Option<String>,
    #[serde(default)]
    pub volume: Option<serde_json::Value>,
    #[serde(default)]
    pub liquidity: Option<serde_json::Value>,
    #[serde(default, rename = "clobTokenIds")]
    pub clob_token_ids: Option<String>,
    #[serde(default)]
    pub outcomes: Option<String>,
    #[serde(default, rename = "minimum_tick_size")]
    pub minimum_tick_size: Option<serde_json::Value>,
    #[serde(default, rename = "minimum_order_size")]
    pub minimum_order_size: Option<serde_json::Value>,
    #[serde(default, rename = "tick_size")]
    pub tick_size: Option<serde_json::Value>,
    #[serde(default, rename = "min_order_size")]
    pub min_order_size: Option<serde_json::Value>,
    #[serde(default, rename = "fee_bps")]
    pub fee_bps: Option<serde_json::Value>,
    #[serde(default, rename = "events")]
    pub events: Option<Vec<GammaEvent>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GammaEvent {
    #[serde(default)]
    pub category: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum GammaMarketsResponse {
    List(Vec<GammaMarket>),
    Wrapped {
        data: Vec<GammaMarket>,
    },
    WrappedMarkets {
        markets: Vec<GammaMarket>,
    },
}

impl GammaMarketsResponse {
    pub fn into_markets(self) -> Vec<GammaMarket> {
        match self {
            Self::List(markets) => markets,
            Self::Wrapped { data } => data,
            Self::WrappedMarkets { markets } => markets,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct MarketCacheSnapshot {
    pub markets: HashMap<String, MarketMetadata>,
    pub token_id_to_market_id: HashMap<String, String>,
    pub last_sync_ts_ms: i64,
}
