/// The shared CP1252 smart-punctuation mapping. Reading normalizes these
/// bytes silently, and the normalization is written back to disk on save —
/// it is a recovery feature for broken legacy files, not a lossless decode.
/// Lives in models because both io and parsers depend on this mapping.
pub(crate) fn known_cp1252_char(byte: u8) -> Option<char> {
    match byte {
        0x91 | 0x92 => Some('\''),
        0x93 | 0x94 => Some('"'),
        0x96 => Some('-'),
        _ => None,
    }
}

pub(crate) fn decode_starsector_text(bytes: &[u8]) -> Result<String, usize> {
    if let Ok(text) = std::str::from_utf8(bytes) {
        return Ok(text.to_string());
    }
    let mut text = String::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        if byte.is_ascii() {
            text.push(char::from(byte));
            index += 1;
            continue;
        }
        let width = match byte {
            0xC2..=0xDF => 2,
            0xE0..=0xEF => 3,
            0xF0..=0xF4 => 4,
            _ => 1,
        };
        if width > 1
            && let Some(sequence) = bytes.get(index..index + width)
            && let Ok(valid) = std::str::from_utf8(sequence)
        {
            text.push_str(valid);
            index += width;
            continue;
        }
        let character = known_cp1252_char(byte).ok_or(index)?;
        text.push(character);
        index += 1;
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mixed_utf8_and_recoverable_punctuation_preserve_valid_scalars() {
        let bytes = ["铜".as_bytes(), b"\x96\x91x\x92"].concat();
        assert_eq!(decode_starsector_text(&bytes).unwrap(), "铜-'x'");
        assert_eq!(decode_starsector_text("铜".as_bytes()).unwrap(), "铜");
    }

    #[test]
    fn unsupported_bytes_report_the_original_offset() {
        assert_eq!(decode_starsector_text(b"text\xff"), Err(4));
    }
}
