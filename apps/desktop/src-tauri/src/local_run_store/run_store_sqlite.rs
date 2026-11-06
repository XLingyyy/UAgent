// RunStore-only SQLite extensions. Other databases include sqlite.rs directly.
include!("sqlite.rs");
#[path = "sqlite_history_search.rs"] mod history_search;
#[path = "sqlite_runtime_host_scan.rs"] mod runtime_host_scan;
#[path = "sqlite_session_catalog.rs"] mod session_catalog_budget;
#[path = "sqlite_project_memory_budget.rs"] mod project_memory_budget;
