use fill_listener::types::FillEvent;

pub fn log_fill_received(fill: &FillEvent) {
    println!(
        "[RECON] received fill_id={} order_id={} market_id={}",
        fill.fill_id, fill.order_id, fill.market_id
    );
}

pub fn log_fill_persisted(fill_id: &str) {
    println!("[RECON] persisted fill_id={fill_id}");
}

pub fn log_duplicate_ignored(fill_id: &str) {
    println!("[RECON] duplicate ignored fill_id={fill_id}");
}

pub fn log_storage_failure(fill_id: &str) {
    eprintln!("[RECON][ERROR] storage failure fill_id={fill_id}");
}
