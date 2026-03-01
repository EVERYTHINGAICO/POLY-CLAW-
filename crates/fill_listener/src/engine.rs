use std::sync::Arc;

use crate::errors::FillListenerError;
use crate::traits::FillEventSource;
use crate::types::FillEvent;

#[derive(Clone)]
pub struct FillListener {
    source: Arc<dyn FillEventSource>,
}

impl std::fmt::Debug for FillListener {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FillListener").finish()
    }
}

impl FillListener {
    pub fn new(source: Arc<dyn FillEventSource>) -> Self {
        Self { source }
    }

    pub fn poll(&self) -> Result<Vec<FillEvent>, FillListenerError> {
        self.source.poll_fills()
    }
}
