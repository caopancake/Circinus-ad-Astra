use crate::domain::editor_config_definitions::FACTION_SPEC_DEFINITION;
use crate::{
    domain::config::validate_config_id,
    errors::{AppError, AppResult},
    io::{
        FileChangeSetBuilder, JsonWriteBatch, acquire_root_write_lock, read_csv_data,
        strip_internal_fields,
    },
    models::{IndexedConfigKind, IndexedEntityRefresh, JsonWriteOptions, WriteResult},
    parsers::render_csv_text,
};
use serde_json::{Map, Value};
use std::path::Path;

type IndexRows = Vec<Map<String, Value>>;
type IndexTable = (Vec<String>, IndexRows);

pub struct IndexedSaveInput<'a> {
    pub index_row: Map<String, Value>,
    pub entity_data: Value,
    pub delete_previous_target: bool,
    pub json_write: JsonWriteOptions,
    pub ordered_json: Option<&'a str>,
}

pub fn save_indexed_config_entity(
    mod_root: &str,
    kind: IndexedConfigKind,
    previous_id: Option<&str>,
    next_id: &str,
    index_row: Map<String, Value>,
    entity_data: Value,
    delete_previous_target: bool,
) -> AppResult<WriteResult<Value>> {
    save_indexed_config_with_json(
        mod_root,
        kind,
        previous_id,
        next_id,
        IndexedSaveInput {
            index_row,
            entity_data,
            delete_previous_target,
            json_write: JsonWriteOptions::default(),
            ordered_json: None,
        },
    )
}

pub fn save_indexed_config_with_json(
    mod_root: &str,
    kind: IndexedConfigKind,
    previous_id: Option<&str>,
    next_id: &str,
    input: IndexedSaveInput<'_>,
) -> AppResult<WriteResult<Value>> {
    let write_lock = acquire_root_write_lock(Path::new(mod_root))?;
    let IndexedSaveInput {
        index_row,
        entity_data,
        delete_previous_target,
        json_write,
        ordered_json,
    } = input;
    let next_id = validate_config_id(next_id, kind.invalid_id_message())?.to_string();
    let previous_id = previous_id
        .filter(|value| !value.trim().is_empty())
        .map(|value| validate_config_id(value, kind.invalid_id_message()).map(str::to_string))
        .transpose()?;
    let definition = indexed_config_definition(kind)?;
    let mod_root = Path::new(mod_root);
    let index_path = mod_root.join(definition.index_rel_path());
    let (mut header, mut rows) = read_index_table(&index_path, definition.default_header())?;
    let existing_next = rows
        .iter()
        .position(|row| definition.row_matches(row, &header, &next_id));
    if existing_next.is_some() && previous_id.as_deref() != Some(next_id.as_str()) {
        return Err(AppError::message(
            "config.entity_exists",
            format!("{} 已存在: {next_id}", definition.display_name()),
        ));
    }
    if previous_id.as_deref() != Some(next_id.as_str())
        && definition.target_exists(mod_root, &next_id)
    {
        return Err(AppError::message(
            "config.target_exists",
            format!(
                "{}目标已存在: {}",
                definition.display_name(),
                definition.target_rel_path(&next_id)
            ),
        ));
    }
    if let Some(previous_id) = previous_id.as_deref() {
        require_index_row(&rows, &header, definition, previous_id)?;
    }

    remove_index_row(&mut rows, &header, definition, previous_id.as_deref());
    let index_row = definition.normalize_index_row(index_row, &next_id);
    upsert_index_row(&mut header, &mut rows, definition, index_row, &next_id);

    let mut builder = FileChangeSetBuilder::new_with_lock(mod_root, write_lock)?;
    if delete_previous_target
        && definition.rename_strategy == RenameStrategy::CopyDirectoryBeforeWrite
        && let Some(previous) = previous_id
            .as_deref()
            .filter(|previous| *previous != next_id)
    {
        builder.copy_directory(
            definition.target_rel_path(previous),
            definition.target_rel_path(&next_id),
        )?;
    }
    builder.root_text_file(
        definition.index_rel_path(),
        Some(render_csv_text(&header, &rows.iter().collect::<Vec<_>>())?),
    )?;
    let source_id = previous_id.as_deref().unwrap_or(&next_id);
    let mut json = JsonWriteBatch::new(json_write);
    definition.add_save_changes(
        &mut builder,
        source_id,
        &next_id,
        &entity_data,
        &mut json,
        ordered_json,
    )?;
    if delete_previous_target
        && let Some(previous) = previous_id
            .as_deref()
            .filter(|previous| *previous != next_id)
    {
        definition.add_delete_target_change(&mut builder, previous)?;
    }
    json.finish()?;
    let changes = builder.apply()?;
    Ok(WriteResult::from_refreshed_entity(
        changes,
        serde_json::to_value(IndexedEntityRefresh {
            entity_id: next_id,
            index_path: definition.index_rel_path().to_string(),
            index_header: header,
            index_rows: rows,
            entity_data,
        })?,
    ))
}

