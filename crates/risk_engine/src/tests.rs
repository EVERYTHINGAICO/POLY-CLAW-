use std::sync::Arc;

use crate::adapters::{
    FundsLedgerSnapshotProvider, MarketRegistrySnapshotProvider, RiskSnapshotBuilder,
};
use crate::engine::RiskEngine;
use crate::traits::RiskValidator;
use crate::types::{RiskDecision, RiskRejectionReason, RiskRequest};

struct MockFundsProvider {
    total_capital: f64,
    capital_at_risk: f64,
}

impl FundsLedgerSnapshotProvider for MockFundsProvider {
    fn get_total_capital(&self) -> f64 {
        self.total_capital
    }

    fn get_capital_at_risk(&self) -> f64 {
        self.capital_at_risk
    }
}

struct MockMarketProvider {
    market_capital: f64,
    outcome_position: f64,
    market_expiration: u64,
}

impl MarketRegistrySnapshotProvider for MockMarketProvider {
    fn get_market_capital(&self, _market_id: &str) -> f64 {
        self.market_capital
    }

    fn get_outcome_position(&self, _market_id: &str, _outcome_id: &str) -> f64 {
        self.outcome_position
    }

    fn get_market_expiration(&self, _market_id: &str) -> u64 {
        self.market_expiration
    }
}

fn build_engine() -> RiskEngine {
    let provider = config::provider::StaticConfigProvider::load()
        .expect("static config provider must load deterministic defaults");
    let provider: Arc<dyn config::provider::ConfigurationProvider> = Arc::new(provider);
    RiskEngine::new(provider)
}

fn build_request(
    market_id: &str,
    outcome_id: &str,
    requested_shares: f64,
    price: f64,
    expiration_timestamp: u64,
    current_timestamp: u64,
) -> RiskRequest {
    RiskRequest {
        market_id: market_id.to_string(),
        outcome_id: outcome_id.to_string(),
        requested_shares,
        price,
        expiration_timestamp,
        current_timestamp,
    }
}

fn assert_rejection(decision: Result<RiskDecision, crate::errors::RiskEngineError>, expected: RiskRejectionReason) {
    match (decision, expected) {
        (Ok(RiskDecision::Rejected(RiskRejectionReason::InsufficientCapital)), RiskRejectionReason::InsufficientCapital)
        | (Ok(RiskDecision::Rejected(RiskRejectionReason::MarketExposureExceeded)), RiskRejectionReason::MarketExposureExceeded)
        | (Ok(RiskDecision::Rejected(RiskRejectionReason::GlobalExposureExceeded)), RiskRejectionReason::GlobalExposureExceeded)
        | (Ok(RiskDecision::Rejected(RiskRejectionReason::OutcomeLimitExceeded)), RiskRejectionReason::OutcomeLimitExceeded)
        | (Ok(RiskDecision::Rejected(RiskRejectionReason::ExpirationWindowViolation)), RiskRejectionReason::ExpirationWindowViolation)
        | (Ok(RiskDecision::Rejected(RiskRejectionReason::RiskViolationSafeMode)), RiskRejectionReason::RiskViolationSafeMode) => {}
        (other, expected) => panic!("unexpected decision {:?}, expected rejection {:?}", other, expected),
    }
}

#[test]
fn test_validate_allows_valid_order() {
    let engine = build_engine();
    let funds = MockFundsProvider {
        total_capital: 10_000.0,
        capital_at_risk: 1_000.0,
    };
    let markets = MockMarketProvider {
        market_capital: 100.0,
        outcome_position: 100.0,
        market_expiration: 1_000,
    };
    let builder = RiskSnapshotBuilder {
        funds: &funds,
        markets: &markets,
    };
    let snapshot = builder.build_snapshot("m1", "yes");
    let request = build_request("m1", "yes", 10.0, 10.0, builder.get_market_expiration("m1"), 900);

    let decision = engine.validate(&request, &snapshot);
    match decision {
        Ok(RiskDecision::Allowed) => {}
        other => panic!("expected Allowed, got {:?}", other),
    }
}

