use crate::errors::{AppError, AppResult};
use serde::de::DeserializeOwned;

pub fn parse_persisted_json<T: DeserializeOwned>(text: &str) -> AppResult<T> {
    serde_json::from_str(text).map_err(|error| {
        let line = error.line();
        let source_line = text.split('\n').nth(line.saturating_sub(1)).unwrap_or("");
        let byte_end = error.column().saturating_sub(1);
        let column = source_line
            .char_indices()
            .take_while(|(offset, _)| *offset < byte_end)
            .map(|(_, character)| character.len_utf16())
            .sum::<usize>()
            + 1;
        AppError::from(error).at_position(line, Some(column))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serde_error_columns_use_editor_utf16_units() {
        let error = parse_persisted_json::<serde_json::Value>("{\"🚀\":}").unwrap_err();
        assert_eq!(error.location().unwrap().line, Some(1));
        assert_eq!(error.location().unwrap().column, Some(7));
    }
}
