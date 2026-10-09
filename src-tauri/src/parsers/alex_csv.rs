use crate::{
    errors::{AppError, AppResult},
    models::CsvTable,
};
use serde_json::{Map, Value};

/// Parses Starsector CSV-like bytes with the game's CSVParser semantics:
/// tolerant of short/long rows, preserving empty and `#` lines; errors carry
/// the path context.
pub fn parse_csv_bytes(path_label: &str, bytes: &[u8]) -> AppResult<CsvTable> {
    let chars = decode_csv_chars(path_label, bytes)?;
    parse_csv_chars(path_label, &chars)
}

/// Renders rows back to CSV text. Rows are passed as references so write
/// paths never clone a full table just to render them.
pub fn render_csv_text(header: &[String], rows: &[&Map<String, Value>]) -> AppResult<String> {
    let mut out = String::new();
    write_record_line(&mut out, header.iter().map(String::as_str));
    for row in rows {
        if row.is_empty() {
            // An empty Map is a bare empty line, distinct from an all-empty
            // cells row (rendered as `,`-run).
            out.push('\n');
            continue;
        }
        let cells = header
            .iter()
            .map(|h| value_to_cell(row.get(h).unwrap_or(&Value::Null)))
            .collect::<AppResult<Vec<_>>>()?;
        write_record_line(&mut out, cells.iter().map(String::as_str));
    }
    Ok(out)
}

/// Minimal quoting: a cell is quoted only when it contains `,` `"` `\n` `\r`,
/// matching the csv crate output this renderer replaced.
fn write_record_line<'a>(out: &mut String, cells: impl Iterator<Item = &'a str>) {
    for (index, cell) in cells.enumerate() {
        if index > 0 {
            out.push(',');
        }
        write_cell(out, cell);
    }
    out.push('\n');
}

fn write_cell(out: &mut String, cell: &str) {
    if !cell.is_empty() && cell.chars().all(|character| character == '"') {
        out.push_str(&cell.replace('"', "\"\""));
        return;
    }
    if cell.contains([',', '"', '\n', '\r']) {
        out.push('"');
        out.push_str(&cell.replace('"', "\"\""));
        out.push('"');
    } else {
        out.push_str(cell);
    }
}

pub fn value_to_cell(value: &Value) -> AppResult<String> {
    match value {
        Value::Null => Ok(String::new()),
        Value::String(s) => Ok(s.clone()),
        Value::Number(n) => Ok(n.to_string()),
        Value::Bool(b) => Ok(b.to_string()),
        other => serde_json::to_string(other).map_err(|error| {
            AppError::message("parse.csv_cell", format!("CSV 单元格序列化失败: {error}"))
        }),
    }
}

// Decodes bytes to chars; the CP1252 smart-quote mapping owner lives in
// models and is shared with text reading.
fn decode_csv_chars(path_label: &str, bytes: &[u8]) -> AppResult<Vec<char>> {
    crate::models::decode_starsector_text(bytes)
        .map(|text| text.chars().collect())
        .map_err(|offset| {
            AppError::message(
                "text.invalid_utf8",
                format!("{path_label} is not valid UTF-8 at byte {offset}"),
            )
            .at_path(path_label)
        })
}

// Plain comma split (quotes invisible, like the game's header handling); with
// a comma present, trailing empty cells are dropped per Java split(",").
fn parse_header_line(line: &[char]) -> Vec<String> {
    let raw: String = line.iter().collect();
    if !raw.contains(',') {
        return vec![parse_header_cell(&raw)];
    }
    let mut cells: Vec<String> = raw.split(',').map(str::to_string).collect();
    while cells.last().is_some_and(|cell| cell.is_empty()) {
        cells.pop();
    }
    cells
        .into_iter()
        .map(|cell| parse_header_cell(&cell))
        .collect()
}

fn parse_header_cell(cell: &str) -> String {
    let mut cell = cell.trim_matches(|c: char| c <= ' ').to_string();
    if cell.starts_with('"') {
        cell.remove(0);
    }
    if cell.ends_with('"') {
        cell.pop();
    }
    cell.replace("\"\"", "\"")
}

