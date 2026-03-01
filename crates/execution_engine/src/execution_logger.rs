pub struct ExecutionLogger;

impl ExecutionLogger {
    pub fn log_fill_received(fill_id: &str) {
        println!("[EXECUTION_LOG] fill_received fill_id={fill_id}");
    }

    pub fn log_fill_reconciled(fill_id: &str) {
        println!("[EXECUTION_LOG] fill_reconciled fill_id={fill_id}");
    }

    pub fn log_execution_submitted(order_id: &str) {
        println!("[EXECUTION_LOG] execution_submitted order_id={order_id}");
    }

    pub fn log_execution_rejected(order_id: &str, reason: &str) {
        println!("[EXECUTION_LOG] execution_rejected order_id={order_id} reason={reason}");
    }
}
