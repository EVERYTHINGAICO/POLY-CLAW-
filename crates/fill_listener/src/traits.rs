use crate::errors::FillListenerError;
use crate::types::FillEvent;

pub trait FillEventSource: Send + Sync {
    fn poll_fills(&self) -> Result<Vec<FillEvent>, FillListenerError>;
}
