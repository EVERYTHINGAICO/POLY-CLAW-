#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ReconcileOutcome {
    pub fills_processed: u64,
    pub fills_inserted: u64,
    pub duplicates_ignored: u64,
    pub cursor_advanced_count: u64,
}

impl ReconcileOutcome {
    pub fn merge(&mut self, other: &ReconcileOutcome) {
        self.fills_processed += other.fills_processed;
        self.fills_inserted += other.fills_inserted;
        self.duplicates_ignored += other.duplicates_ignored;
        self.cursor_advanced_count += other.cursor_advanced_count;
    }
}
