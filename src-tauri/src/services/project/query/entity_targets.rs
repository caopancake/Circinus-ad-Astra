use super::super::{
    cache::{
        ensure_registered_table_rows, ensure_session_table_rows, lock_ready_session, session_handle,
    },
    definitions::entity_definitions::entity_definition,
    model::{MISSION_LIST_TABLE_KEY, ProjectSession, string_from_row},
    versions::version_for_path,
};
use crate::{
    errors::AppResult,
    models::{
        EntityEditInfo, EntityEditTarget, EntityFileLocation, EntityKind, EntityLinkedRecord,
        EntityTargetState, ResourceSource,
    },
};
use std::path::Path;

pub fn query_entity_edit_target(
    session_id: &str,
    kind: EntityKind,
    id: &str,
) -> AppResult<EntityEditInfo> {
    let handle = session_handle(session_id)?;
    let mut session = lock_ready_session(&handle)?;
    (entity_definition(kind)?.prepare)(&mut session)?;
    describe_entity_target(&mut session, kind, id)
}

pub fn require_entity_version_scope(
    session_id: &str,
    kind: EntityKind,
    id: &str,
    supplied: &[crate::models::FileVersion],
) -> AppResult<()> {
    let info = query_entity_edit_target(session_id, kind, id)?;
    for required in info.base_versions {
        if !supplied.iter().any(|version| {
            crate::models::windows_path_key(&version.path)
                == crate::models::windows_path_key(&required.path)
        }) {
            return Err(crate::errors::AppError::message(
                "write.version_scope_missing",
                format!("保存缺少读取版本凭据: {}", required.path),
            ));
        }
    }
    Ok(())
}

pub fn require_csv_version_scope(
    session_id: &str,
    table: crate::models::CsvTableKey,
    supplied: &[crate::models::FileVersion],
) -> AppResult<()> {
    let handle = session_handle(session_id)?;
    let session = lock_ready_session(&handle)?;
    let state = super::super::cache::registered_session_table(&session, table)?;
    let required = version_for_path(&session, &state.path);
    if !supplied.iter().any(|version| {
        crate::models::windows_path_key(&version.path)
            == crate::models::windows_path_key(&required.path)
    }) {
        return Err(crate::errors::AppError::message(
            "write.version_scope_missing",
            format!("CSV 保存缺少读取版本凭据: {}", required.path),
        ));
    }
    Ok(())
}

pub fn query_file_entity_target(session_id: &str, path: &str) -> AppResult<Option<EntityEditInfo>> {
    let handle = session_handle(session_id)?;
    let mut session = lock_ready_session(&handle)?;
    let key = crate::models::windows_path_key(path);
    let mut found = None;
    for (kind, records) in [
        (EntityKind::Ship, &session.ship_files),
        (EntityKind::Weapon, &session.weapon_specs),
        (EntityKind::Projectile, &session.projectile_specs),
        (EntityKind::System, &session.system_files),
        (EntityKind::Skill, &session.skill_files),
        (EntityKind::Faction, &session.faction_files),
    ] {
        if let Some(record) = records.values().find(|record| {
            record.location.source == ResourceSource::Mod
                && crate::models::windows_path_key(&record.location.path) == key
        }) {
            found = Some((kind, record.id.clone()));
            break;
        }
    }
    if found.is_none() {
        found = session
            .variant_files
            .iter()
            .find(|file| crate::models::windows_path_key(&file.path) == key)
            .map(|file| (EntityKind::Variant, file.variant_id.clone()))
            .or_else(|| {
                session
                    .skin_files
                    .iter()
                    .find(|file| crate::models::windows_path_key(&file.path) == key)
                    .map(|file| (EntityKind::Skin, file.skin_hull_id.clone()))
            });
    }
    found
        .map(|(kind, id)| describe_entity_target(&mut session, kind, &id))
        .transpose()
}

