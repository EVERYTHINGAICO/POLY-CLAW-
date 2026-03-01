use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use crate::errors::ExecutionEngineError;
use crate::execution_context::ExecutionContext;
use crate::types::{ExecutionState, OrderId};
use risk_engine::adapters::{
    FundsLedgerSnapshotProvider, MarketRegistrySnapshotProvider, RiskSnapshotBuilder,
};
use risk_engine::traits::RiskValidator;
use risk_engine::types::{RiskDecision, RiskRequest};

#[derive(Clone, Default)]
pub struct ExecutionCoordinator {
    states: Arc<RwLock<HashMap<OrderId, ExecutionState>>>,
    risk_validator: Option<Arc<dyn RiskValidator>>,
    funds_provider: Option<Arc<dyn FundsLedgerSnapshotProvider>>,
    market_provider: Option<Arc<dyn MarketRegistrySnapshotProvider>>,
}

impl std::fmt::Debug for ExecutionCoordinator {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ExecutionCoordinator")
            .field("states", &"Arc<RwLock<HashMap<OrderId, ExecutionState>>>")
            .field("risk_validator_configured", &self.risk_validator.is_some())
            .field("funds_provider_configured", &self.funds_provider.is_some())
            .field(
                "market_provider_configured",
                &self.market_provider.is_some(),
            )
            .finish()
    }
}

impl ExecutionCoordinator {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_risk_validation(
        mut self,
        risk_validator: Arc<dyn RiskValidator>,
        funds_provider: Arc<dyn FundsLedgerSnapshotProvider>,
        market_provider: Arc<dyn MarketRegistrySnapshotProvider>,
    ) -> Self {
        self.risk_validator = Some(risk_validator);
        self.funds_provider = Some(funds_provider);
        self.market_provider = Some(market_provider);
        self
    }

    pub fn new_with_risk_validation(
        risk_validator: Arc<dyn RiskValidator>,
        funds_provider: Arc<dyn FundsLedgerSnapshotProvider>,
        market_provider: Arc<dyn MarketRegistrySnapshotProvider>,
    ) -> Self {
        Self::new().with_risk_validation(risk_validator, funds_provider, market_provider)
    }

    pub fn submit_execution(&self, context: ExecutionContext) -> Result<(), ExecutionEngineError> {
        self.validate_risk_request(&context)?;
        self.ensure_not_exists(&context.order_id)?;

        let mut guard = self
            .states
            .write()
            .map_err(|_| ExecutionEngineError::InternalError("state lock poisoned".to_string()))?;

        if guard.contains_key(&context.order_id) {
            return Err(ExecutionEngineError::InvalidOrder);
        }

        // submit_execution is the only state-entry creation path.
        guard.insert(context.order_id.clone(), ExecutionState::Pending);
        Self::transition_under_lock(&mut guard, &context.order_id, ExecutionState::Validated)?;
        Ok(())
    }

    pub fn mark_submitted(&self, order_id: &OrderId) -> Result<(), ExecutionEngineError> {
        self.mutate(order_id, ExecutionState::Submitted)
    }

    pub fn mark_acknowledged(&self, order_id: &OrderId) -> Result<(), ExecutionEngineError> {
        self.mutate(order_id, ExecutionState::Acknowledged)
    }

    pub fn mark_partially_filled(&self, order_id: &OrderId) -> Result<(), ExecutionEngineError> {
        self.mutate(order_id, ExecutionState::PartiallyFilled)
    }

    pub fn mark_filled(&self, order_id: &OrderId) -> Result<(), ExecutionEngineError> {
        self.mutate(order_id, ExecutionState::Filled)
    }

    pub fn mark_cancel_requested(&self, order_id: &OrderId) -> Result<(), ExecutionEngineError> {
        self.mutate(order_id, ExecutionState::CancelRequested)
    }

    pub fn mark_cancelled(&self, order_id: &OrderId) -> Result<(), ExecutionEngineError> {
        self.mutate(order_id, ExecutionState::Cancelled)
    }

    pub fn mark_rejected(&self, order_id: &OrderId) -> Result<(), ExecutionEngineError> {
        self.mutate(order_id, ExecutionState::Rejected)
    }

    pub fn mark_failed(&self, order_id: &OrderId) -> Result<(), ExecutionEngineError> {
        let mut guard = self
            .states
            .write()
            .map_err(|_| ExecutionEngineError::InternalError("state lock poisoned".to_string()))?;

        let current = *guard
            .get(order_id)
            .ok_or(ExecutionEngineError::InvalidOrder)?;
        if is_terminal(current) {
            return Err(ExecutionEngineError::InvalidStateTransition);
        }

        guard.insert(order_id.clone(), ExecutionState::Failed);
        Ok(())
    }