#[test]
fn test_rejects_insufficient_capital() {
    let engine = build_engine();
    let funds = MockFundsProvider {
        total_capital: 100.0,
        capital_at_risk: 50.0,
    };
    let markets = MockMarketProvider {
        market_capital: 100.0,
        outcome_position: 100.0,
        market_expiration: 1_000,
    };
    let builder = RiskSnapshotBuilder {
        funds: &funds,
        markets: &markets,
    };
    let snapshot = builder.build_snapshot("m1", "yes");
    let request = build_request("m1", "yes", 10.0, 10.0, builder.get_market_expiration("m1"), 900);

    assert_rejection(engine.validate(&request, &snapshot), RiskRejectionReason::InsufficientCapital);
}

#[test]
fn test_rejects_market_exposure_exceeded() {
    let engine = build_engine();
    let funds = MockFundsProvider {
        total_capital: 10_000.0,
        capital_at_risk: 1_000.0,
    };
    let markets = MockMarketProvider {
        market_capital: 450.0,
        outcome_position: 100.0,
        market_expiration: 1_000,
    };
    let builder = RiskSnapshotBuilder {
        funds: &funds,
        markets: &markets,
    };
    let snapshot = builder.build_snapshot("m1", "yes");
    let request = build_request("m1", "yes", 10.0, 10.0, builder.get_market_expiration("m1"), 900);

    assert_rejection(
        engine.validate(&request, &snapshot),
        RiskRejectionReason::MarketExposureExceeded,
    );
}

#[test]
fn test_rejects_global_exposure_exceeded() {
    let engine = build_engine();
    let funds = MockFundsProvider {
        total_capital: 4_000.0,
        capital_at_risk: 2_950.0,
    };
    let markets = MockMarketProvider {
        market_capital: 100.0,
        outcome_position: 100.0,
        market_expiration: 1_000,
    };
    let builder = RiskSnapshotBuilder {
        funds: &funds,
        markets: &markets,
    };
    let snapshot = builder.build_snapshot("m1", "yes");
    let request = build_request("m1", "yes", 10.0, 10.0, builder.get_market_expiration("m1"), 900);

    assert_rejection(
        engine.validate(&request, &snapshot),
        RiskRejectionReason::GlobalExposureExceeded,
    );
}

#[test]
fn test_rejects_outcome_limit_exceeded() {
    let engine = build_engine();
    let funds = MockFundsProvider {
        total_capital: 10_000.0,
        capital_at_risk: 1_000.0,
    };
    let markets = MockMarketProvider {
        market_capital: 100.0,
        outcome_position: 1_995.0,
        market_expiration: 1_000,
    };
    let builder = RiskSnapshotBuilder {
        funds: &funds,
        markets: &markets,
    };
    let snapshot = builder.build_snapshot("m1", "yes");
    let request = build_request("m1", "yes", 10.0, 10.0, builder.get_market_expiration("m1"), 900);

    assert_rejection(
        engine.validate(&request, &snapshot),
        RiskRejectionReason::OutcomeLimitExceeded,
    );
}

#[test]
fn test_rejects_expiration_window_violation() {
    let engine = build_engine();
    let funds = MockFundsProvider {
        total_capital: 10_000.0,
        capital_at_risk: 1_000.0,
    };
    let markets = MockMarketProvider {
        market_capital: 100.0,
        outcome_position: 100.0,
        market_expiration: 960,
    };
    let builder = RiskSnapshotBuilder {
        funds: &funds,
        markets: &markets,
    };
    let snapshot = builder.build_snapshot("m1", "yes");
    let request = build_request("m1", "yes", 10.0, 10.0, builder.get_market_expiration("m1"), 900);

    assert_rejection(
        engine.validate(&request, &snapshot),
        RiskRejectionReason::ExpirationWindowViolation,
    );
}