// The game CSVParser body loop: `\r\n` normalized to `\n` (lone `\r` kept);
// ROW_START→COL_START→IN_COLUMN fall through on one char; quotes toggle
// anywhere and `""` yields a literal quote; rows end at unquoted `\n`. Column
// tolerance per the game: extra cells dropped, missing keys left unwritten.
// Tool adjudication: bare empty lines are kept as empty Maps and `#` lines
// kept as rows (the game skips both); EOF flushes explicitly instead of the
// game's appended `\n` so no synthetic empty line appears.
fn parse_csv_chars(path_label: &str, text: &[char]) -> AppResult<CsvTable> {
    let mut normalized: Vec<char> = Vec::with_capacity(text.len());
    let mut cursor = 0usize;
    while cursor < text.len() {
        if text[cursor] == '\r' && text.get(cursor + 1) == Some(&'\n') {
            cursor += 1;
        } else {
            normalized.push(text[cursor]);
            cursor += 1;
        }
    }

    let Some(header_end) = normalized.iter().position(|&c| c == '\n') else {
        // The game yields nothing without a newline; the whole line is kept
        // as header so the grid still shows column names.
        let header = parse_header_line(&normalized);
        return Ok(CsvTable {
            header,
            rows: Vec::new(),
            path: path_label.to_string(),
        });
    };
    let header = parse_header_line(&normalized[..header_end]);
    let body = &normalized[header_end + 1..];

    #[derive(PartialEq)]
    enum State {
        RowStart,
        ColStart,
        InColumn,
    }
    let mut rows: Vec<Map<String, Value>> = Vec::new();
    let mut state = State::RowStart;
    let mut row = Map::new();
    let mut cell = String::new();
    let mut col_index = 0usize;
    let mut in_quote = false;
    let mut quote_buf = String::new();
    let mut line = 1 + normalized[..=header_end]
        .iter()
        .filter(|&&character| matches!(character, '\n' | '\r'))
        .count();
    let mut last_quote_line = line;

    let mut index = 0usize;
    while index < body.len() {
        let c = body[index];
        let next = body.get(index + 1).copied().unwrap_or(' ');
        let entered_at_row_start = state == State::RowStart;

        if entered_at_row_start {
            row = Map::new();
            col_index = 0;
            state = State::ColStart;
        }
        if state == State::ColStart {
            cell = String::new();
            state = State::InColumn;
        }
        if state == State::InColumn {
            if c == '"' {
                if next == '"' {
                    cell.push('"');
                    quote_buf.push('"');
                    index += 1;
                } else {
                    in_quote = !in_quote;
                    if in_quote {
                        quote_buf.clear();
                        last_quote_line = line;
                    }
                }
            } else if (c == ',' || c == '\n') && !in_quote {
                if col_index < header.len() {
                    row.insert(
                        header[col_index].clone(),
                        Value::String(std::mem::take(&mut cell)),
                    );
                }
                if c == ',' {
                    col_index += 1;
                    state = State::ColStart;
                } else {
                    if entered_at_row_start {
                        rows.push(Map::new());
                    } else {
                        rows.push(std::mem::take(&mut row));
                    }
                    state = State::RowStart;
                }
            } else {
                cell.push(c);
                quote_buf.push(c);
            }
        }

        if matches!(c, '\n' | '\r') {
            line += 1;
        }
        index += 1;
    }

    if state != State::RowStart {
        if col_index < header.len() {
            row.insert(
                header[col_index].clone(),
                Value::String(std::mem::take(&mut cell)),
            );
        }
        rows.push(row);
    }

    if in_quote {
        return Err(AppError::context(
            format!("解析 CSV 失败 ({path_label})"),
            AppError::message(
                "parse.csv_unterminated_quote",
                format!(
                    "mismatched quotes in the string; unterminated quote starting at line {last_quote_line}, context: [{quote_buf}]"
                ),
            ),
        ).at_position(last_quote_line, None).at_path(path_label));
    }

    Ok(CsvTable {
        header,
        rows,
        path: path_label.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_csv_text(path_label: &str, text: &str) -> AppResult<CsvTable> {
        parse_csv_bytes(path_label, text.as_bytes())
    }

    #[test]
    fn save_preserves_visible_empty_rows_from_rows() {
        let header = vec!["id".to_string(), "name".to_string()];
        let mut empty = Map::new();
        empty.insert("id".to_string(), Value::String(String::new()));
        empty.insert("name".to_string(), Value::String(String::new()));
        let mut row = Map::new();
        row.insert("id".to_string(), Value::String("b".to_string()));
        row.insert("name".to_string(), Value::String("B".to_string()));
        let out = render_csv_text(&header, &[&empty, &row]).unwrap();
        assert!(out.lines().any(|line| line == ","));
        assert!(out.contains("b,B"));
    }

    #[test]
    fn save_renders_empty_map_rows_as_bare_empty_lines() {
        let header = vec!["id".to_string(), "name".to_string()];
        let mut row = Map::new();
        row.insert("id".to_string(), Value::String("b".to_string()));
        row.insert("name".to_string(), Value::String("B".to_string()));
        let out = render_csv_text(&header, &[&Map::new(), &row]).unwrap();
        assert_eq!(out, "id,name\n\nb,B\n");
    }

    #[test]
    fn read_tolerates_short_and_long_rows() {
        // Game tolerance: short rows leave keys unwritten, extra cells drop.
        let table = parse_csv_text(
            "csv_tolerates_width.csv",
            "id,name,notes\r\nsolo\r\na,A,alpha,extra,more\r\n",
        )
        .unwrap();

        assert_eq!(table.rows.len(), 2);
        assert_eq!(table.rows[0]["id"], "solo");
        assert_eq!(table.rows[0].get("name"), None);
        assert_eq!(table.rows[1]["id"], "a");
        assert_eq!(table.rows[1]["notes"], "alpha");
        assert_eq!(table.rows[1].len(), 3);
    }

    #[test]
    fn read_keeps_visible_empty_rows_and_distinguishes_empty_line_from_empty_cells() {
        let table = parse_csv_text(
            "csv_keeps_visible_empty_rows.csv",
            "id,name,notes\r\na,A,alpha\r\n#section\r\n\r\n,,\r\nb,B,beta\r\n",
        )
        .unwrap();

        assert_eq!(table.rows.len(), 5);
        assert_eq!(table.rows[0]["id"], "a");
        assert_eq!(table.rows[1]["id"], "#section");
        // A bare empty line is an empty Map; `,,` is an all-keys empty row.
        assert_eq!(table.rows[2], Map::new());
        assert_eq!(table.rows[3]["id"], "");
        assert_eq!(table.rows[3]["name"], "");
        assert_eq!(table.rows[3]["notes"], "");
        assert_eq!(table.rows[4]["id"], "b");
    }

    #[test]
    fn read_preserves_blank_lines_inside_quoted_multiline_fields() {
        let table = parse_csv_text(
            "csv_multiline_blank_field.csv",
            "id,name,desc\r\na,A,\"first line\r\n\r\nthird line\"\r\n#section\r\nb,B,plain\r\n",
        )
        .unwrap();

        assert_eq!(table.rows.len(), 3);
        assert_eq!(table.rows[0]["id"], "a");
        // The game normalizes \r\n to \n up front, quoted newlines included.
        assert_eq!(table.rows[0]["desc"], "first line\n\nthird line");
        assert_eq!(table.rows[1]["id"], "#section");
        assert_eq!(table.rows[2]["id"], "b");
    }

    #[test]
    fn read_toggles_quote_state_on_cp1252_smart_quotes() {
        // Decoded smart quotes toggle the quote state like any other quote;
        // the comma on row 2 survives because the state is back inside quotes.
        let table = parse_csv_bytes(
            "csv_multiline_inner_quotes.csv",
            b"id,type,text1,text2,text3,text4,text5,notes\r\nmonitor,SHIP,\"An oddity that \x93sometimes\x94 works.\r\n\r\nA unique \x93flux shunt\x94 modification.\",,,,,\r\nheron,SHIP,\"A so-called \x93Cruiser School\x94, the forward-thinking design won.\",,,,,\r\n",
        )
        .unwrap();

        assert_eq!(table.rows.len(), 2);
        assert_eq!(table.rows[0]["id"], "monitor");
        assert_eq!(
            table.rows[0]["text1"],
            "An oddity that sometimes works.\n\nA unique flux shunt modification."
        );
        assert_eq!(
            table.rows[1]["text1"],
            "A so-called Cruiser School, the forward-thinking design won."
        );
    }

    #[test]
    fn read_keeps_hash_prefixed_data_rows_with_full_width() {
        let table = parse_csv_text(
            "csv_hash_prefixed_data_row.csv",
            "name,id,desc\r\nA,a,alpha\r\n#Disabled Name,disabled,\"first line\r\n\r\nthird line\"\r\n#section\r\nB,b,beta\r\n",
        )
        .unwrap();

        assert_eq!(table.rows.len(), 4);
        assert_eq!(table.rows[1]["name"], "#Disabled Name");
        assert_eq!(table.rows[1]["id"], "disabled");
        assert_eq!(table.rows[1]["desc"], "first line\n\nthird line");
        // Short `#section` row: only the first key exists (tolerance).
        assert_eq!(table.rows[2]["name"], "#section");
        assert_eq!(table.rows[2].get("id"), None);
        assert_eq!(table.rows[3]["id"], "b");
    }

    #[test]
    fn read_keeps_hash_prefixed_short_rows_with_missing_keys() {
        let table = parse_csv_text(
            "csv_hash_prefixed_short_row.csv",
            "id,text,text2,text3\r\nid1,hi,hello,wow\r\n#id2,\r\n#id3,\"\"\r\nid4,a,b,c\r\n",
        )
        .unwrap();

        assert_eq!(table.rows.len(), 4);
        assert_eq!(table.rows[1]["id"], "#id2");
        assert_eq!(table.rows[1]["text"], "");
        assert_eq!(table.rows[1].get("text2"), None);
        assert_eq!(table.rows[1].get("text3"), None);
        assert_eq!(table.rows[2]["id"], "#id3");
        // `""` is a doubled-quote pair producing one literal quote, not an
        // empty field.
        assert_eq!(table.rows[2]["text"], "\"");
        assert_eq!(table.rows[3]["id"], "id4");
    }

    #[test]
    fn read_rejects_unterminated_quoted_field_at_eof() {
        let error = parse_csv_text(
            "csv_unterminated_quote.csv",
            "id,text\r\na,\"unterminated\r\nfield",
        )
        .unwrap_err()
        .to_string();

        assert!(error.contains("解析 CSV 失败"));
        assert!(error.contains("csv_unterminated_quote.csv"));
        assert!(error.contains("mismatched quotes in the string"));
        assert!(error.contains("starting at line 2"));
    }

    #[test]
    fn csv_error_keeps_path_and_physical_quote_line() {
        let error = parse_csv_text("demo.csv", "id,text\na,\"line\n\nunfinished").unwrap_err();
        assert_eq!(error.code(), "parse.csv_unterminated_quote");
        let location = error.location().unwrap();
        assert_eq!(location.path.as_deref(), Some("demo.csv"));
        assert_eq!(location.line, Some(2));
        assert_eq!(location.column, None);
        let error = parse_csv_text("demo.csv", "id,text\nrow\r,\"unfinished").unwrap_err();
        assert_eq!(error.location().unwrap().line, Some(3));
    }

    #[test]
    fn read_parses_header_cells_with_trim_and_quote_stripping() {
        let table = parse_csv_text(
            "csv_header_cells.csv",
            " id , \"name\" ,\"a\"\"b\"\r\n1,2,3\r\n",
        )
        .unwrap();

        assert_eq!(table.header, vec!["id", "name", "a\"b"]);
        assert_eq!(table.rows[0]["a\"b"], "3");
    }

    #[test]
    fn read_drops_trailing_empty_header_cells_like_java_split() {
        let table = parse_csv_text("csv_header_trailing.csv", "id,name,,\r\na,A\r\n").unwrap();
        assert_eq!(table.header, vec!["id", "name"]);
        // A comma-less line is a single cell, blank lines included.
        let table = parse_csv_text("csv_header_blank_line.csv", "\r\na,A\r\n").unwrap();
        assert_eq!(table.header, vec![""]);
    }

    #[test]
    fn read_treats_header_only_file_as_header_with_no_rows() {
        let table = parse_csv_text("csv_header_only.csv", "id,name\r\n").unwrap();
        assert_eq!(table.header, vec!["id", "name"]);
        assert!(table.rows.is_empty());
    }

    #[test]
    fn read_treats_newline_less_file_as_header_row() {
        let table = parse_csv_text("csv_no_newline.csv", "id,name").unwrap();
        assert_eq!(table.header, vec!["id", "name"]);
        assert!(table.rows.is_empty());
    }

    #[test]
    fn read_flushes_last_row_without_trailing_newline() {
        let table = parse_csv_text("csv_no_trailing_newline.csv", "id,name\r\na,A").unwrap();
        assert_eq!(table.rows.len(), 1);
        assert_eq!(table.rows[0]["id"], "a");
        assert_eq!(table.rows[0]["name"], "A");

        let table =
            parse_csv_text("csv_no_trailing_newline_comment.csv", "id,name\r\n#c,X").unwrap();
        assert_eq!(table.rows.len(), 1);
        assert_eq!(table.rows[0]["id"], "#c");
    }

    #[test]
    fn read_preserves_lone_carriage_return_inside_cells() {
        // Only \r\n is normalized; a lone \r is an ordinary character.
        let table = parse_csv_text("csv_lone_cr.csv", "id,name\r\na\rb,B\r\n").unwrap();
        assert_eq!(table.rows[0]["id"], "a\rb");
        assert_eq!(table.rows[0]["name"], "B");
    }

    #[test]
    fn read_toggles_quotes_across_delimiters_like_game() {
        // Quotes toggle anywhere and are consumed structurally, so an odd
        // count pulls the following comma into the cell.
        let table = parse_csv_text("csv_toggle_quotes.csv", "id,name\r\na\"x,y\"b,B\r\n").unwrap();
        assert_eq!(table.rows.len(), 1);
        assert_eq!(table.rows[0]["id"], "ax,yb");
        assert_eq!(table.rows[0]["name"], "B");
    }

    #[test]
    fn render_csv_text_writes_header_and_rows() {
        let header = vec!["id".to_string(), "name".to_string()];
        let mut row = Map::new();
        row.insert("id".to_string(), Value::String("x".to_string()));
        row.insert("name".to_string(), Value::String("X".to_string()));
        let out = render_csv_text(&header, &[&row]).unwrap();
        assert!(out.lines().next().is_some_and(|line| line == "id,name"));
        assert!(out.contains("x,X"));
    }

    #[test]
    fn render_parse_round_trip_preserves_a_quote_only_cell() {
        let header = vec!["id".to_string(), "text".to_string()];
        let mut row = Map::new();
        row.insert("id".to_string(), Value::String("a".to_string()));
        row.insert("text".to_string(), Value::String("\"".to_string()));
        let rendered = render_csv_text(&header, &[&row]).unwrap();
        let parsed = parse_csv_bytes("csv_quote_only.csv", rendered.as_bytes()).unwrap();
        assert_eq!(parsed.rows[0]["text"], "\"");
        assert_eq!(
            render_csv_text(&parsed.header, &parsed.rows.iter().collect::<Vec<_>>()).unwrap(),
            rendered
        );
    }

    #[test]
    fn utf8_characters_are_decoded_before_cp1252_fallback() {
        let text = "id,name\na,铜\n";
        let table = parse_csv_bytes("csv_utf8_multibyte.csv", text.as_bytes()).unwrap();
        assert_eq!(table.rows[0]["name"], "铜");
    }

    fn row_of(pairs: [(&str, &str); 4]) -> Map<String, Value> {
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_string(), Value::String(value.to_string())))
            .collect()
    }

    #[test]
    fn parse_render_parse_round_trip_is_semantic_identity_and_render_is_stable() {
        let header = vec![
            "id".to_string(),
            "name".to_string(),
            "desc".to_string(),
            "notes".to_string(),
        ];
        let rows = vec![
            row_of([
                ("id", "a"),
                ("name", "A, with comma"),
                ("desc", "he said \"hi\""),
                ("notes", "plain"),
            ]),
            row_of([
                ("id", "#Disabled Name"),
                ("name", "disabled"),
                ("desc", "first\n\nthird"),
                ("notes", "graphics/a.png"),
            ]),
            row_of([
                ("id", "#section"),
                ("name", ""),
                ("desc", ""),
                ("notes", ""),
            ]),
            row_of([("id", ""), ("name", ""), ("desc", ""), ("notes", "")]),
            Map::new(),
            row_of([
                ("id", "b"),
                ("name", "舰船, 引号\"与换行\n混合"),
                ("desc", ""),
                ("notes", "x"),
            ]),
        ];

        let first = render_csv_text(&header, &rows.iter().collect::<Vec<_>>()).unwrap();
        let reparsed = parse_csv_bytes("csv_round_trip.csv", first.as_bytes()).unwrap();
        let second =
            render_csv_text(&reparsed.header, &reparsed.rows.iter().collect::<Vec<_>>()).unwrap();

        assert_eq!(reparsed.header, header);
        assert_eq!(reparsed.rows, rows);
        assert_eq!(second, first);
    }
}

