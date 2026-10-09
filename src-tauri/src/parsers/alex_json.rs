//! Starsector JSON parser: char-level tokener aligned item-by-item with the
//! game's modded org.json (json.jar 2010 + LoadingUtils, verified against
//! javap bytecode and deobf sources).
//!
//! Aligned tolerances: root must be an object and trailing text is ignored;
//! trailing commas/semicolons and `;` separators; unquoted words (inner
//! spaces kept, empty word errors); single-quoted strings; `=>`/`=` key
//! separators; `(` arrays; null slots after `,`; `#` comments stripped with
//! LoadingUtils defects preserved (escapes invisible, quote state flipped
//! inside comments, `\r` dropped); non-finite numbers and duplicate keys are
//! errors.
//!
//! Known divergence: Java hex float literals (`0x1.5p3`) do not parse in
//! Rust; that shape does not occur in mod files.

use crate::errors::{AppError, AppResult};
use serde_json::{Map, Value};

/// Parses Starsector JSON text; the root must be an object, errors carry
/// line/column, and text after the root `}` is ignored like the game.
pub fn parse_starsector_json(text: &str) -> AppResult<Value> {
    let stripped = strip_hash_comments(text);
    let mut tokener = Tokener::new(stripped);
    tokener.next_object()
}

// LoadingUtils.parseJSONStrippingComments semantics, defects included: `"`
// flips state unconditionally and `\` escapes are invisible; newline resets
// all state; `\r` is dropped so only `\n` reaches the tokener.
struct StrippedJson {
    text: String,
    positions: Vec<(usize, usize)>,
}

fn strip_hash_comments(text: &str) -> StrippedJson {
    let mut result = String::with_capacity(text.len());
    let mut positions = vec![(1, 1)];
    let mut line = 1;
    let mut column = 1;
    let mut previous_cr = false;
    let mut in_comment = false;
    let mut in_string = false;
    for ch in text.chars() {
        match ch {
            '\r' => {
                line += 1;
                column = 1;
            }
            '\n' => {
                if !previous_cr {
                    line += 1;
                }
                column = 1;
            }
            _ => column += ch.len_utf16(),
        }
        previous_cr = ch == '\r';
        if ch == '"' {
            in_string = !in_string;
        }

        if ch == '\n' || ch == '\r' {
            in_comment = false;
            in_string = false;
            if ch == '\n' {
                result.push('\n');
                positions.push((line, column));
            }
        } else if ch == '#' && !in_string {
            in_comment = true;
        } else if !in_comment {
            result.push(ch);
            positions.push((line, column));
        }
    }

    *positions
        .last_mut()
        .expect("source has an initial position") = (line, column);
    StrippedJson {
        text: result,
        positions,
    }
}

struct Tokener {
    chars: Vec<char>,
    pos: usize,
    positions: Vec<(usize, usize)>,
}

impl Tokener {
    fn new(source: StrippedJson) -> Self {
        Self {
            chars: source.text.chars().collect(),
            pos: 0,
            positions: source.positions,
        }
    }

