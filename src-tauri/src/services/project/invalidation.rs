use crate::{
    domain::config::path_affects_target,
    errors::AppResult,
    io::{FsRootBoundary, parse_csv_text},
    models::{
        CsvTableKey, EntityKind, FileChangeKind, FileChangeRecord, InvalidatedEntityRef,
        InvalidatedQueryKind, InvalidatedQueryScope, InvalidatedResourceScope, ProjectInvalidation,
        ResourceSource, push_unique_all,
    },
    parsers::parse_starsector_json,
};
use serde_json::{Map, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

use super::{
    definitions::{entity_definitions, table_definitions},
    model::ProjectSession,
    root,
};

pub(crate) fn invalidate_session_changes(
    session: &mut ProjectSession,
    changes: &[FileChangeRecord],
) -> AppResult<ProjectInvalidation> {
    let boundary = FsRootBoundary::new(Path::new(&session.manifest.mod_root), "mod root")?;
    let files = changed_project_files(changes, &boundary)?;
    let impacts = files
        .iter()
        .map(ChangedProjectImpact::new)
        .collect::<Vec<_>>();
    let mut tables = BTreeSet::new();
    let mut entities = Vec::new();
    let mut affected_kinds = BTreeSet::new();
    let mut refresh_mod_info = false;
    for impact in &impacts {
        tables.extend(impact.target.csv_tables.iter().copied());
        refresh_mod_info |= impact.target.refresh_mod_info;
        affected_kinds.extend(impact.target.affected_entities.iter().copied());
        push_unique_all(
            &mut entities,
            invalidated_entities_for_file(&impact.target, &impact.file)?,
        );
    }
    if affected_kinds.contains(&EntityKind::Faction) {
        tables.extend(faction_annotated_tables());
    }
    let mut saved_tables = BTreeMap::new();
    for table in &tables {
        let state = session
            .csv_tables
            .get_mut(table.as_str())
            .expect("registered CSV table");
        if state.rows.is_some()
            && state.saved_text.is_some()
            && files
                .iter()
                .any(|file| file.path == state.path && file.after_text == state.saved_text)
        {
            saved_tables.insert(
                *table,
                (
                    state.rows.take().expect("saved CSV rows are loaded"),
                    state.next_row_seq,
                ),
            );
        }
    }
    for table in &tables {
        if let Some(state) = session.csv_tables.get_mut(table.as_str()) {
            state.rows = None;
        }
        refresh_table_entity_summary(session, table.as_str())?;
    }
    let mod_root = Path::new(&session.manifest.mod_root).to_path_buf();
    if refresh_mod_info {
        session.manifest.mod_info = root::read_mod_info(&mod_root)?;
    }
    for kind in affected_kinds {
        let definition = entity_definitions::entity_definition(kind)?;
        (definition.refresh)(session)?;
        if let Some(table) = definition.csv_table {
            refresh_table_entity_summary(session, table.as_str())?;
        }
    }
    for (table, (rows, next_row_seq)) in saved_tables {
        let state = session
            .csv_tables
            .get_mut(table.as_str())
            .expect("registered CSV table");
        state.rows = Some(rows);
        state.next_row_seq = next_row_seq;
    }
    let resources = impacts
        .iter()
        .map(|impact| InvalidatedResourceScope {
            source: ResourceSource::Mod,
            rel_path: impact.file.path.clone(),
        })
        .collect::<Vec<_>>();
    let tables = tables.into_iter().collect::<Vec<_>>();
    Ok(ProjectInvalidation {
        paths: impacts
            .iter()
            .map(|impact| impact.file.path.clone())
            .collect(),
        query_scopes: query_scopes_for_invalidation(&tables, &entities, &resources)?,
        tables,
        entities,
        resources,
        session: false,
    })
}

#[derive(Default)]
struct ChangedProjectPath {
    csv_tables: Vec<CsvTableKey>,
    refresh_mod_info: bool,
    affected_entities: Vec<EntityKind>,
}

struct ChangedProjectFile {
    after_text: Option<String>,
    before_text: Option<String>,
    path: String,
}

struct ChangedProjectImpact {
    file: ChangedProjectFile,
    target: ChangedProjectPath,
}

impl ChangedProjectImpact {
    fn new(file: &ChangedProjectFile) -> Self {
        Self {
            target: ChangedProjectPath::classify(&file.path),
            file: ChangedProjectFile {
                after_text: file.after_text.clone(),
                before_text: file.before_text.clone(),
                path: file.path.clone(),
            },
        }
    }
}

impl ChangedProjectPath {
    fn classify(changed_path: &str) -> Self {
        let affected_entities = entity_definitions::entity_definitions()
            .iter()
            .filter(|definition| (definition.path_matches)(definition, changed_path))
            .map(|definition| definition.kind)
            .collect();
        Self {
            csv_tables: affected_csv_tables(changed_path),
            refresh_mod_info: path_affects_target(changed_path, "mod_info.json"),
            affected_entities,
        }
    }
}

fn changed_project_files(
    changes: &[FileChangeRecord],
    boundary: &FsRootBoundary,
) -> AppResult<Vec<ChangedProjectFile>> {
    let mut files = Vec::new();
    for change in changes {
        match change.kind {
            FileChangeKind::File => {
                push_changed_project_file(
                    &mut files,
                    boundary,
                    Path::new(&change.path),
                    change.before_text.clone(),
                    change.after_text.clone(),
                )?;
            }
            FileChangeKind::Directory => {
                changed_directory_files(&mut files, boundary, change)?;
            }
        }
    }
    Ok(files)
}

fn changed_directory_files(
    files: &mut Vec<ChangedProjectFile>,
    boundary: &FsRootBoundary,
    change: &FileChangeRecord,
) -> AppResult<()> {
    let mut before = BTreeMap::new();
    let mut after = BTreeMap::new();
    for snapshot in &change.before_files {
        before.insert(snapshot.rel_path.clone(), snapshot);
    }
    for snapshot in &change.after_files {
        after.insert(snapshot.rel_path.clone(), snapshot);
    }
    let paths = before
        .keys()
        .chain(after.keys())
        .cloned()
        .collect::<BTreeSet<_>>();
    if paths.is_empty() {
        push_changed_project_file(files, boundary, Path::new(&change.path), None, None)?;
        return Ok(());
    }
    for rel_path in paths {
        push_changed_project_file(
            files,
            boundary,
            &Path::new(&change.path).join(&rel_path),
            before
                .get(&rel_path)
                .and_then(|snapshot| snapshot.text.clone()),
            after
                .get(&rel_path)
                .and_then(|snapshot| snapshot.text.clone()),
        )?;
    }
    Ok(())
}

fn push_changed_project_file(
    files: &mut Vec<ChangedProjectFile>,
    boundary: &FsRootBoundary,
    path: &Path,
    before_text: Option<String>,
    after_text: Option<String>,
) -> AppResult<()> {
    let Some(path) =
        boundary.resolve_changed_path_to_relative(&path.to_string_lossy(), "changed path")?
    else {
        return Ok(());
    };
    if let Some(existing) = files.iter_mut().find(|file| file.path == path) {
        if before_text.is_some() {
            existing.before_text = before_text;
        }
        if after_text.is_some() {
            existing.after_text = after_text;
        }
        return Ok(());
    }
    files.push(ChangedProjectFile {
        after_text,
        before_text,
        path,
    });
    Ok(())
}

fn invalidated_entities_for_file(
    target: &ChangedProjectPath,
    file: &ChangedProjectFile,
) -> AppResult<Vec<InvalidatedEntityRef>> {
    let mut entities = Vec::new();
    for kind in &target.affected_entities {
        entities.append(&mut entity_ids_from_file(*kind, file)?);
    }
    for table in &target.csv_tables {
        for definition in entity_definitions::entity_definitions()
            .iter()
            .filter(|definition| definition.csv_table == Some(*table))
        {
            push_unique_all(&mut entities, csv_entity_ids(definition.kind, *table, file));
        }
    }
    Ok(entities)
}

fn entity_ids_from_file(
    kind: EntityKind,
    file: &ChangedProjectFile,
) -> AppResult<Vec<InvalidatedEntityRef>> {
    if kind == EntityKind::Mission {
        return Ok(mission_entity_ids(file));
    }
    let definition = entity_definitions::entity_definition(kind)?;
    let Some(spec) = definition.spec else {
        return Ok(vec![invalidated_entity(kind, None)]);
    };
    if !is_exact_spec_path(file.path.as_str(), spec.dir, spec.extension) {
        return Ok(vec![invalidated_entity(kind, None)]);
    }
    let Some(ids) = snapshot_json_ids(file, spec.id_field) else {
        return Ok(vec![invalidated_entity(kind, None)]);
    };
    Ok(ids
        .into_iter()
        .map(|id| invalidated_entity(kind, Some(id)))
        .collect())
}

fn mission_entity_ids(file: &ChangedProjectFile) -> Vec<InvalidatedEntityRef> {
    let Some(rest) = file.path.strip_prefix("data/missions/") else {
        return vec![invalidated_entity(EntityKind::Mission, None)];
    };
    if rest == "mission_list.csv" {
        return vec![invalidated_entity(EntityKind::Mission, None)];
    }
    let id = rest.split('/').next().filter(|id| !id.is_empty());
    vec![invalidated_entity(
        EntityKind::Mission,
        id.map(ToOwned::to_owned),
    )]
}

fn csv_entity_ids(
    kind: EntityKind,
    table: CsvTableKey,
    file: &ChangedProjectFile,
) -> Vec<InvalidatedEntityRef> {
    let id_field = table_definitions::csv_table_entity_id_field(table);
    let Some(before) = snapshot_csv_rows(file.before_text.as_deref(), &file.path, id_field) else {
        return vec![invalidated_entity(kind, None)];
    };
    let Some(after) = snapshot_csv_rows(file.after_text.as_deref(), &file.path, id_field) else {
        return vec![invalidated_entity(kind, None)];
    };
    before
        .keys()
        .chain(after.keys())
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .filter(|id| before.get(id) != after.get(id))
        .map(|id| invalidated_entity(kind, Some(id)))
        .collect()
}

fn snapshot_json_ids(file: &ChangedProjectFile, id_field: &str) -> Option<Vec<String>> {
    let texts = [file.before_text.as_deref(), file.after_text.as_deref()];
    if texts.iter().all(Option::is_none) {
        return None;
    }
    texts
        .into_iter()
        .flatten()
        .map(|text| {
            parse_starsector_json(text)
                .ok()?
                .get(id_field)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|id| !id.is_empty())
                .map(ToOwned::to_owned)
        })
        .collect::<Option<BTreeSet<_>>>()
        .map(|ids| ids.into_iter().collect())
}