pub fn query_entity_identity_intent(
    session_id: &str,
    source: &EntityEditTarget,
    next_id: &str,
) -> AppResult<crate::models::EntityIdentityIntent> {
    let handle = session_handle(session_id)?;
    let mut session = lock_ready_session(&handle)?;
    (entity_definition(source.kind)?.prepare)(&mut session)?;
    let current = describe_entity_target(&mut session, source.kind, &source.id)?;
    if current.target != *source {
        return Err(crate::errors::AppError::message(
            "spec.target_changed",
            "实体目标已变化，请载入外部版本",
        ));
    }
    let definition = crate::domain::editor_config_definitions::entity_spec_definition(source.kind);
    let next_id = crate::domain::config::validate_config_id(
        next_id,
        definition
            .map(|definition| definition.invalid_id_message)
            .unwrap_or("无效战役 ID"),
    )?;
    let relative = if source.kind == EntityKind::Mission {
        format!("data/missions/{next_id}")
    } else if source.state == EntityTargetState::Create {
        definition
            .expect("spec kind has definition")
            .default_rel_path(next_id)
    } else if next_id == source.id {
        source.write.rel_path.clone()
    } else {
        crate::io::forward_slash_path(&Path::new(&source.write.rel_path).with_file_name(format!(
            "{next_id}{}",
            definition.expect("spec kind has definition").extension
        )))
    };
    let boundary = crate::io::FsRootBoundary::new(
        Path::new(&session.manifest.mod_root),
        "entity intent root",
    )?;
    let destination = boundary.resolve_relative(&relative, "entity intent target")?;
    let same_file = crate::io::same_physical_path(Path::new(&source.write.path), &destination);
    let next_target = describe_entity_target(&mut session, source.kind, next_id)?.target;
    if (destination.exists() && (source.state == EntityTargetState::Create || !same_file))
        || (next_id != source.id && next_target.state == EntityTargetState::Existing)
    {
        return Err(crate::errors::AppError::EntityTargetExists {
            target: Box::new(next_target),
        });
    }
    let mut next_write = source.write.clone();
    next_write.rel_path = relative;
    next_write.path = destination.to_string_lossy().to_string();
    Ok(crate::models::EntityIdentityIntent {
        source: source.clone(),
        next_id: next_id.to_string(),
        destination_version: crate::io::file_version(&destination)?,
        next_write,
    })
}

pub(in crate::services::project) struct EntityTargetProjection {
    kind: EntityKind,
    sources: std::collections::BTreeMap<String, EntityFileLocation>,
    linked: std::collections::BTreeMap<String, EntityLinkedRecord>,
    index_version: Option<crate::models::FileVersion>,
}

