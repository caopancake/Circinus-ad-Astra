use crate::{
    domain::config::{path_affects_target, path_is_or_in_dir},
    errors::{AppError, AppResult},
    models::{CsvTableKey, EditorSpecKind, EntityKind},
};

#[derive(Clone, Copy)]
pub struct EntitySpecDefinition {
    pub entity_kind: EntityKind,
    pub editor_kind: Option<EditorSpecKind>,
    pub csv_table: Option<CsvTableKey>,
    pub dir: &'static str,
    pub extension: &'static str,
    pub id_field: &'static str,
    pub display_name: &'static str,
    pub invalid_id_message: &'static str,
}

impl EntitySpecDefinition {
    pub fn path_matches(self, path: &str) -> bool {
        path_affects_target(path, self.dir)
            || (path_is_or_in_dir(path, self.dir) && path.ends_with(self.extension))
    }

    pub fn extension_without_dot(self) -> &'static str {
        self.extension.strip_prefix('.').unwrap_or(self.extension)
    }

    pub fn default_rel_path(self, id: &str) -> String {
        format!("{}/{}.{}", self.dir, id, self.extension_without_dot())
    }

    pub fn validate_rel_path(self, rel_path: &str, message: &str) -> AppResult<()> {
        crate::domain::config::validate_config_file_rel_path(
            rel_path,
            self.dir,
            self.extension_without_dot(),
            message,
        )
    }
}

pub const SHIP_SPEC_DEFINITION: EntitySpecDefinition = EntitySpecDefinition {
    entity_kind: EntityKind::Ship,
    editor_kind: Some(EditorSpecKind::Ship),
    csv_table: Some(CsvTableKey::Ships),
    dir: "data/hulls",
    extension: ".ship",
    id_field: "hullId",
    display_name: "舰船",
    invalid_id_message: "无效舰船 ID",
};

pub const WEAPON_SPEC_DEFINITION: EntitySpecDefinition = EntitySpecDefinition {
    entity_kind: EntityKind::Weapon,
    editor_kind: Some(EditorSpecKind::Weapon),
    csv_table: Some(CsvTableKey::Weapons),
    dir: "data/weapons",
    extension: ".wpn",
    id_field: "id",
    display_name: "武器",
    invalid_id_message: "无效武器 ID",
};

pub const PROJECTILE_SPEC_DEFINITION: EntitySpecDefinition = EntitySpecDefinition {
    entity_kind: EntityKind::Projectile,
    editor_kind: Some(EditorSpecKind::Projectile),
    csv_table: None,
    dir: "data/weapons/proj",
    extension: ".proj",
    id_field: "id",
    display_name: "弹体",
    invalid_id_message: "无效弹体 ID",
};

pub const SYSTEM_SPEC_DEFINITION: EntitySpecDefinition = EntitySpecDefinition {
    entity_kind: EntityKind::System,
    editor_kind: Some(EditorSpecKind::System),
    csv_table: Some(CsvTableKey::ShipSystems),
    dir: "data/shipsystems",
    extension: ".system",
    id_field: "id",
    display_name: "战术系统",
    invalid_id_message: "无效战术系统 ID",
};

pub const SKILL_SPEC_DEFINITION: EntitySpecDefinition = EntitySpecDefinition {
    entity_kind: EntityKind::Skill,
    editor_kind: None,
    csv_table: Some(CsvTableKey::Skills),
    dir: "data/characters/skills",
    extension: ".skill",
    id_field: "id",
    display_name: "技能",
    invalid_id_message: "无效技能 ID",
};

pub const FACTION_SPEC_DEFINITION: EntitySpecDefinition = EntitySpecDefinition {
    entity_kind: EntityKind::Faction,
    editor_kind: None,
    csv_table: None,
    dir: "data/world/factions",
    extension: ".faction",
    id_field: "id",
    display_name: "势力",
    invalid_id_message: "无效势力 ID",
};

pub const VARIANT_SPEC_DEFINITION: EntitySpecDefinition = EntitySpecDefinition {
    entity_kind: EntityKind::Variant,
    editor_kind: None,
    csv_table: None,
    dir: "data/variants",
    extension: ".variant",
    id_field: "variantId",
    display_name: "装配",
    invalid_id_message: "无效装配 ID",
};

pub const SKIN_SPEC_DEFINITION: EntitySpecDefinition = EntitySpecDefinition {
    entity_kind: EntityKind::Skin,
    editor_kind: None,
    csv_table: None,
    dir: "data/hulls/skins",
    extension: ".skin",
    id_field: "skinHullId",
    display_name: "舰船皮肤",
    invalid_id_message: "无效舰船皮肤 ID",
};

