mod csv_patch;
mod entity_identity;
mod faction_identity;
pub use entity_identity::save_entity_spec;
pub use entity_identity::save_entity_text;
pub use faction_identity::{delete_faction_entity, save_faction_entity};

#[cfg(test)]
pub use csv_patch::save_csv_patch;
pub use csv_patch::save_csv_patch_snapshot;