pub fn create_indexed_config_entity(
    mod_root: &str,
    kind: IndexedConfigKind,
    next_id: &str,
    index_row: Map<String, Value>,
    entity_data: Value,
) -> AppResult<WriteResult<Value>> {
    save_indexed_config_entity(mod_root, kind, None, next_id, index_row, entity_data, false)
}

pub fn delete_indexed_config_entity(
    mod_root: &str,
    kind: IndexedConfigKind,
    id: &str,
    delete_target: bool,
) -> AppResult<WriteResult<Value>> {
    let write_lock = acquire_root_write_lock(Path::new(mod_root))?;
    let id = validate_config_id(id, kind.invalid_id_message())?.to_string();
    let definition = indexed_config_definition(kind)?;
    let mod_root = Path::new(mod_root);
    let index_path = mod_root.join(definition.index_rel_path());
    let (header, mut rows) = read_index_table(&index_path, definition.default_header())?;
    if !remove_index_row(&mut rows, &header, definition, Some(&id)) {
        return Err(AppError::message(
            "config.index_missing",
            format!("{}索引不存在: {id}", definition.display_name()),
        ));
    }

    let mut builder = FileChangeSetBuilder::new_with_lock(mod_root, write_lock)?;
    builder.root_text_file(
        definition.index_rel_path(),
        Some(render_csv_text(&header, &rows.iter().collect::<Vec<_>>())?),
    )?;
    if delete_target {
        definition.add_delete_target_change(&mut builder, &id)?;
    }
    let changes = builder.apply()?;
    Ok(WriteResult::from_refreshed_entity(
        changes,
        serde_json::to_value(IndexedEntityRefresh {
            entity_id: id,
            index_path: definition.index_rel_path().to_string(),
            index_header: header,
            index_rows: rows,
            entity_data: Value::Null,
        })?,
    ))
}

impl IndexedConfigKind {
    fn invalid_id_message(self) -> &'static str {
        match self {
            IndexedConfigKind::Faction => FACTION_SPEC_DEFINITION.invalid_id_message,
            IndexedConfigKind::Mission => "无效战役 ID",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum RenameStrategy {
    DeletePreviousAfterWrite,
    CopyDirectoryBeforeWrite,
}

struct IndexedConfigDefinition {
    kind: IndexedConfigKind,
    display_name: &'static str,
    index_rel_path: &'static str,
    default_header: &'static [&'static str],
    target_rel_path: fn(&str) -> String,
    row_matches: fn(&Map<String, Value>, &[String], &str) -> bool,
    normalize_index_row: fn(Map<String, Value>, &str) -> Map<String, Value>,
    add_save_changes: AddSaveChanges,
    add_delete_target_change:
        fn(&mut FileChangeSetBuilder, &IndexedConfigDefinition, &str) -> AppResult<()>,
    rename_strategy: RenameStrategy,
}

type AddSaveChanges = fn(
    &mut FileChangeSetBuilder,
    &IndexedConfigDefinition,
    &str,
    &str,
    &Value,
    &mut JsonWriteBatch,
    Option<&str>,
) -> AppResult<()>;

fn indexed_config_definition(
    kind: IndexedConfigKind,
) -> AppResult<&'static IndexedConfigDefinition> {
    INDEXED_CONFIG_DEFINITIONS
        .iter()
        .find(|definition| definition.kind == kind)
        .ok_or_else(|| {
            AppError::message(
                "config.kind_unknown",
                format!("未注册的 indexed config 种类: {kind:?}"),
            )
        })
}