fn snapshot_csv_rows(
    text: Option<&str>,
    path: &str,
    id_field: &str,
) -> Option<BTreeMap<String, Vec<Map<String, Value>>>> {
    let Some(text) = text else {
        return Some(BTreeMap::new());
    };
    let csv = parse_csv_text(path, text).ok()?;
    if !csv.header.iter().any(|header| header == id_field) {
        return None;
    }
    let mut rows = BTreeMap::new();
    for row in csv.rows {
        if super::model::is_comment_row(&row) {
            continue;
        }
        let Some(id) = super::model::string_from_row(&row, id_field) else {
            continue;
        };
        rows.entry(id).or_insert_with(Vec::new).push(row);
    }
    Some(rows)
}

fn invalidated_entity(kind: EntityKind, id: Option<String>) -> InvalidatedEntityRef {
    InvalidatedEntityRef { kind, id }
}

fn is_exact_spec_path(path: &str, dir: &str, extension: &str) -> bool {
    path.starts_with(&format!("{dir}/")) && path.ends_with(extension)
}

fn faction_annotated_tables() -> impl Iterator<Item = CsvTableKey> {
    table_definitions::csv_table_definitions()
        .iter()
        .filter(|definition| definition.spec.supports_faction_filter)
        .map(|definition| definition.spec.key)
}