pub(in crate::services::project) fn prepare_entity_targets(
    session: &mut ProjectSession,
    kind: EntityKind,
) -> AppResult<EntityTargetProjection> {
    let root = &session.manifest.mod_root;
    let mut sources = std::collections::BTreeMap::new();
    match kind {
        EntityKind::Variant => {
            for record in &session.variant_files {
                sources
                    .entry(record.variant_id.clone())
                    .or_insert_with(|| location(root, &record.rel_path));
            }
        }
        EntityKind::Skin => {
            for record in &session.skin_files {
                sources
                    .entry(record.skin_hull_id.clone())
                    .or_insert_with(|| location(root, &record.rel_path));
            }
        }
        EntityKind::Mission => {}
        _ => {
            let records = match kind {
                EntityKind::Ship => &session.ship_files,
                EntityKind::Weapon => &session.weapon_specs,
                EntityKind::Projectile => &session.projectile_specs,
                EntityKind::System => &session.system_files,
                EntityKind::Skill => &session.skill_files,
                EntityKind::Faction => &session.faction_files,
                _ => unreachable!("file-backed entity kind"),
            };
            sources.extend(
                records
                    .iter()
                    .map(|(id, record)| (id.clone(), record.location.clone())),
            );
        }
    }
    let definition = crate::domain::editor_config_definitions::entity_spec_definition(kind);
    let mut linked = std::collections::BTreeMap::new();
    let index_version = if let Some(table) = definition.and_then(|definition| definition.csv_table)
    {
        ensure_registered_table_rows(session, table)?;
        let state = session
            .csv_tables
            .get(table.as_str())
            .expect("registered table");
        for row in state.rows.as_ref().expect("associated rows are loaded") {
            if row.is_comment {
                continue;
            }
            if let Some(id) = string_from_row(&row.data, "id") {
                linked.entry(id).or_insert_with(|| EntityLinkedRecord::Csv {
                    table,
                    row_key: row.row_key.clone(),
                });
            }
        }
        Some(version_for_path(session, &state.path))
    } else if kind == EntityKind::Faction {
        let index = "data/world/factions/factions.csv";
        let entries = crate::io::read_faction_index(Path::new(&session.manifest.mod_root))?;
        let mut paths = std::collections::BTreeMap::new();
        for entry in entries {
            paths
                .entry(entry.path.to_string_lossy().to_string())
                .or_insert(entry.row_index);
        }
        for (id, source) in &sources {
            if let Some(row_index) = paths.get(&source.path) {
                linked.insert(
                    id.clone(),
                    EntityLinkedRecord::Index {
                        path: index.to_string(),
                        row_index: *row_index,
                    },
                );
            }
        }
        Some(version_for_path(session, index))
    } else if kind == EntityKind::Mission {
        ensure_session_table_rows(session, MISSION_LIST_TABLE_KEY)?;
        let index = "data/missions/mission_list.csv";
        for (row_index, row) in session.csv_tables[MISSION_LIST_TABLE_KEY]
            .rows
            .as_ref()
            .expect("mission rows are loaded")
            .iter()
            .enumerate()
        {
            if row.is_comment {
                continue;
            }
            if let Some(id) = string_from_row(&row.data, "mission") {
                linked
                    .entry(id)
                    .or_insert_with(|| EntityLinkedRecord::Index {
                        path: index.to_string(),
                        row_index,
                    });
            }
        }
        Some(version_for_path(session, index))
    } else {
        None
    };
    Ok(EntityTargetProjection {
        kind,
        sources,
        linked,
        index_version,
    })
}

impl EntityTargetProjection {
    pub(in crate::services::project) fn describe(
        &self,
        session: &ProjectSession,
        id: &str,
    ) -> EntityEditInfo {
        let root = &session.manifest.mod_root;
        let definition =
            crate::domain::editor_config_definitions::entity_spec_definition(self.kind);
        let source = if self.kind == EntityKind::Mission {
            let relative = format!("data/missions/{id}");
            Path::new(root)
                .join(&relative)
                .is_dir()
                .then(|| location(root, &relative))
        } else {
            self.sources.get(id).cloned()
        };
        let write = source
            .as_ref()
            .filter(|source| source.source == ResourceSource::Mod)
            .cloned()
            .unwrap_or_else(|| {
                location(
                    root,
                    &definition
                        .map(|definition| definition.default_rel_path(id))
                        .unwrap_or_else(|| format!("data/missions/{id}")),
                )
            });
        let state = if source
            .as_ref()
            .is_some_and(|source| source.source == ResourceSource::Mod)
        {
            EntityTargetState::Existing
        } else {
            EntityTargetState::Create
        };
        let mut versions = vec![version_for_path(session, &write.rel_path)];
        versions.extend(self.index_version.iter().cloned());
        versions.sort_by(|left, right| left.path.cmp(&right.path));
        versions.dedup_by(|left, right| left.path.eq_ignore_ascii_case(&right.path));
        EntityEditInfo {
            target: EntityEditTarget {
                kind: self.kind,
                id: id.to_string(),
                source,
                write,
                state,
                linked_record: self.linked.get(id).cloned(),
            },
            base_versions: versions,
        }
    }
}

pub(in crate::services::project) fn describe_entity_target(
    session: &mut ProjectSession,
    kind: EntityKind,
    id: &str,
) -> AppResult<EntityEditInfo> {
    Ok(prepare_entity_targets(session, kind)?.describe(session, id))
}

pub(crate) fn location(root: &str, rel_path: &str) -> EntityFileLocation {
    EntityFileLocation {
        source: ResourceSource::Mod,
        root: root.to_string(),
        rel_path: rel_path.to_string(),
        path: Path::new(root).join(rel_path).to_string_lossy().to_string(),
    }
}
