//! Starsector well-known tag/hint display metadata for source option labels.
//!
//! The data lives in `schemas/well-known-labels.json` and is embedded at
//! compile time; this module is the only consumer and validates the asset
//! version header while loading.

use serde::Deserialize;
use std::{collections::BTreeMap, sync::LazyLock};

pub const WELL_KNOWN_LABELS_SCHEMA_VERSION: &str = "circinus-ad-astra/well-known-labels/v1";

#[derive(Deserialize)]
struct WellKnownLabelAsset {
    #[serde(rename = "$schema")]
    schema: String,
    tags: BTreeMap<String, WellKnownLabelEntry>,
    hints: BTreeMap<String, WellKnownLabelEntry>,
}

#[derive(Clone, Deserialize)]
pub struct WellKnownLabelEntry {
    pub label: String,
    pub description: String,
}

static WELL_KNOWN_LABELS: LazyLock<WellKnownLabelAsset> = LazyLock::new(|| {
    let raw = include_str!("../../../schemas/well-known-labels.json");
    let asset: WellKnownLabelAsset =
        serde_json::from_str(raw).expect("embedded well-known-labels asset must parse");
    assert_eq!(
        asset.schema, WELL_KNOWN_LABELS_SCHEMA_VERSION,
        "embedded well-known-labels asset schema version mismatch"
    );
    asset
});

/// Well-known `tags` column values with their display metadata.
pub fn well_known_tag_labels() -> &'static BTreeMap<String, WellKnownLabelEntry> {
    &WELL_KNOWN_LABELS.tags
}

/// Well-known `hints` column values with their display metadata.
pub fn well_known_hint_labels() -> &'static BTreeMap<String, WellKnownLabelEntry> {
    &WELL_KNOWN_LABELS.hints
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_asset_matches_contract() {
        assert_eq!(WELL_KNOWN_LABELS.schema, WELL_KNOWN_LABELS_SCHEMA_VERSION);
        assert_eq!(well_known_tag_labels().len(), 168);
        assert_eq!(well_known_hint_labels().len(), 48);
    }

    #[test]
    fn well_known_entries_keep_label_and_description() {
        let base_bp = well_known_tag_labels().get("base_bp").expect("base_bp");
        assert_eq!(base_bp.label, "基础蓝图");
        assert!(!base_bp.description.is_empty());
        let pd = well_known_hint_labels().get("PD").expect("PD");
        assert_eq!(pd.label, "点防御");
        assert!(!pd.description.is_empty());
    }
}