fn query_scopes_for_invalidation(
    tables: &[CsvTableKey],
    entities: &[InvalidatedEntityRef],
    resources: &[InvalidatedResourceScope],
) -> AppResult<Vec<InvalidatedQueryScope>> {
    let mut scopes = Vec::new();
    if tables.contains(&CsvTableKey::SpecialItems)
        || entities
            .iter()
            .any(|entity| entity.kind == EntityKind::Faction)
    {
        for definition in table_definitions::csv_table_definitions() {
            let source = format!("{}.tags", definition.spec.key.as_str());
            push_source_option_query_scope(&mut scopes, source.clone());
            push_source_option_query_scope(&mut scopes, format!("csv:{source}"));
        }
    }
    for table in tables {
        push_query_scope(
            &mut scopes,
            InvalidatedQueryScope {
                kind: InvalidatedQueryKind::CsvTableWindow,
                table: Some(*table),
                source: None,
                entity: None,
                resource: None,
            },
        );
        push_query_scope(
            &mut scopes,
            InvalidatedQueryScope {
                kind: InvalidatedQueryKind::CsvRowPreview,
                table: Some(*table),
                source: None,
                entity: None,
                resource: None,
            },
        );
        push_query_scope(
            &mut scopes,
            InvalidatedQueryScope {
                kind: InvalidatedQueryKind::CsvSourceOptions,
                table: Some(*table),
                source: None,
                entity: None,
                resource: None,
            },
        );
    }
    for entity in entities {
        push_entity_query_scope(
            &mut scopes,
            InvalidatedQueryKind::EntityDetail,
            entity.clone(),
        );
        push_entity_query_scope(
            &mut scopes,
            InvalidatedQueryKind::EntityList,
            entity.clone(),
        );
        let definition = entity_definitions::entity_definition(entity.kind)?;
        for source in entity_definitions::source_option_origin_scopes(definition) {
            push_source_option_query_scope(&mut scopes, source);
        }
        for impact in definition.query_impacts {
            push_query_scope(
                &mut scopes,
                InvalidatedQueryScope {
                    kind: *impact,
                    table: None,
                    source: None,
                    entity: None,
                    resource: None,
                },
            );
        }
    }
    for resource in resources {
        push_query_scope(
            &mut scopes,
            InvalidatedQueryScope {
                kind: InvalidatedQueryKind::ResourceDataUrls,
                table: None,
                source: None,
                entity: None,
                resource: Some(resource.clone()),
            },
        );
    }
    Ok(scopes)
}