impl IndexedConfigDefinition {
    fn display_name(&self) -> &'static str {
        self.display_name
    }

    fn index_rel_path(&self) -> &'static str {
        self.index_rel_path
    }

    fn default_header(&self) -> Vec<String> {
        self.default_header
            .iter()
            .map(|value| value.to_string())
            .collect()
    }

    fn target_rel_path(&self, id: &str) -> String {
        (self.target_rel_path)(id)
    }

    fn target_exists(&self, mod_root: &Path, id: &str) -> bool {
        mod_root.join(self.target_rel_path(id)).exists()
    }

    fn row_matches(&self, row: &Map<String, Value>, header: &[String], id: &str) -> bool {
        (self.row_matches)(row, header, id)
    }

    fn normalize_index_row(&self, row: Map<String, Value>, id: &str) -> Map<String, Value> {
        (self.normalize_index_row)(row, id)
    }

    fn add_save_changes(
        &self,
        builder: &mut FileChangeSetBuilder,
        source_id: &str,
        id: &str,
        entity_data: &Value,
        json: &mut JsonWriteBatch,
        ordered_json: Option<&str>,
    ) -> AppResult<()> {
        (self.add_save_changes)(
            builder,
            self,
            source_id,
            id,
            entity_data,
            json,
            ordered_json,
        )
    }

    fn add_delete_target_change(
        &self,
        builder: &mut FileChangeSetBuilder,
        id: &str,
    ) -> AppResult<()> {
        (self.add_delete_target_change)(builder, self, id)
    }
}

const INDEXED_CONFIG_DEFINITIONS: [IndexedConfigDefinition; 2] = [
    IndexedConfigDefinition {
        kind: IndexedConfigKind::Faction,
        display_name: "势力",
        index_rel_path: "data/world/factions/factions.csv",
        default_header: &["id", "file"],
        target_rel_path: faction_target_rel_path,
        row_matches: faction_row_matches,
        normalize_index_row: normalize_faction_index_row,
        add_save_changes: add_faction_save_changes,
        add_delete_target_change: add_faction_delete_target_change,
        rename_strategy: RenameStrategy::DeletePreviousAfterWrite,
    },
    IndexedConfigDefinition {
        kind: IndexedConfigKind::Mission,
        display_name: "战役",
        index_rel_path: "data/missions/mission_list.csv",
        default_header: &["mission"],
        target_rel_path: mission_target_rel_path,
        row_matches: mission_row_matches,
        normalize_index_row: normalize_mission_index_row,
        add_save_changes: add_mission_save_changes,
        add_delete_target_change: add_mission_delete_target_change,
        rename_strategy: RenameStrategy::CopyDirectoryBeforeWrite,
    },
];

fn read_index_table(path: &Path, default_header: Vec<String>) -> AppResult<IndexTable> {
    let table = read_csv_data(path)?;
    if table.header.is_empty() {
        Ok((default_header, table.rows))
    } else {
        Ok((table.header, table.rows))
    }
}

fn upsert_index_row(
    header: &mut Vec<String>,
    rows: &mut Vec<Map<String, Value>>,
    definition: &IndexedConfigDefinition,
    row: Map<String, Value>,
    id: &str,
) {
    for key in row.keys() {
        if !header.contains(key) {
            header.push(key.clone());
        }
    }
    if let Some(index) = rows
        .iter()
        .position(|existing| definition.row_matches(existing, header, id))
    {
        rows[index] = row;
    } else {
        rows.push(row);
    }
}

fn remove_index_row(
    rows: &mut Vec<Map<String, Value>>,
    header: &[String],
    definition: &IndexedConfigDefinition,
    id: Option<&str>,
) -> bool {
    let Some(id) = id else {
        return false;
    };
    let before = rows.len();
    rows.retain(|row| !definition.row_matches(row, header, id));
    before != rows.len()
}

