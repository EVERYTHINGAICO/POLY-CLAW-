use serde::{Deserialize, Serialize};

use crate::errors::ExecutionEngineError;

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct OrderId(String);

impl OrderId {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ExecutionId(String);

impl ExecutionId {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ClientOrderId(String);

impl ClientOrderId {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExecutionState {
    Pending,
    Validated,
    Submitted,
    Acknowledged,
    PartiallyFilled,
    Filled,
    CancelRequested,
    Cancelled,
    Rejected,
    Expired,
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum OrderSide {
    BuyYes,
    BuyNo,
}

impl OrderSide {
    pub fn risk_outcome_id(self) -> &'static str {
        match self {
            Self::BuyYes => "yes",
            Self::BuyNo => "no",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Quantity(f64);

impl Quantity {
    pub fn new(value: f64) -> Result<Self, ExecutionEngineError> {
        if value > 0.0 {
            Ok(Self(value))
        } else {
            Err(ExecutionEngineError::InvalidQuantity)
        }
    }

    pub fn as_f64(&self) -> f64 {
        self.0
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Price(f64);

impl Price {
    pub fn new(value: f64) -> Result<Self, ExecutionEngineError> {
        if (0.0..=1.0).contains(&value) {
            Ok(Self(value))
        } else {
            Err(ExecutionEngineError::InvalidPrice)
        }
    }

    pub fn as_f64(&self) -> f64 {
        self.0
    }
}