fn push_source_option_query_scope(scopes: &mut Vec<InvalidatedQueryScope>, source: String) {
    push_query_scope(
        scopes,
        InvalidatedQueryScope {
            kind: InvalidatedQueryKind::CsvSourceOptions,
            table: None,
            source: Some(source),
            entity: None,
            resource: None,
        },
    );
}

fn push_entity_query_scope(
    scopes: &mut Vec<InvalidatedQueryScope>,
    kind: InvalidatedQueryKind,
    entity: InvalidatedEntityRef,
) {
    push_query_scope(
        scopes,
        InvalidatedQueryScope {
            kind,
            table: None,
            source: None,
            entity: Some(entity),
            resource: None,
        },
    );
}

fn push_query_scope(scopes: &mut Vec<InvalidatedQueryScope>, scope: InvalidatedQueryScope) {
    if !scopes.contains(&scope) {
        scopes.push(scope);
    }
}

fn affected_csv_tables(path: &str) -> Vec<CsvTableKey> {
    table_definitions::csv_table_definitions()
        .iter()
        .filter_map(|definition| {
            path_affects_target(path, definition.spec.rel_path).then_some(definition.spec.key)
        })
        .collect()
}

fn refresh_table_entity_summary(session: &mut ProjectSession, table_key: &str) -> AppResult<()> {
    let Some(definition) = table_definitions::csv_table_definition_by_key(table_key) else {
        return Ok(());
    };
    let count = if let Some(count) = table_definitions::csv_table_entity_summary(
        definition.spec.key,
        &session.manifest.entity_summaries,
    ) {
        count
    } else {
        let mod_root = Path::new(&session.manifest.mod_root);
        let rel_path = session
            .csv_tables
            .get(table_key)
            .map(|table| table.path.as_str());
        if let Some(rel_path) = rel_path {
            table_definitions::count_valid_csv_entities(mod_root, definition.spec.key, rel_path)?
        } else {
            0
        }
    };
    session
        .manifest
        .table_entity_summaries
        .insert(definition.spec.key, count);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blueprint_metadata_invalidates_tags_for_every_registered_table_and_source_origin() {
        for (tables, entities) in [
            (vec![CsvTableKey::SpecialItems], Vec::new()),
            (
                Vec::new(),
                vec![invalidated_entity(
                    EntityKind::Faction,
                    Some("demo".to_string()),
                )],
            ),
        ] {
            let scopes = query_scopes_for_invalidation(&tables, &entities, &[]).unwrap();
            for definition in table_definitions::csv_table_definitions() {
                let source = format!("{}.tags", definition.spec.key.as_str());
                for source in [source.clone(), format!("csv:{source}")] {
                    assert!(
                        scopes
                            .iter()
                            .any(|scope| scope.kind == InvalidatedQueryKind::CsvSourceOptions
                                && scope.source.as_ref() == Some(&source))
                    );
                }
            }
        }
    }
    use crate::testutil::temp_dir;
    use crate::{
        io::write_utf8_no_bom,
        models::{CsvTableKey, FileChangeKind, FileChangeRecord, FileSnapshot},
        services::project::performance::PerformanceTrace,
    };
    use std::{fs, path::PathBuf};

    #[test]
    fn invalidating_variant_path_refreshes_session_variant_index() {
        let root = temp_dir("invalidate_variant_index");
        fs::create_dir_all(root.join("data/variants")).unwrap();
        write_utf8_no_bom(
            &root.join("data/variants/demo.variant"),
            r#"{"variantId":"old","hullId":"hull"}"#,
        )
        .unwrap();
        let mut trace = PerformanceTrace::new("project.openSession");
        let mut session =
            super::super::session::build_project_session(&root, None, &mut trace).unwrap();
        write_utf8_no_bom(
            &root.join("data/variants/demo.variant"),
            r#"{"variantId":"new","hullId":"hull"}"#,
        )
        .unwrap();

        let invalidation = invalidate_session_changes(
            &mut session,
            &[file_change(
                root.join("data/variants/demo.variant"),
                Some(r#"{"variantId":"old","hullId":"hull"}"#),
                Some(r#"{"variantId":"new","hullId":"hull"}"#),
            )],
        )
        .unwrap();

        let _ = fs::remove_dir_all(root);
        assert!(
            session
                .variant_files
                .iter()
                .any(|variant| variant.variant_id == "new")
        );
        assert!(
            !session
                .variant_files
                .iter()
                .any(|variant| variant.variant_id == "old")
        );
        assert_eq!(session.manifest.entity_summaries.variants, 1);
        assert_eq!(
            invalidation.entities,
            vec![
                invalidated_entity(EntityKind::Variant, Some("new".to_string())),
                invalidated_entity(EntityKind::Variant, Some("old".to_string())),
            ]
        );
    }

    #[test]
    fn invalidating_faction_path_refreshes_tags_and_loaded_csv_rows() {
        let root = temp_dir("invalidate_faction_tags");
        fs::create_dir_all(root.join("data/world/factions")).unwrap();
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        write_utf8_no_bom(
            &root.join("data/world/factions/factions.csv"),
            "id,file\r\ndemo,data/world/factions/demo.faction\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/world/factions/demo.faction"),
            r#"{"id":"demo","displayName":"Demo","knownShips":{"tags":["demo_old_bp"]}}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/hulls/ship_data.csv"),
            "id,tags\r\nship,demo_old_bp\r\n",
        )
        .unwrap();
        let mut trace = PerformanceTrace::new("project.openSession");
        let mut session =
            super::super::session::build_project_session(&root, None, &mut trace).unwrap();
        super::super::cache::ensure_registered_table_rows(&mut session, CsvTableKey::Ships)
            .unwrap();
        write_utf8_no_bom(
            &root.join("data/world/factions/demo.faction"),
            r#"{"id":"demo","displayName":"Demo","knownShips":{"tags":["demo_new_bp"]}}"#,
        )
        .unwrap();

        let invalidation = invalidate_session_changes(
            &mut session,
            &[file_change(
                root.join("data/world/factions/demo.faction"),
                Some(r#"{"id":"demo","displayName":"Demo","knownShips":{"tags":["demo_old_bp"]}}"#),
                Some(r#"{"id":"demo","displayName":"Demo","knownShips":{"tags":["demo_new_bp"]}}"#),
            )],
        )
        .unwrap();

        let _ = fs::remove_dir_all(root);
        assert!(session.tag_map.contains_key("demo_new_bp"));
        assert!(!session.tag_map.contains_key("demo_old_bp"));
        assert!(
            session
                .csv_tables
                .get(CsvTableKey::Ships.as_str())
                .and_then(|table| table.rows.as_ref())
                .is_none()
        );
        assert!(invalidation.entities.contains(&invalidated_entity(
            EntityKind::Faction,
            Some("demo".to_string())
        )));
        assert!(invalidation.tables.contains(&CsvTableKey::Ships));
        assert!(invalidation.tables.contains(&CsvTableKey::Weapons));
    }

    #[test]
    fn invalidating_csv_snapshot_scopes_ship_queries_to_changed_rows() {
        let root = temp_dir("invalidate_ship_csv_snapshot");
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        let before = "id,name\r\nalpha,Old\r\nbeta,Unchanged\r\n";
        let after = "id,name\r\nalpha,New\r\nbeta,Unchanged\r\n";
        write_utf8_no_bom(&root.join("data/hulls/ship_data.csv"), after).unwrap();
        let mut trace = PerformanceTrace::new("project.openSession");
        let mut session =
            super::super::session::build_project_session(&root, None, &mut trace).unwrap();

        let invalidation = invalidate_session_changes(
            &mut session,
            &[file_change(
                root.join("data/hulls/ship_data.csv"),
                Some(before),
                Some(after),
            )],
        )
        .unwrap();

        let _ = fs::remove_dir_all(root);
        assert_eq!(invalidation.tables, vec![CsvTableKey::Ships]);
        assert_eq!(
            invalidation.entities,
            vec![invalidated_entity(
                EntityKind::Ship,
                Some("alpha".to_string())
            )]
        );
        assert!(invalidation.query_scopes.iter().any(|scope| {
            scope.kind == InvalidatedQueryKind::EntityDetail
                && scope.entity
                    == Some(invalidated_entity(
                        EntityKind::Ship,
                        Some("alpha".to_string()),
                    ))
        }));
        assert!(!invalidation.query_scopes.iter().any(|scope| {
            scope.kind == InvalidatedQueryKind::EntityDetail
                && scope.entity == Some(invalidated_entity(EntityKind::Ship, None))
        }));
    }

    #[test]
    fn invalidating_directory_snapshot_refreshes_exact_variant_ids() {
        let root = temp_dir("invalidate_variant_directory_snapshot");
        fs::create_dir_all(root.join("data/variants")).unwrap();
        let old = r#"{"variantId":"old","hullId":"hull"}"#;
        write_utf8_no_bom(&root.join("data/variants/old.variant"), old).unwrap();
        let mut trace = PerformanceTrace::new("project.openSession");
        let mut session =
            super::super::session::build_project_session(&root, None, &mut trace).unwrap();
        fs::remove_dir_all(root.join("data/variants")).unwrap();

        let invalidation = invalidate_session_changes(
            &mut session,
            &[directory_change(
                root.join("data/variants"),
                vec![FileSnapshot {
                    rel_path: "old.variant".to_string(),
                    text: Some(old.to_string()),
                    data_base64: None,
                }],
                Vec::new(),
            )],
        )
        .unwrap();

        let _ = fs::remove_dir_all(root);
        assert!(session.variant_files.is_empty());
        assert_eq!(
            invalidation.entities,
            vec![invalidated_entity(
                EntityKind::Variant,
                Some("old".to_string())
            )]
        );
    }

    #[test]
    fn spec_snapshots_cover_all_registered_kinds_and_change_directions() {
        for definition in entity_definitions::entity_definitions() {
            let Some(spec) = definition.spec else {
                continue;
            };
            let path = format!("{}/demo{}", spec.dir, spec.extension);
            let old = format!(r#"{{"{}":"old"}}"#, spec.id_field);
            let new = format!(r#"{{"{}":"new"}}"#, spec.id_field);
            let target = ChangedProjectPath::classify(&path);

            assert_eq!(
                invalidated_entities_for_file(
                    &target,
                    &ChangedProjectFile {
                        after_text: Some(new.clone()),
                        before_text: None,
                        path: path.clone(),
                    },
                )
                .unwrap(),
                vec![invalidated_entity(definition.kind, Some("new".to_string()))]
            );
            assert_eq!(
                invalidated_entities_for_file(
                    &target,
                    &ChangedProjectFile {
                        after_text: None,
                        before_text: Some(old.clone()),
                        path: path.clone(),
                    },
                )
                .unwrap(),
                vec![invalidated_entity(definition.kind, Some("old".to_string()))]
            );
            assert_eq!(
                invalidated_entities_for_file(
                    &target,
                    &ChangedProjectFile {
                        after_text: Some(new),
                        before_text: Some(old),
                        path,
                    },
                )
                .unwrap(),
                vec![
                    invalidated_entity(definition.kind, Some("new".to_string())),
                    invalidated_entity(definition.kind, Some("old".to_string())),
                ]
            );
        }
    }

    #[test]
    fn csv_snapshots_cover_create_delete_and_rename_for_registered_entities() {
        for definition in entity_definitions::entity_definitions() {
            let Some(table) = definition.csv_table else {
                continue;
            };
            let id_field = table_definitions::csv_table_entity_id_field(table);
            let path = table_definitions::csv_table_definition(table).spec.rel_path;
            let target = ChangedProjectPath::classify(path);
            let create = format!("{id_field},name\r\nnew,New\r\n");
            let delete = format!("{id_field},name\r\nold,Old\r\n");
            let rename_before = format!("{id_field},name\r\nold,Same\r\n");
            let rename_after = format!("{id_field},name\r\nnew,Same\r\n");

            assert_eq!(
                invalidated_entities_for_file(
                    &target,
                    &ChangedProjectFile {
                        after_text: Some(create),
                        before_text: None,
                        path: path.to_string(),
                    },
                )
                .unwrap(),
                vec![invalidated_entity(definition.kind, Some("new".to_string()))]
            );
            assert_eq!(
                invalidated_entities_for_file(
                    &target,
                    &ChangedProjectFile {
                        after_text: None,
                        before_text: Some(delete),
                        path: path.to_string(),
                    },
                )
                .unwrap(),
                vec![invalidated_entity(definition.kind, Some("old".to_string()))]
            );
            assert_eq!(
                invalidated_entities_for_file(
                    &target,
                    &ChangedProjectFile {
                        after_text: Some(rename_after),
                        before_text: Some(rename_before),
                        path: path.to_string(),
                    },
                )
                .unwrap(),
                vec![
                    invalidated_entity(definition.kind, Some("new".to_string())),
                    invalidated_entity(definition.kind, Some("old".to_string())),
                ]
            );
        }
    }

    #[test]
    fn csv_snapshot_ignores_rows_without_an_entity_id() {
        let path = table_definitions::csv_table_definition(CsvTableKey::Weapons)
            .spec
            .rel_path;
        let target = ChangedProjectPath::classify(path);
        let before = "id,type,number\r\n,ENERGY,69\r\ndemo_weapon,ENERGY,70\r\n";
        let after = "id,type,number\r\n,ENERGY,69\r\ndemo_weapon,BALLISTIC,70\r\n";

        assert_eq!(
            invalidated_entities_for_file(
                &target,
                &ChangedProjectFile {
                    after_text: Some(after.to_string()),
                    before_text: Some(before.to_string()),
                    path: path.to_string(),
                },
            )
            .unwrap(),
            vec![invalidated_entity(
                EntityKind::Weapon,
                Some("demo_weapon".to_string()),
            )]
        );
    }

    #[test]
    fn changed_path_classification_uses_project_relative_targets() {
        assert!(affected_csv_tables("data/hulls/ship_data.csv").contains(&CsvTableKey::Ships));
        assert!(affected_csv_tables("data/hulls").contains(&CsvTableKey::Ships));
        assert!(
            !affected_csv_tables("backup/data/hulls/ship_data.csv").contains(&CsvTableKey::Ships)
        );
        assert!(entity_spec_path_matches(
            EntityKind::Faction,
            "data/world/factions/demo.faction"
        ));
        assert!(!entity_spec_path_matches(
            EntityKind::Faction,
            "backup/data/world/factions/demo.faction"
        ));
        assert!(entity_spec_path_matches(EntityKind::Ship, "data/hulls"));
        assert!(entity_spec_path_matches(EntityKind::Skin, "data/hulls"));
        assert!(entity_spec_path_matches(
            EntityKind::Ship,
            "data/hulls/demo.ship"
        ));
        assert!(!entity_spec_path_matches(
            EntityKind::Ship,
            "data/hulls/demo.txt"
        ));
        assert!(!entity_spec_path_matches(
            EntityKind::Ship,
            "backup/data/hulls/demo.ship"
        ));
    }

    #[test]
    fn invalidating_external_absolute_path_does_not_refresh_session_indexes() {
        let root = temp_dir("invalidate_external_current");
        let external = temp_dir("invalidate_external_other");
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        fs::create_dir_all(external.join("data/hulls")).unwrap();
        write_utf8_no_bom(
            &root.join("data/hulls/current.ship"),
            r#"{"hullId":"current"}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &external.join("data/hulls/external.ship"),
            r#"{"hullId":"external"}"#,
        )
        .unwrap();
        let mut trace = PerformanceTrace::new("project.openSession");
        let mut session =
            super::super::session::build_project_session(&root, None, &mut trace).unwrap();

        invalidate_session_changes(
            &mut session,
            &[file_change(
                external.join("data/hulls/external.ship"),
                None,
                Some(r#"{"hullId":"external"}"#),
            )],
        )
        .unwrap();

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(external);
        assert_eq!(session.manifest.entity_summaries.ships, 1);
        assert!(session.ship_files.contains_key("current"));
        assert!(!session.ship_files.contains_key("external"));
    }

    fn file_change(
        path: PathBuf,
        before_text: Option<&str>,
        after_text: Option<&str>,
    ) -> FileChangeRecord {
        FileChangeRecord {
            kind: FileChangeKind::File,
            path: path.to_string_lossy().to_string(),
            before_exists: before_text.is_some(),
            before_text: before_text.map(ToOwned::to_owned),
            before_data_base64: None,
            before_files: Vec::new(),
            after_exists: after_text.is_some(),
            after_text: after_text.map(ToOwned::to_owned),
            after_data_base64: None,
            after_files: Vec::new(),
        }
    }

    fn directory_change(
        path: PathBuf,
        before_files: Vec<FileSnapshot>,
        after_files: Vec<FileSnapshot>,
    ) -> FileChangeRecord {
        FileChangeRecord {
            kind: FileChangeKind::Directory,
            path: path.to_string_lossy().to_string(),
            before_exists: !before_files.is_empty(),
            before_text: None,
            before_data_base64: None,
            before_files,
            after_exists: !after_files.is_empty(),
            after_text: None,
            after_data_base64: None,
            after_files,
        }
    }

    fn entity_spec_path_matches(kind: EntityKind, path: &str) -> bool {
        entity_definitions::entity_definitions()
            .iter()
            .find(|definition| definition.kind == kind)
            .and_then(|definition| definition.spec)
            .is_some_and(|spec| spec.path_matches(path))
    }
}
