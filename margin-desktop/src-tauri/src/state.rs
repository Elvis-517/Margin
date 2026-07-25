use crate::db::Database;

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            db: Database::new(),
        }
    }
}
