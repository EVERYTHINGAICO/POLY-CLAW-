use std::sync::Arc;

use crate::errors::ConfigurationError;
use crate::types::RootConfig;

pub trait ConfigurationProvider: Send + Sync {
    fn get_config(&self) -> &RootConfig;
}

#[derive(Clone, Debug)]
pub struct StaticConfigProvider {
    config: Arc<RootConfig>,
}

impl StaticConfigProvider {
    pub fn new(config: RootConfig) -> Self {
        Self {
            config: Arc::new(config),
        }
    }

    pub fn load() -> Result<Self, ConfigurationError> {
        let config = crate::loader::load_config()?;
        Ok(Self::new(config))
    }
}

impl ConfigurationProvider for StaticConfigProvider {
    fn get_config(&self) -> &RootConfig {
        &self.config
    }
}
