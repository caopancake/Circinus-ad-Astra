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
        return Err(crate::errors::AppError::message(
            "spec.target_exists",
            "实体目标已存在",
        ));
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

pub(in crate::services::project) fn describe_entity_target(
    session: &mut ProjectSession,
    kind: EntityKind,
    id: &str,
) -> AppResult<EntityEditInfo> {
    let root = session.manifest.mod_root.clone();
    let definition = crate::domain::editor_config_definitions::entity_spec_definition(kind);
    let source = match kind {
        EntityKind::Ship => session
            .ship_files
            .get(id)
            .map(|record| record.location.clone()),
        EntityKind::Weapon => session
            .weapon_specs
            .get(id)
            .map(|record| record.location.clone()),
        EntityKind::Projectile => session
            .projectile_specs
            .get(id)
            .map(|record| record.location.clone()),
        EntityKind::System => session
            .system_files
            .get(id)
            .map(|record| record.location.clone()),
        EntityKind::Skill => session
            .skill_files
            .get(id)
            .map(|record| record.location.clone()),
        EntityKind::Faction => session
            .faction_files
            .get(id)
            .map(|record| record.location.clone()),
        EntityKind::Variant => session
            .variant_files
            .iter()
            .find(|record| record.variant_id == id)
            .map(|record| location(&root, &record.rel_path)),
        EntityKind::Skin => session
            .skin_files
            .iter()
            .find(|record| record.skin_hull_id == id)
            .map(|record| location(&root, &record.rel_path)),
        EntityKind::Mission => Path::new(&root)
            .join(format!("data/missions/{id}"))
            .is_dir()
            .then(|| location(&root, &format!("data/missions/{id}"))),
    };
    let write = source
        .as_ref()
        .filter(|source| source.source == ResourceSource::Mod)
        .cloned()
        .unwrap_or_else(|| {
            location(
                &root,
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
    let linked_record = if let Some(table) = definition.and_then(|definition| definition.csv_table)
    {
        ensure_registered_table_rows(session, table)?;
        let table_state = session
            .csv_tables
            .get(table.as_str())
            .expect("registered table");
        versions.push(version_for_path(session, &table_state.path));
        table_state
            .rows
            .as_ref()
            .expect("associated rows are loaded")
            .iter()
            .find(|row| string_from_row(&row.data, "id").as_deref() == Some(id))
            .map(|row| EntityLinkedRecord::Csv {
                table,
                row_key: row.row_key.clone(),
            })
    } else if kind == EntityKind::Faction {
        let index = "data/world/factions/factions.csv";
        versions.push(version_for_path(session, index));
        let entries = crate::io::read_faction_index(Path::new(&root))?;
        entries
            .iter()
            .find(|entry| {
                source
                    .as_ref()
                    .is_some_and(|source| entry.path.to_string_lossy() == source.path)
            })
            .map(|entry| EntityLinkedRecord::Index {
                path: index.to_string(),
                row_index: entry.row_index,
            })
    } else if kind == EntityKind::Mission {
        let index = "data/missions/mission_list.csv";
        versions.push(version_for_path(session, index));
        ensure_session_table_rows(session, MISSION_LIST_TABLE_KEY)?;
        session.csv_tables[MISSION_LIST_TABLE_KEY]
            .rows
            .as_ref()
            .expect("mission rows are loaded")
            .iter()
            .position(|row| string_from_row(&row.data, "mission").as_deref() == Some(id))
            .map(|row_index| EntityLinkedRecord::Index {
                path: index.to_string(),
                row_index,
            })
    } else {
        None
    };
    versions.sort_by(|left, right| left.path.cmp(&right.path));
    versions.dedup_by(|left, right| left.path.eq_ignore_ascii_case(&right.path));
    Ok(EntityEditInfo {
        target: EntityEditTarget {
            kind,
            id: id.to_string(),
            source,
            write,
            state,
            linked_record,
        },
        base_versions: versions,
    })
}

pub(crate) fn location(root: &str, rel_path: &str) -> EntityFileLocation {
    EntityFileLocation {
        source: ResourceSource::Mod,
        root: root.to_string(),
        rel_path: rel_path.to_string(),
        path: Path::new(root).join(rel_path).to_string_lossy().to_string(),
    }
}
