use crate::{
    errors::{AppError, AppResult},
    io::paths::validate_walk_entry,
    models::decode_starsector_text,
};
use std::fs::OpenOptions;
use std::{fs, path::Path};

const UTF8_BOM: &[u8] = &[0xef, 0xbb, 0xbf];

/// Opens a file for append as a writability probe without truncating content.
pub fn ensure_file_appendable(path: &Path) -> AppResult<()> {
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map(|_| ())
        .map_err(|error| {
            AppError::context(format!("打开文件失败 ({})", path.display()), error.into())
        })?;
    Ok(())
}

pub fn read_utf8_no_bom(path: &Path) -> AppResult<String> {
    let bytes = read_text_bytes_no_bom(path)?;
    decode_starsector_text(&bytes).map_err(|offset| {
        AppError::message(
            "text.invalid_utf8",
            format!("{} is not valid UTF-8 at byte {offset}", path.display()),
        )
    })
}

pub fn read_text_bytes_no_bom(path: &Path) -> AppResult<Vec<u8>> {
    if path.exists() {
        validate_walk_entry(path, "text file")?;
    }
    let bytes = fs::read(path).map_err(|error| {
        AppError::context(
            format!("读取文本文件失败 ({})", path.display()),
            error.into(),
        )
    })?;
    Ok(strip_utf8_bom(bytes))
}

fn strip_utf8_bom(bytes: Vec<u8>) -> Vec<u8> {
    if bytes.starts_with(UTF8_BOM) {
        bytes[UTF8_BOM.len()..].to_vec()
    } else {
        bytes
    }
}

pub fn write_utf8_no_bom(path: &Path, text: &str) -> AppResult<()> {
    fs::write(path, text.as_bytes()).map_err(|error| {
        AppError::context(
            format!("写入文本文件失败 ({})", path.display()),
            error.into(),
        )
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::testutil::temp_path;

    #[test]
    fn strips_utf8_bom() {
        let path = temp_path("strips_utf8_bom.txt");
        fs::write(&path, [UTF8_BOM, "ok".as_bytes()].concat()).unwrap();
        let text = read_utf8_no_bom(&path).unwrap();
        let _ = fs::remove_file(path);
        assert_eq!(text, "ok");
    }

    #[test]
    fn writes_utf8_without_bom() {
        let path = temp_path("writes_utf8_without_bom.txt");
        write_utf8_no_bom(&path, "舰船").unwrap();
        let bytes = fs::read(&path).unwrap();
        let _ = fs::remove_file(path);
        assert!(!bytes.starts_with(UTF8_BOM));
        assert_eq!(String::from_utf8(bytes).unwrap(), "舰船");
    }

    #[test]
    fn reads_cp1252_smart_single_quotes_as_ascii_apostrophes() {
        let path = temp_path("reads_cp1252_quote.txt");
        fs::write(&path, b"\x91it\x92s\x92").unwrap();

        let text = read_utf8_no_bom(&path).unwrap();

        let _ = fs::remove_file(path);
        assert_eq!(text, "'it's'");
    }

    #[test]
    fn reads_cp1252_smart_double_quotes_as_ascii_quotes() {
        let path = temp_path("reads_cp1252_double_quotes.txt");
        fs::write(&path, b"\x93quoted\x94").unwrap();

        let text = read_utf8_no_bom(&path).unwrap();

        let _ = fs::remove_file(path);
        assert_eq!(text, "\"quoted\"");
    }

    #[test]
    fn reads_cp1252_en_dash_as_ascii_hyphen() {
        let path = temp_path("reads_cp1252_en_dash.txt");
        fs::write(&path, b"left \x96 right").unwrap();

        let text = read_utf8_no_bom(&path).unwrap();

        let _ = fs::remove_file(path);
        assert_eq!(text, "left - right");
    }
}