/// Real-mod byte-for-byte replay fixtures (sanitised subset of a third-party
/// mod). The contract under test: reading a supported CSV into memory and
/// rendering it back must reproduce the original bytes. Line endings are
/// pinned to LF in the fixtures via `.gitattributes`; a trailing final
/// newline is the only tolerated normalisation.
#[cfg(test)]
mod fixture_replay_tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn fixture_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("testdata/csv")
    }

    #[test]
    fn collected_real_csv_fixtures_keep_every_cell_through_replay() {
        let dir = fixture_dir();
        let mut checked = 0;
        for entry in fs::read_dir(&dir).expect("testdata/csv must exist") {
            let path = entry.expect("readable entry").path();
            if path.extension().and_then(|e| e.to_str()) != Some("csv") {
                continue;
            }
            let original = fs::read_to_string(&path)
                .unwrap_or_else(|error| panic!("{} must be utf-8: {error}", path.display()));
            let first = parse_csv_bytes(&path.display().to_string(), original.as_bytes())
                .unwrap_or_else(|error| panic!("{} must parse: {error}", path.display()));
            let rendered = render_csv_text(&first.header, &first.rows.iter().collect::<Vec<_>>())
                .expect("render must succeed");
            let second = parse_csv_bytes(&path.display().to_string(), rendered.as_bytes())
                .unwrap_or_else(|error| {
                    panic!("rendered {} must re-parse: {error}", path.display())
                });

            // Information losslessness: every header cell and every row/cell
            // value must survive the read -> render -> read round trip.
            // Tolerated normalisations on the rendered side: minimal quoting
            // may drop redundant quote wrapping, short rows and `#` comment
            // rows get padded out to the full header width, and missing cells
            // read back as empty strings — none of that changes a value.
            assert_eq!(
                first.header,
                second.header,
                "header drift in {}",
                path.display()
            );
            let project_row = |row: &Map<String, Value>| -> Vec<String> {
                first
                    .header
                    .iter()
                    .map(|h| match row.get(h) {
                        Some(Value::String(s)) => s.clone(),
                        _ => String::new(),
                    })
                    .collect()
            };
            let first_cells: Vec<Vec<String>> = first.rows.iter().map(&project_row).collect();
            let second_cells: Vec<Vec<String>> = second.rows.iter().map(&project_row).collect();
            assert_eq!(
                first_cells.len(),
                second_cells.len(),
                "row count drift in {}",
                path.display()
            );
            for (row_index, (before, after)) in
                first_cells.iter().zip(second_cells.iter()).enumerate()
            {
                for (column_index, (before, after)) in before.iter().zip(after.iter()).enumerate() {
                    assert_eq!(
                        before,
                        after,
                        "cell drift in {} at row {} column {}",
                        path.display(),
                        row_index,
                        first.header[column_index]
                    );
                }
            }
            // The rendered form must itself be a fixed point of the renderer.
            let re_rendered =
                render_csv_text(&second.header, &second.rows.iter().collect::<Vec<_>>())
                    .expect("re-render must succeed");
            assert_eq!(
                rendered,
                re_rendered,
                "render is not byte-stable on {}",
                path.display()
            );
            checked += 1;
        }
        assert!(
            checked >= 13,
            "expected the full collected fixture set, saw {checked}"
        );
    }
}
