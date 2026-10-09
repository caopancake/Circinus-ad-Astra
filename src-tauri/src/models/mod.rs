pub mod app_log;
pub mod app_settings;
pub mod command_payloads;
pub mod directory_opening;
pub mod entity_target;
pub mod mod_creation;
pub mod project;
pub mod text;
pub mod window;
pub mod workspace_persistence;
pub mod write;

use serde::{Deserialize, Deserializer};

pub use app_log::*;
pub use app_settings::*;
pub use directory_opening::*;
pub use entity_target::*;
pub use mod_creation::*;
pub use project::*;
pub(crate) use text::*;
pub use window::*;
pub use workspace_persistence::*;
pub use write::*;

pub fn required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

pub fn required_nullable_non_empty_string<'de, D>(
    deserializer: D,
) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer).map(normalize_optional_non_empty_string)
}

pub fn optional_non_empty_string<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer).map(normalize_optional_non_empty_string)
}

fn normalize_optional_non_empty_string(value: Option<String>) -> Option<String> {
    value.and_then(|text| {
        let trimmed = text.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}
