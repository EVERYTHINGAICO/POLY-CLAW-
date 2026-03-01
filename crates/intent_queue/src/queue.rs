use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Mutex;

use crate::errors::IntentQueueError;
use crate::types::ExecutionIntent;

pub struct IntentQueue {
    inner: Mutex<QueueInner>,
}

impl Default for IntentQueue {
    fn default() -> Self {
        Self::new(1024)
    }
}

impl IntentQueue {
    pub fn new(max_depth: usize) -> Self {
        Self {
            inner: Mutex::new(QueueInner::new(max_depth)),
        }
    }

    pub fn push(&self, intent: ExecutionIntent) -> Result<(), IntentQueueError> {
        if intent.intent_id.is_empty()
            || intent.market_id.is_empty()
            || intent.idempotency_key.is_empty()
            || intent.payload_json.is_empty()
            || intent.ts_ms == 0
        {
            return Err(IntentQueueError::InvalidIntent);
        }

        let mut guard = self
            .inner
            .lock()
            .map_err(|_| IntentQueueError::QueuePoisoned)?;

        if guard.total_len >= guard.max_depth {
            return Err(IntentQueueError::QueueFull);
        }

        if !guard
            .queued_idempotency_keys
            .insert(intent.idempotency_key.clone())
        {
            return Err(IntentQueueError::DuplicateIdempotencyKey);
        }

        let market_id = intent.market_id.clone();
        guard
            .per_market
            .entry(market_id.clone())
            .or_default()
            .push_back(intent);
        guard.total_len += 1;

        if guard.markets_in_rotation.insert(market_id.clone()) {
            guard.market_rotation.push_back(market_id);
        }

        Ok(())
    }

    pub fn pop(&self) -> Result<Option<ExecutionIntent>, IntentQueueError> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| IntentQueueError::QueuePoisoned)?;

        while let Some(market_id) = guard.market_rotation.pop_front() {
            let maybe_intent = {
                let queue = guard.per_market.get_mut(&market_id);
                queue.and_then(|q| q.pop_front())
            };

            let Some(intent) = maybe_intent else {
                guard.markets_in_rotation.remove(&market_id);
                guard.per_market.remove(&market_id);
                continue;
            };

            guard.total_len = guard.total_len.saturating_sub(1);
            guard
                .queued_idempotency_keys
                .remove(intent.idempotency_key.as_str());

            let has_more_for_market = guard
                .per_market
                .get(&market_id)
                .map(|q| !q.is_empty())
                .unwrap_or(false);

            if has_more_for_market {
                guard.market_rotation.push_back(market_id);
            } else {
                guard.markets_in_rotation.remove(&market_id);
                guard.per_market.remove(&market_id);
            }

            return Ok(Some(intent));
        }

        Ok(None)
    }

    pub fn len(&self) -> usize {
        match self.inner.lock() {
            Ok(guard) => guard.total_len,
            Err(poisoned) => poisoned.into_inner().total_len,
        }
    }
}

struct QueueInner {
    max_depth: usize,
    total_len: usize,
    per_market: HashMap<String, VecDeque<ExecutionIntent>>,
    market_rotation: VecDeque<String>,
    markets_in_rotation: HashSet<String>,
    queued_idempotency_keys: HashSet<String>,
}

impl QueueInner {
    fn new(max_depth: usize) -> Self {
        Self {
            max_depth,
            total_len: 0,
            per_market: HashMap::new(),
            market_rotation: VecDeque::new(),
            markets_in_rotation: HashSet::new(),
            queued_idempotency_keys: HashSet::new(),
        }
    }
}