fn require_index_row(
    rows: &[Map<String, Value>],
    header: &[String],
    definition: &IndexedConfigDefinition,
    id: &str,
) -> AppResult<()> {
    if rows
        .iter()
        .any(|row| definition.row_matches(row, header, id))
    {
        return Ok(());
    }
    Err(AppError::message(
        "config.index_missing",
        format!("{}索引不存在: {id}", definition.display_name()),
    ))
}

fn file_stem(value: &str) -> String {
    Path::new(value)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(value)
        .to_string()
}

fn faction_target_rel_path(id: &str) -> String {
    FACTION_SPEC_DEFINITION.default_rel_path(id)
}

fn mission_target_rel_path(id: &str) -> String {
    format!("data/missions/{id}")
}

fn faction_row_matches(row: &Map<String, Value>, _header: &[String], id: &str) -> bool {
    let target = faction_target_rel_path(id);
    row.values().any(|value| {
        let Some(value) = value.as_str().map(str::trim) else {
            return false;
        };
        value == id || value == target || file_stem(value) == id
    })
}

fn mission_row_matches(row: &Map<String, Value>, _header: &[String], id: &str) -> bool {
    let Some(value) = row.get("mission").and_then(Value::as_str).map(str::trim) else {
        return false;
    };
    value == id
}

fn normalize_faction_index_row(_row: Map<String, Value>, id: &str) -> Map<String, Value> {
    let mut row = Map::new();
    row.insert(
        "faction".to_string(),
        Value::String(faction_target_rel_path(id)),
    );
    row
}

fn normalize_mission_index_row(mut row: Map<String, Value>, id: &str) -> Map<String, Value> {
    row.insert("mission".to_string(), Value::String(id.to_string()));
    row
}

fn add_faction_save_changes(
    builder: &mut FileChangeSetBuilder,
    definition: &IndexedConfigDefinition,
    source_id: &str,
    id: &str,
    entity_data: &Value,
    json: &mut JsonWriteBatch,
    ordered_json: Option<&str>,
) -> AppResult<()> {
    let file = entity_data.get("file").ok_or_else(|| {
        AppError::message("config.missing_faction_file", "missing faction file data")
    })?;
    let clean = strip_internal_fields(file);
    let source = builder.root().join(definition.target_rel_path(source_id));
    let rendered = json.render(&source, &clean, ordered_json)?;
    if json.is_preserving()
        && source_id == id
        && source.exists()
        && crate::io::read_utf8_no_bom(&source)? == rendered
    {
        return Ok(());
    }
    builder.text_file(definition.target_rel_path(id), Some(rendered))?;
    Ok(())
}

fn add_mission_save_changes(
    builder: &mut FileChangeSetBuilder,
    definition: &IndexedConfigDefinition,
    source_id: &str,
    id: &str,
    entity_data: &Value,
    json: &mut JsonWriteBatch,
    ordered_json: Option<&str>,
) -> AppResult<()> {
    let descriptor = entity_data.get("descriptor").ok_or_else(|| {
        AppError::message(
            "config.missing_mission_descriptor",
            "missing mission descriptor data",
        )
    })?;
    let text = entity_data
        .get("text")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::message("config.missing_mission_text", "missing mission text data")
        })?;
    let clean = strip_internal_fields(descriptor);
    let source = builder.root().join(format!(
        "{}/descriptor.json",
        definition.target_rel_path(source_id)
    ));
    let rendered = json.render(&source, &clean, ordered_json)?;
    let descriptor_unchanged = json.is_preserving()
        && source_id == id
        && source.exists()
        && crate::io::read_utf8_no_bom(&source)? == rendered;
    if !descriptor_unchanged {
        builder.text_file(
            format!("{}/descriptor.json", definition.target_rel_path(id)),
            Some(rendered),
        )?;
    }
    builder.text_file(
        format!("{}/mission_text.txt", definition.target_rel_path(id)),
        Some(text.to_string()),
    )?;
    Ok(())
}

