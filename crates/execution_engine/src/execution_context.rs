use serde::{Deserialize, Serialize};

use crate::types::{ClientOrderId, OrderId, OrderSide, Price, Quantity};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ExecutionContext {
    pub order_id: OrderId,
    pub market_id: String,
    pub side: OrderSide,
    pub quantity: Quantity,
    pub price: Price,
    pub client_order_id: Option<ClientOrderId>,
    pub created_at_ms: i64,
}