    fn validate_risk_request(
        &self,
        context: &ExecutionContext,
    ) -> Result<(), ExecutionEngineError> {
        let risk_validator = self.risk_validator.as_ref().ok_or_else(|| {
            ExecutionEngineError::InternalError("risk validator not configured".to_string())
        })?;
        let funds_provider = self.funds_provider.as_ref().ok_or_else(|| {
            ExecutionEngineError::InternalError(
                "funds snapshot provider not configured".to_string(),
            )
        })?;
        let market_provider = self.market_provider.as_ref().ok_or_else(|| {
            ExecutionEngineError::InternalError(
                "market snapshot provider not configured".to_string(),
            )
        })?;

        if context.created_at_ms < 0 {
            return Err(ExecutionEngineError::InvalidOrder);
        }

        let outcome_id = context.side.risk_outcome_id().to_string();
        let snapshot_builder = RiskSnapshotBuilder {
            funds: funds_provider.as_ref(),
            markets: market_provider.as_ref(),
        };
        let snapshot = snapshot_builder.build_snapshot(&context.market_id, &outcome_id);
        let risk_request = RiskRequest {
            market_id: context.market_id.clone(),
            outcome_id,
            requested_shares: context.quantity.as_f64(),
            price: context.price.as_f64(),
            expiration_timestamp: snapshot_builder.get_market_expiration(&context.market_id),
            current_timestamp: context.created_at_ms as u64,
        };

        match risk_validator.validate(&risk_request, &snapshot) {
            Ok(RiskDecision::Allowed) => Ok(()),
            Ok(RiskDecision::Rejected(reason)) => Err(ExecutionEngineError::RiskRejected(reason)),
            Err(err) => Err(ExecutionEngineError::InternalError(format!(
                "risk validation failure: {:?}",
                err
            ))),
        }
    }

    pub fn get_state(
        &self,
        order_id: &OrderId,
    ) -> Result<Option<ExecutionState>, ExecutionEngineError> {
        let guard = self
            .states
            .read()
            .map_err(|_| ExecutionEngineError::InternalError("state lock poisoned".to_string()))?;
        Ok(guard.get(order_id).copied())
    }

    pub fn is_terminal_state(&self, order_id: &OrderId) -> Result<bool, ExecutionEngineError> {
        let guard = self
            .states
            .read()
            .map_err(|_| ExecutionEngineError::InternalError("state lock poisoned".to_string()))?;
        let state = *guard
            .get(order_id)
            .ok_or(ExecutionEngineError::InvalidOrder)?;
        Ok(is_terminal(state))
    }

    pub fn require_exists(&self, order_id: &OrderId) -> Result<(), ExecutionEngineError> {
        let guard = self
            .states
            .read()
            .map_err(|_| ExecutionEngineError::InternalError("state lock poisoned".to_string()))?;
        if guard.contains_key(order_id) {
            Ok(())
        } else {
            Err(ExecutionEngineError::InvalidOrder)
        }
    }

    /// NON-authoritative pre-flight optimization.
    /// This function MUST NOT be relied upon for lifecycle safety.
    /// Authoritative duplicate prevention occurs exclusively under write lock in submit_execution().
    pub fn ensure_not_exists(&self, order_id: &OrderId) -> Result<(), ExecutionEngineError> {
        let guard = self
            .states
            .read()
            .map_err(|_| ExecutionEngineError::InternalError("state lock poisoned".to_string()))?;
        if guard.contains_key(order_id) {
            Err(ExecutionEngineError::InvalidOrder)
        } else {
            Ok(())
        }
    }

    fn mutate(&self, order_id: &OrderId, to: ExecutionState) -> Result<(), ExecutionEngineError> {
        let mut guard = self
            .states
            .write()
            .map_err(|_| ExecutionEngineError::InternalError("state lock poisoned".to_string()))?;
        Self::transition_under_lock(&mut guard, order_id, to)
    }

    fn transition_under_lock(
        states: &mut HashMap<OrderId, ExecutionState>,
        order_id: &OrderId,
        to: ExecutionState,
    ) -> Result<(), ExecutionEngineError> {
        let from = *states
            .get(order_id)
            .ok_or(ExecutionEngineError::InvalidOrder)?;
        validate_transition(from, to)?;
        states.insert(order_id.clone(), to);
        Ok(())
    }
}

pub fn validate_transition(
    from: ExecutionState,
    to: ExecutionState,
) -> Result<(), ExecutionEngineError> {
    if is_terminal(from) {
        return Err(ExecutionEngineError::InvalidStateTransition);
    }

    let allowed = matches!(
        (from, to),
        (ExecutionState::Pending, ExecutionState::Validated)
            | (ExecutionState::Validated, ExecutionState::Submitted)
            | (ExecutionState::Submitted, ExecutionState::Acknowledged)
            | (ExecutionState::Submitted, ExecutionState::Rejected)
            | (ExecutionState::Submitted, ExecutionState::Failed)
            | (
                ExecutionState::Acknowledged,
                ExecutionState::PartiallyFilled
            )
            | (ExecutionState::Acknowledged, ExecutionState::Filled)
            | (
                ExecutionState::Acknowledged,
                ExecutionState::CancelRequested
            )
            | (ExecutionState::Acknowledged, ExecutionState::Rejected)
            | (ExecutionState::Acknowledged, ExecutionState::Failed)
            | (
                ExecutionState::PartiallyFilled,
                ExecutionState::PartiallyFilled
            )
            | (ExecutionState::PartiallyFilled, ExecutionState::Filled)
            | (
                ExecutionState::PartiallyFilled,
                ExecutionState::CancelRequested
            )
            | (ExecutionState::PartiallyFilled, ExecutionState::Failed)
            | (ExecutionState::CancelRequested, ExecutionState::Cancelled)
            | (ExecutionState::CancelRequested, ExecutionState::Failed)
            | (ExecutionState::Pending, ExecutionState::Failed)
            | (ExecutionState::Validated, ExecutionState::Failed)
    );

    if allowed {
        Ok(())
    } else {
        Err(ExecutionEngineError::InvalidStateTransition)
    }
}

fn is_terminal(state: ExecutionState) -> bool {
    matches!(
        state,
        ExecutionState::Filled
            | ExecutionState::Cancelled
            | ExecutionState::Rejected
            | ExecutionState::Expired
            | ExecutionState::Failed
    )
}
