use crate::models::LifecycleState;

pub fn compute_lifecycle_state(
    previous_state: Option<LifecycleState>,
    active: bool,
    closed: bool,
    resolved: bool,
    archived: bool,
    end_time_ts_ms: i64,
    now_ts_ms: i64,
    closing_buffer_seconds: i64,
    has_valid_token_mapping: bool,
) -> LifecycleState {
    let candidate = if archived {
        LifecycleState::DELISTED
    } else if resolved {
        LifecycleState::RESOLVED
    } else if closed || (end_time_ts_ms > 0 && now_ts_ms >= end_time_ts_ms) {
        LifecycleState::CLOSED
    } else if active {
        if has_valid_token_mapping {
            let remaining_ms = end_time_ts_ms.saturating_sub(now_ts_ms);
            let closing_buffer_ms = closing_buffer_seconds.saturating_mul(1000);
            if end_time_ts_ms > 0 && remaining_ms <= closing_buffer_ms {
                LifecycleState::CLOSING_SOON
            } else {
                LifecycleState::TRADING
            }
        } else {
            LifecycleState::ELIGIBLE
        }
    } else {
        LifecycleState::DISCOVERED
    };

    enforce_monotonic_transition(previous_state, candidate)
}

pub fn enforce_monotonic_transition(
    previous_state: Option<LifecycleState>,
    candidate_state: LifecycleState,
) -> LifecycleState {
    match previous_state {
        Some(previous) if previous.rank() > candidate_state.rank() => previous,
        _ => candidate_state,
    }
}
