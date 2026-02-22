use serde::{Deserialize, Serialize};

#[non_exhaustive]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SystemConfig {
    pub environment: String,
}