    // The game's next() returns '\0' at EOF; None plays that role here.
    fn next(&mut self) -> Option<char> {
        let c = self.chars.get(self.pos).copied();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    fn back(&mut self) {
        self.pos = self.pos.saturating_sub(1);
    }

    // The game's nextClean().
    fn next_clean(&mut self) -> Option<char> {
        loop {
            match self.next() {
                Some(c) if c > ' ' => return Some(c),
                Some(_) => continue,
                None => return None,
            }
        }
    }

    fn line_column(&self) -> (usize, usize) {
        self.positions[self.pos]
    }

    fn error(&self, code: &'static str, message: &str) -> AppError {
        let (line, column) = self.line_column();
        AppError::message(code, format!("{message} at line {line} column {column}"))
            .at_position(line, Some(column))
    }

    fn syntax(&self, message: &str) -> AppError {
        self.error("parse.json_syntax", message)
    }

    // The game's nextValue dispatch (bytecode 482-549).
    fn next_value(&mut self) -> AppResult<Value> {
        match self.next_clean() {
            None => Err(self.syntax("Missing value")),
            Some(quote @ ('"' | '\'')) => {
                let string = self.next_string(quote)?;
                Ok(Value::String(string))
            }
            Some('{') => {
                self.back();
                self.next_object()
            }
            Some('[' | '(') => {
                self.back();
                self.next_array()
            }
            Some(first) => {
                let word = self.next_word(first);
                if word.is_empty() {
                    return Err(self.syntax("Missing value"));
                }
                match string_to_value(&word) {
                    Some(value) => Ok(value),
                    None => Err(self.syntax("JSON does not allow non-finite numbers.")),
                }
            }
        }
    }

    // The game's word loop (bytecode 88-138): accumulates while `c >= ' '`
    // outside the delimiter set `,:]}/\"[{;=#`; `first` is the initial value
    // and must not be re-read.
    fn next_word(&mut self, first: char) -> String {
        let mut word = String::new();
        let mut c = first;
        loop {
            if c >= ' ' && !Self::is_word_delimiter(c) {
                word.push(c);
                match self.next() {
                    Some(next) => c = next,
                    None => break,
                }
            } else {
                self.back();
                break;
            }
        }
        word.trim_matches(|c: char| c <= ' ').to_string()
    }

    fn is_word_delimiter(c: char) -> bool {
        matches!(
            c,
            ',' | ':' | '}' | ']' | '/' | '\\' | '"' | '[' | '{' | ';' | '=' | '#'
        )
    }

    // The game's JSONObject(tokener) constructor (bytecode 48-126): `=` not
    // followed by `>` backs up and continues instead of erroring.
    fn next_object(&mut self) -> AppResult<Value> {
        match self.next_clean() {
            Some('{') => {}
            _ => return Err(self.syntax("A JSONObject text must begin with '{'")),
        }
        let mut map = Map::new();
        loop {
            match self.next_clean() {
                None => return Err(self.syntax("A JSONObject text must end with '}'")),
                Some('}') => return Ok(Value::Object(map)),
                Some(_) => {
                    self.back();
                    let key = match self.next_value()? {
                        Value::String(string) => string,
                        other => other.to_string(),
                    };
                    match self.next_clean() {
                        Some('=') => match self.next() {
                            Some('>') => {}
                            Some(_) => self.back(),
                            None => {}
                        },
                        Some(':') => {}
                        _ => return Err(self.syntax("Expected a ':' after a key")),
                    }
                    let value = self.next_value()?;
                    if map.contains_key(&key) {
                        return Err(
                            self.error("json.duplicate_key", &format!("Duplicate key \"{key}\""))
                        );
                    }
                    map.insert(key, value);
                    match self.next_clean() {
                        Some(',') | Some(';') => match self.next_clean() {
                            Some('}') => return Ok(Value::Object(map)),
                            Some(_) => self.back(),
                            None => {}
                        },
                        Some('}') => return Ok(Value::Object(map)),
                        _ => return Err(self.syntax("Expected a ',' or '}'")),
                    }
                }
            }
        }
    }

    // The game's JSONArray(tokener) constructor (bytecode 16-108): the opener
    // fixes the closer; the empty check only accepts `]` even for `(` (kept
    // defect); `,` in element position yields a null slot.
    fn next_array(&mut self) -> AppResult<Value> {
        let end = match self.next_clean() {
            Some('[') => ']',
            Some('(') => ')',
            _ => return Err(self.syntax("A JSONArray text must start with '['")),
        };
        let mut items = Vec::new();
        match self.next_clean() {
            Some(']') => return Ok(Value::Array(items)),
            Some(_) => self.back(),
            None => {}
        }
        loop {
            match self.next_clean() {
                Some(',') => {
                    self.back();
                    items.push(Value::Null);
                }
                Some(_) => {
                    self.back();
                    items.push(self.next_value()?);
                }
                None => return Err(self.syntax("Missing value")),
            }
            match self.next_clean() {
                Some(',') | Some(';') => match self.next_clean() {
                    Some(']') => return Ok(Value::Array(items)),
                    Some(_) => self.back(),
                    None => {}
                },
                Some(c) if c == end => return Ok(Value::Array(items)),
                Some(']') | Some(')') => {
                    return Err(self.syntax(&format!("Expected a '{end}'")));
                }
                _ => return Err(self.syntax("Expected a ',' or ']'")),
            }
        }
    }

    // The game's nextString (bytecode 319-411): escapes outside the accepted
    // set error instead of passing through.
    fn next_string(&mut self, quote: char) -> AppResult<String> {
        let mut out = String::new();
        loop {
            match self.next() {
                None => return Err(self.syntax("Unterminated string")),
                Some('\n') | Some('\r') => return Err(self.syntax("Unterminated string")),
                Some(c) if c == quote => return Ok(out),
                Some('\\') => match self.next() {
                    Some(escaped @ ('"' | '\'' | '/' | '\\')) => out.push(escaped),
                    Some('b') => out.push('\u{0008}'),
                    Some('t') => out.push('\t'),
                    Some('n') => out.push('\n'),
                    Some('f') => out.push('\u{000C}'),
                    Some('r') => out.push('\r'),
                    Some('u') => {
                        let mut hex = String::new();
                        for _ in 0..4 {
                            match self.next() {
                                Some(h) => hex.push(h),
                                None => return Err(self.syntax("Illegal escape.")),
                            }
                        }
                        let code = u32::from_str_radix(&hex, 16)
                            .map_err(|_| self.syntax("Illegal escape."))?;
                        if (0xD800..=0xDBFF).contains(&code) {
                            if self.next() != Some('\\') || self.next() != Some('u') {
                                return Err(self.syntax("Illegal escape."));
                            }
                            let mut low_hex = String::new();
                            for _ in 0..4 {
                                low_hex.push(
                                    self.next().ok_or_else(|| self.syntax("Illegal escape."))?,
                                );
                            }
                            let low = u32::from_str_radix(&low_hex, 16)
                                .map_err(|_| self.syntax("Illegal escape."))?;
                            if !(0xDC00..=0xDFFF).contains(&low) {
                                return Err(self.syntax("Illegal escape."));
                            }
                            let combined = 0x1_0000 + ((code - 0xD800) << 10) + (low - 0xDC00);
                            out.push(
                                char::from_u32(combined)
                                    .ok_or_else(|| self.syntax("Illegal escape."))?,
                            );
                        } else if (0xDC00..=0xDFFF).contains(&code) {
                            return Err(self.syntax("Illegal escape."));
                        } else {
                            out.push(
                                char::from_u32(code)
                                    .ok_or_else(|| self.syntax("Illegal escape."))?,
                            );
                        }
                    }
                    Some(_) => return Err(self.syntax("Illegal escape.")),
                    None => return Err(self.syntax("Unterminated string")),
                },
                Some(c) => out.push(c),
            }
        }
    }
}

// The game's modded stringToValue (bytecode 1460-1578): case-insensitive
// true/false/null; hex failure falls through to the decimal path (138 → 139);
// parse failures become strings; None means non-finite, which the game
// rejects via testValidity.
fn string_to_value(word: &str) -> Option<Value> {
    if word.is_empty() {
        return Some(Value::String(String::new()));
    }
    if word.eq_ignore_ascii_case("true") {
        return Some(Value::Bool(true));
    }
    if word.eq_ignore_ascii_case("false") {
        return Some(Value::Bool(false));
    }
    if word.eq_ignore_ascii_case("null") {
        return Some(Value::Null);
    }
    let Some(first) = word.chars().next() else {
        return Some(Value::String(word.to_string()));
    };
    if !matches!(first, '0'..='9' | '.' | '-' | '+') {
        return Some(Value::String(word.to_string()));
    }
    if first == '0'
        && word.len() > 2
        && matches!(word.as_bytes()[1], b'x' | b'X')
        && let Ok(value) = i32::from_str_radix(&word[2..], 16)
    {
        return Some(Value::Number(value.into()));
    }
    if word.contains(['.', 'e', 'E']) {
        return match word.parse::<f64>() {
            Ok(value) if value.is_finite() => {
                Some(Value::Number(serde_json::Number::from_f64(value)?))
            }
            Ok(_) => None,
            Err(_) => Some(Value::String(word.to_string())),
        };
    }
    if let Ok(value) = word.parse::<i64>() {
        return Some(Value::Number(value.into()));
    }
    Some(Value::String(word.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_locate_original_text_with_comments_crlf_and_utf16_columns() {
        for text in [
            "{# comment\n\"😀\":1,\"😀\":2}",
            "{# comment\r\n\"😀\":1,\"😀\":2}",
        ] {
            let error = parse_starsector_json(text).unwrap_err();
            let location = error.location().unwrap();
            assert_eq!(location.line, Some(2));
            assert_eq!(location.column, Some(14));
        }
        let error = parse_starsector_json("{a:1 # tail comment").unwrap_err();
        assert_eq!(error.location().unwrap().column, Some(20));
    }

    #[test]
    fn parses_crlf_pretty_json() {
        let text = "{\r\n  \"id\": \"demo_mod\",\r\n  \"name\": \"Demo Mod\"\r\n}";
        let parsed = parse_starsector_json(text).unwrap();
        assert_eq!(parsed["id"], "demo_mod");
        assert_eq!(parsed["name"], "Demo Mod");
    }

    #[test]
    fn parses_crlf_four_field_mod_info() {
        let text = concat!(
            "{\r\n",
            "  \"id\": \"demo_mod\",\r\n",
            "  \"name\": \"Demo Mod\",\r\n",
            "  \"version\": \"0.97a-RC11\",\r\n",
            "  \"gameVersion\": \"0.97a-RC11\"\r\n",
            "}"
        );
        let parsed = parse_starsector_json(text).unwrap();
        assert_eq!(parsed["id"], "demo_mod");
        assert_eq!(parsed["gameVersion"], "0.97a-RC11");
    }

    #[test]
    fn trailing_comma_and_semicolon_tolerated() {
        for text in [
            "{\"a\": 1,}",
            "{\"a\": 1;}",
            "{\"list\": [1, 2,]}",
            "{\"list\": [1; 2;]}",
            "{\"a\": [1,], \"b\": {\"c\": 2}}",
        ] {
            assert!(parse_starsector_json(text).is_ok(), "failed: {text}");
        }
    }

    #[test]
    fn semicolon_is_an_item_separator() {
        let parsed = parse_starsector_json("{\"a\": 1; \"b\": 2}").unwrap();
        assert_eq!(parsed["a"], 1);
        assert_eq!(parsed["b"], 2);
    }

    #[test]
    fn unquoted_keys_and_values() {
        let parsed = parse_starsector_json("{id: demo_mod, tag: foo-bar, odd: 1f}").unwrap();
        assert_eq!(parsed["id"], "demo_mod");
        assert_eq!(parsed["tag"], "foo-bar");
        assert_eq!(parsed["odd"], "1f");
    }

    #[test]
    fn unquoted_word_keeps_inner_spaces() {
        let parsed = parse_starsector_json("{name: Demo Mod}").unwrap();
        assert_eq!(parsed["name"], "Demo Mod");
    }

    #[test]
    fn boolean_words_are_case_insensitive() {
        // The game's modded stringToValue itself uses equalsIgnoreCase.
        for (word, expected) in [
            ("true", Value::Bool(true)),
            ("TRUE", Value::Bool(true)),
            ("True", Value::Bool(true)),
            ("false", Value::Bool(false)),
            ("FALSE", Value::Bool(false)),
        ] {
            let parsed = parse_starsector_json(&format!("{{flag: {word}}}")).unwrap();
            assert_eq!(parsed["flag"], expected, "word: {word}");
        }
    }

    #[test]
    fn duplicate_key_is_an_error() {
        let error = parse_starsector_json("{\"a\": 1, \"a\": 2}").unwrap_err();
        assert_eq!(error.code(), "json.duplicate_key");
    }

    #[test]
    fn trailing_garbage_after_root_is_ignored() {
        let parsed = parse_starsector_json("{\"a\": 1} trailing garbage }).unwrap();").unwrap();
        assert_eq!(parsed["a"], 1);
    }

    #[test]
    fn root_must_be_an_object() {
        for text in ["[1, 2]", "\"text\"", "123", ""] {
            let error = parse_starsector_json(text).unwrap_err();
            assert!(
                error.to_string().contains("must begin with '{'"),
                "text: {text}, error: {error}"
            );
        }
    }

    #[test]
    fn hash_comments_are_stripped_and_in_string_hash_survives() {
        let parsed =
            parse_starsector_json("{\n  # full line comment\n  \"a\": 1 # tail\n}").unwrap();
        assert_eq!(parsed["a"], 1);
        let parsed = parse_starsector_json("{\"url\": \"http://x#y\"}").unwrap();
        assert_eq!(parsed["url"], "http://x#y");
    }

    #[test]
    fn hash_strip_ignores_backslash_escapes() {
        // Game defect: `\"` still flips state, so the rest of a valid line is
        // stripped as a comment.
        let stripped = strip_hash_comments("{\"a\": \"x\\\" # tail\", \"b\": 2}");
        assert_eq!(stripped.text, "{\"a\": \"x\\\" ");
    }

    #[test]
    fn hash_strip_flips_quote_state_inside_comment() {
        // Game defect: quotes inside comments affect the next line's `#`.
        let stripped = strip_hash_comments("# \"in comment\n{a: 1} # \" tail\n");
        assert_eq!(stripped.text, "\n{a: 1} \n");
    }

    #[test]
    fn carriage_returns_are_dropped_before_tokener() {
        let parsed = parse_starsector_json("{\r\n\"a\": \"x\rz\"\r\n}").unwrap();
        assert_eq!(parsed["a"], "xz");
    }

    #[test]
    fn paren_array_delimiters() {
        let bracketed = parse_starsector_json("[1, 2]").unwrap_err();
        assert!(bracketed.to_string().contains("must begin with '{'"));
        // The unquoted word set has no `)`, so an unquoted last element
        // swallows it; `(...)` only closes after quoted elements.
        let parsed = parse_starsector_json("{\"list\": (\"a\", \"b\")}").unwrap();
        assert_eq!(parsed["list"], serde_json::json!(["a", "b"]));
        let error = parse_starsector_json("{\"list\": (1, 2)}").unwrap_err();
        assert!(
            error.to_string().contains("Expected a ',' or ']'"),
            "{error}"
        );
        let error = parse_starsector_json("{\"list\": [1, \"a\")}").unwrap_err();
        assert!(error.to_string().contains("Expected a ']'"), "{error}");
    }

    #[test]
    fn array_null_slots() {
        let parsed = parse_starsector_json("{\"a\": [,], \"b\": [1,,2]}").unwrap();
        assert_eq!(parsed["a"], serde_json::json!([null]));
        assert_eq!(parsed["b"], serde_json::json!([1, null, 2]));
    }

    #[test]
    fn delimiter_at_word_start_is_missing_value() {
        for text in ["{,}", "{a: ,}", "{\"list\": [,}"] {
            let error = parse_starsector_json(text).unwrap_err();
            assert!(
                error.to_string().contains("Missing value"),
                "text: {text}, error: {error}"
            );
        }
    }

    #[test]
    fn illegal_escape_is_an_error() {
        let error = parse_starsector_json("{\"a\": \"x\\qy\"}").unwrap_err();
        assert!(error.to_string().contains("Illegal escape."), "{error}");
    }

    #[test]
    fn literal_newline_inside_string_is_unterminated() {
        let error = parse_starsector_json("{\n\"a\": \"x\ny\"\n}").unwrap_err();
        assert!(error.to_string().contains("Unterminated string"), "{error}");
    }

    #[test]
    fn unquoted_number_forms_match_game() {
        let parsed =
            parse_starsector_json("{a: 007, b: -0, c: .5, d: +5, e: 1E2, f: 0x1F, g: 0X10}")
                .unwrap();
        assert_eq!(parsed["a"], 7);
        assert_eq!(parsed["b"], 0);
        assert_eq!(parsed["c"], serde_json::json!(0.5));
        assert_eq!(parsed["d"], 5);
        assert_eq!(parsed["e"], serde_json::json!(100.0));
        assert_eq!(parsed["f"], 31);
        assert_eq!(parsed["g"], 16);
    }

    #[test]
    fn hex_fall_through_to_decimal_path() {
        // Hex failure falls through to the decimal path, but `x` also fails
        // Long/Double, so the word still ends up a string.
        let parsed = parse_starsector_json("{a: 0x1234567890, b: 0xzz}").unwrap();
        assert_eq!(parsed["a"], "0x1234567890");
        assert_eq!(parsed["b"], "0xzz");
    }

    #[test]
    fn non_finite_number_is_an_error() {
        let error = parse_starsector_json("{a: 1e309}").unwrap_err();
        assert!(error.to_string().contains("non-finite"), "{error}");
    }

    #[test]
    fn arrow_and_bare_equals_key_separators() {
        let parsed = parse_starsector_json("{a=>1, b=2}").unwrap();
        assert_eq!(parsed["a"], 1);
        assert_eq!(parsed["b"], 2);
    }

    #[test]
    fn single_quoted_strings() {
        let parsed = parse_starsector_json("{'a': 'b c', 'd': 'e\\'f'}").unwrap();
        assert_eq!(parsed["a"], "b c");
        assert_eq!(parsed["d"], "e'f");
    }

    #[test]
    fn unicode_escapes() {
        let parsed = parse_starsector_json("{\"a\": \"\\u0041\\u00e9\"}").unwrap();
        assert_eq!(parsed["a"], "Aé");
    }

    #[test]
    fn unicode_surrogate_pairs_match_game_json() {
        let parsed = parse_starsector_json(r#"{"name":"\uD83D\uDE80"}"#).unwrap();
        assert_eq!(parsed["name"], "🚀");
    }

    #[test]
    fn backslash_terminates_unquoted_words() {
        let error = parse_starsector_json(r#"{"a":foo\bar}"#).unwrap_err();
        assert_eq!(error.code(), "parse.json_syntax");
    }

    #[test]
    fn eof_error_messages_match_game() {
        let error = parse_starsector_json("{\"a\": 1").unwrap_err();
        assert!(
            error.to_string().contains("Expected a ',' or '}'"),
            "{error}"
        );
        let error = parse_starsector_json("{").unwrap_err();
        assert!(
            error
                .to_string()
                .contains("A JSONObject text must end with '}'"),
            "{error}"
        );
    }

    #[test]
    fn leading_whitespace_before_root() {
        let parsed = parse_starsector_json("  \r\n{\"a\": 1}\n").unwrap();
        assert_eq!(parsed["a"], 1);
    }
}