fn add_faction_delete_target_change(
    builder: &mut FileChangeSetBuilder,
    definition: &IndexedConfigDefinition,
    id: &str,
) -> AppResult<()> {
    builder.text_file(definition.target_rel_path(id), None)?;
    Ok(())
}

fn add_mission_delete_target_change(
    builder: &mut FileChangeSetBuilder,
    definition: &IndexedConfigDefinition,
    id: &str,
) -> AppResult<()> {
    builder.delete_directory(definition.target_rel_path(id))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::temp_dir;
    use crate::{
        io::{read_utf8_no_bom, write_utf8_no_bom},
        models::FileChangeReplayDirection,
        services::file_changes::apply_file_change_set,
    };
    use std::fs;

    #[test]
    fn faction_save_preserves_spec_comments_and_order() {
        let root = temp_dir("indexed_faction_preserves_json");
        let dir = root.join("data/world/factions");
        fs::create_dir_all(&dir).unwrap();
        write_utf8_no_bom(
            &dir.join("factions.csv"),
            "faction\ndata/world/factions/demo.faction\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &dir.join("demo.faction"),
            "{\n  # note\n  displayName: 'Old',\n  id: 'demo'\n}\n",
        )
        .unwrap();
        let result = save_indexed_config_with_json(
            &root.to_string_lossy(),
            IndexedConfigKind::Faction,
            Some("demo"),
            "demo",
            IndexedSaveInput {
                index_row: Map::new(),
                entity_data: serde_json::json!({"file":{"displayName":"New","id":"demo"}}),
                delete_previous_target: false,
                json_write: JsonWriteOptions {
                    preserve_original_json: true,
                    confirmed_sources: Vec::new(),
                },
                ordered_json: Some(r#"{"displayName":"New","id":"demo"}"#),
            },
        )
        .unwrap();
        let text = read_utf8_no_bom(&dir.join("demo.faction")).unwrap();
        assert_eq!(result.changes.len(), 2);
        assert!(text.contains("# note"));
        assert!(text.find("displayName").unwrap() < text.find("id:").unwrap());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn faction_save_can_rename_file_and_index_with_undo_redo() {
        let root = temp_dir("indexed_faction_rename");
        let dir = root.join("data/world/factions");
        fs::create_dir_all(&dir).unwrap();
        write_utf8_no_bom(
            &dir.join("factions.csv"),
            "faction\ndata/world/factions/old.faction\n",
        )
        .unwrap();
        write_utf8_no_bom(&dir.join("old.faction"), r#"{"id":"old"}"#).unwrap();

        let mut index_row = Map::new();
        index_row.insert(
            "faction".to_string(),
            Value::String("data/world/factions/new.faction".to_string()),
        );
        let result = save_indexed_config_entity(
            &root.to_string_lossy(),
            IndexedConfigKind::Faction,
            Some("old"),
            "new",
            index_row,
            serde_json::json!({"file": {"id": "new", "displayName": "New"}}),
            true,
        )
        .unwrap();

        assert!(!dir.join("old.faction").exists());
        assert!(dir.join("new.faction").exists());
        assert_eq!(
            read_utf8_no_bom(&dir.join("factions.csv")).unwrap(),
            "faction\ndata/world/factions/new.faction\n"
        );

        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Undo,
            result.changes.clone(),
        )
        .unwrap();
        assert!(dir.join("old.faction").exists());
        assert!(!dir.join("new.faction").exists());

        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Redo,
            result.changes,
        )
        .unwrap();
        let new_text = read_utf8_no_bom(&dir.join("new.faction")).unwrap();
        let _ = fs::remove_dir_all(root);
        assert!(new_text.contains("\"id\": \"new\""));
    }

    #[test]
    fn faction_save_keeps_single_column_game_format_on_same_id_save() {
        let root = temp_dir("indexed_faction_same_id");
        let dir = root.join("data/world/factions");
        fs::create_dir_all(&dir).unwrap();
        write_utf8_no_bom(
            &dir.join("factions.csv"),
            "faction\ndata/world/factions/demo.faction\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &dir.join("demo.faction"),
            r#"{"id":"demo","displayName":"Demo"}"#,
        )
        .unwrap();

        let mut index_row = Map::new();
        index_row.insert(
            "faction".to_string(),
            Value::String("data/world/factions/demo.faction".to_string()),
        );
        let result = save_indexed_config_entity(
            &root.to_string_lossy(),
            IndexedConfigKind::Faction,
            Some("demo"),
            "demo",
            index_row,
            serde_json::json!({"file": {"id": "demo", "displayName": "Demo"}}),
            false,
        )
        .unwrap();

        assert_eq!(
            read_utf8_no_bom(&dir.join("factions.csv")).unwrap(),
            "faction\ndata/world/factions/demo.faction\n"
        );
        assert_eq!(result.changes.len(), 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn indexed_entity_rejects_duplicate_id() {
        let root = temp_dir("indexed_duplicate_id");
        let dir = root.join("data/world/factions");
        fs::create_dir_all(&dir).unwrap();
        write_utf8_no_bom(
            &dir.join("factions.csv"),
            "faction\r\ndata/world/factions/new.faction\r\n",
        )
        .unwrap();

        let mut index_row = Map::new();
        index_row.insert(
            "faction".to_string(),
            Value::String("data/world/factions/new.faction".to_string()),
        );
        let result = save_indexed_config_entity(
            &root.to_string_lossy(),
            IndexedConfigKind::Faction,
            Some("old"),
            "new",
            index_row,
            serde_json::json!({"file": {"id": "new"}}),
            false,
        );

        let _ = fs::remove_dir_all(root);
        assert!(result.is_err());
    }

    #[test]
    fn indexed_entity_save_requires_previous_index_row() {
        let root = temp_dir("indexed_missing_previous");
        fs::create_dir_all(root.join("data/world/factions")).unwrap();
        write_utf8_no_bom(
            &root.join("data/world/factions/factions.csv"),
            "id,file\r\n",
        )
        .unwrap();

        let error = save_indexed_config_entity(
            &root.to_string_lossy(),
            IndexedConfigKind::Faction,
            Some("missing"),
            "next",
            {
                let mut row = Map::new();
                row.insert("id".to_string(), Value::String("next".to_string()));
                row
            },
            serde_json::json!({"file": {"id": "next"}}),
            false,
        )
        .unwrap_err()
        .to_string();

        let _ = fs::remove_dir_all(root);
        assert!(error.contains("势力索引不存在: missing"));
    }

    #[test]
    fn indexed_entity_delete_requires_index_row() {
        let root = temp_dir("indexed_delete_missing");
        fs::create_dir_all(root.join("data/missions")).unwrap();
        write_utf8_no_bom(&root.join("data/missions/mission_list.csv"), "mission\r\n").unwrap();

        let error = delete_indexed_config_entity(
            &root.to_string_lossy(),
            IndexedConfigKind::Mission,
            "missing",
            false,
        )
        .unwrap_err()
        .to_string();

        let _ = fs::remove_dir_all(root);
        assert!(error.contains("战役索引不存在: missing"));
    }

    #[test]
    fn mission_delete_expands_directory_invalidation_paths() {
        let root = temp_dir("mission_delete_expands_invalidation_paths");
        fs::create_dir_all(root.join("data/missions/demo")).unwrap();
        write_utf8_no_bom(
            &root.join("data/missions/mission_list.csv"),
            "mission\r\ndemo\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/missions/demo/descriptor.json"),
            r#"{"title":"Demo"}"#,
        )
        .unwrap();
        write_utf8_no_bom(&root.join("data/missions/demo/mission_text.txt"), "Demo").unwrap();

        let result = delete_indexed_config_entity(
            &root.to_string_lossy(),
            IndexedConfigKind::Mission,
            "demo",
            true,
        )
        .unwrap();

        let _ = fs::remove_dir_all(root);
        assert!(result.invalidation.paths.iter().any(|path| {
            path.replace('\\', "/")
                .ends_with("data/missions/demo/descriptor.json")
        }));
        assert!(result.invalidation.paths.iter().any(|path| {
            path.replace('\\', "/")
                .ends_with("data/missions/demo/mission_text.txt")
        }));
    }
}
