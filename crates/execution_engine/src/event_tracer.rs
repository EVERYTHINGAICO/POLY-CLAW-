pub struct EventTracer;

impl EventTracer {
    pub fn trace_fill_ingested(fill_id: &str) {
        println!("[EVENT_TRACE] fill_ingested fill_id={fill_id}");
    }

    pub fn trace_cursor_advanced(cursor_value: u64) {
        println!("[EVENT_TRACE] cursor_advanced cursor_value={cursor_value}");
    }

    pub fn trace_storage_commit(success: bool) {
        println!("[EVENT_TRACE] storage_commit success={success}");
    }
}
