#[allow(non_camel_case_types)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IntentType {
    PLACE_LIMIT,
    PLACE_MARKET,
    CANCEL,
    REPLACE,
    EMERGENCY_FLATTEN,
}

#[allow(non_camel_case_types)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IntentState {
    QUEUED,
    IN_FLIGHT,
    DONE,
    FAILED,
    DLQ,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExecutionIntent {
    pub intent_id: String,
    pub ts_ms: u64,
    pub market_id: String,
    pub intent_type: IntentType,
    pub payload_json: String,
    pub state: IntentState,
    pub idempotency_key: String,
    pub last_error: Option<String>,
}
