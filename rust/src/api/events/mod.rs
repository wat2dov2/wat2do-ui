//! Events: the browse feed, event detail and writes, Going selections, saved
//! events, the calendar feed, interactions and reports
//! (`services/event_query.py`, `event_service.py`, `event_date_service.py`,
//! `going_event_service.py`, `interaction_service.py`, `calendar_service.py`,
//! `report_service.py`), shared by the route modules in `api/routes`.

pub mod body;
pub mod feed;
pub mod going;
pub mod ics;
pub mod interactions;
pub mod model;
pub mod reports;
pub mod store;
pub mod writes;