pub const ENTITY_SPEC_DEFINITIONS: [EntitySpecDefinition; 8] = [
    SHIP_SPEC_DEFINITION,
    WEAPON_SPEC_DEFINITION,
    PROJECTILE_SPEC_DEFINITION,
    SYSTEM_SPEC_DEFINITION,
    SKILL_SPEC_DEFINITION,
    FACTION_SPEC_DEFINITION,
    VARIANT_SPEC_DEFINITION,
    SKIN_SPEC_DEFINITION,
];

pub fn entity_spec_definition(kind: EntityKind) -> Option<&'static EntitySpecDefinition> {
    ENTITY_SPEC_DEFINITIONS
        .iter()
        .find(|definition| definition.entity_kind == kind)
}

pub fn editor_spec_definition(kind: EditorSpecKind) -> AppResult<&'static EntitySpecDefinition> {
    ENTITY_SPEC_DEFINITIONS
        .iter()
        .find(|definition| definition.editor_kind == Some(kind))
        .ok_or_else(|| {
            AppError::message(
                "spec.kind_unknown",
                format!("未注册的编辑器 spec 种类: {kind:?}"),
            )
        })
}

pub fn associated_spec_definition(table: CsvTableKey) -> Option<&'static EntitySpecDefinition> {
    ENTITY_SPEC_DEFINITIONS
        .iter()
        .find(|definition| definition.csv_table == Some(table))
}

pub fn associated_spec_tables() -> Vec<CsvTableKey> {
    ENTITY_SPEC_DEFINITIONS
        .iter()
        .filter_map(|definition| definition.csv_table)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_matches_accepts_files_inside_the_directory_with_the_extension() {
        assert!(SHIP_SPEC_DEFINITION.path_matches("data/hulls/xy.ship"));
        assert!(!SHIP_SPEC_DEFINITION.path_matches("data/weapons/xy.wpn"));
        assert!(!SHIP_SPEC_DEFINITION.path_matches("data/hulls/xy.wpn"));
    }

    #[test]
    fn path_matches_accepts_the_declared_directory_itself() {
        assert!(SHIP_SPEC_DEFINITION.path_matches("data/hulls"));
    }

    #[test]
    fn default_rel_path_follows_dir_id_and_extension() {
        assert_eq!(
            SHIP_SPEC_DEFINITION.default_rel_path("XY"),
            "data/hulls/XY.ship"
        );
        assert_eq!(
            SKIN_SPEC_DEFINITION.default_rel_path("sk"),
            "data/hulls/skins/sk.skin"
        );
    }

    #[test]
    fn extension_without_dot_strips_the_leading_dot() {
        assert_eq!(WEAPON_SPEC_DEFINITION.extension_without_dot(), "wpn");
    }

    #[test]
    fn validate_rel_path_rejects_paths_outside_the_declared_dir() {
        assert!(
            SHIP_SPEC_DEFINITION
                .validate_rel_path("data/hulls/a.ship", "msg")
                .is_ok()
        );
        let error = SHIP_SPEC_DEFINITION
            .validate_rel_path("data/other/a.ship", "越界")
            .expect_err("rejected");
        assert!(error.to_string().starts_with("越界"));
    }

    #[test]
    fn entity_spec_lookup_covers_every_registered_kind() {
        for definition in ENTITY_SPEC_DEFINITIONS.iter() {
            assert_eq!(
                entity_spec_definition(definition.entity_kind)
                    .expect("registered")
                    .entity_kind,
                definition.entity_kind
            );
        }
        for spec_kind in [
            EditorSpecKind::Ship,
            EditorSpecKind::Weapon,
            EditorSpecKind::Projectile,
            EditorSpecKind::System,
        ] {
            assert!(editor_spec_definition(spec_kind).is_ok());
        }
        assert!(editor_spec_definition(EditorSpecKind::Ship).is_ok());
    }

    #[test]
    fn associated_spec_lookup_maps_tables_to_definitions() {
        assert_eq!(
            associated_spec_definition(CsvTableKey::Ships).map(|definition| definition.id_field),
            Some("hullId")
        );
        assert!(associated_spec_definition(CsvTableKey::Wings).is_none());
        assert_eq!(
            associated_spec_tables(),
            vec![
                CsvTableKey::Ships,
                CsvTableKey::Weapons,
                CsvTableKey::ShipSystems,
                CsvTableKey::Skills,
            ]
        );
    }
}
