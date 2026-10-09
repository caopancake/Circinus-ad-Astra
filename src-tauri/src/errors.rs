use serde::{Serialize, Serializer};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonRewriteFile {
    pub path: String,
    pub reason: String,
    pub source_fingerprint: String,
}

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{message}")]
    Message { code: &'static str, message: String },
    #[error("{context}: {source}")]
    Context {
        context: String,
        source: Box<AppError>,
    },
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Csv(#[from] csv::Error),
    #[error("{0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Base64(#[from] base64::DecodeError),
    #[error("{0}")]
    Tauri(#[from] tauri::Error),
    #[error("JSON 格式保留需要确认")]
    JsonRewriteRequired { files: Vec<JsonRewriteFile> },
}

impl AppError {
    /// `code` is the stable wire identifier the frontend maps to user-facing
    /// copy; `message` is diagnostics-only context and never user-facing.
    pub fn message(code: &'static str, message: impl Into<String>) -> Self {
        Self::Message {
            code,
            message: message.into(),
        }
    }

    pub fn context(context: impl Into<String>, source: AppError) -> Self {
        Self::Context {
            context: context.into(),
            source: Box::new(source),
        }
    }

    pub fn code(&self) -> &'static str {
        match self {
            Self::Message { code, .. } => code,
            Self::Context { source, .. } => source.code(),
            Self::Io(_) => "io.unexpected",
            Self::Csv(_) => "parse.csv",
            Self::Json(_) => "parse.json",
            Self::Base64(_) => "data.base64",
            Self::Tauri(_) => "window.native",
            Self::JsonRewriteRequired { .. } => "json.rewrite_confirmation_required",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("AppError", 3)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        if let Self::JsonRewriteRequired { files } = self {
            state.serialize_field("files", files)?;
        }
        state.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io;

    #[test]
    fn message_error_keeps_its_stable_code() {
        let error = AppError::message("config.id_invalid", "bad id");
        assert_eq!(error.code(), "config.id_invalid");
        assert_eq!(error.to_string(), "bad id");
    }

    #[test]
    fn context_errors_surface_the_source_code_through_layers() {
        let source = AppError::message("parse.csv", "row broken");
        let outer = AppError::context("保存失败", AppError::context("写盘失败", source));
        assert_eq!(outer.code(), "parse.csv");
        assert_eq!(outer.to_string(), "保存失败: 写盘失败: row broken");
    }

    #[test]
    fn foreign_errors_map_to_fixed_fallback_codes() {
        let io_error = AppError::from(io::Error::new(io::ErrorKind::NotFound, "gone"));
        assert_eq!(io_error.code(), "io.unexpected");

        let csv_error = AppError::from(csv::Error::from(io::Error::new(
            io::ErrorKind::InvalidData,
            "bad",
        )));
        assert_eq!(csv_error.code(), "parse.csv");

        let json_error =
            AppError::from(serde_json::from_slice::<serde_json::Value>(b"{").unwrap_err());
        assert_eq!(json_error.code(), "parse.json");
    }

    #[test]
    fn serializes_into_the_wire_code_message_shape() {
        let error = AppError::context("outer", AppError::message("spec.missing", "inner detail"));
        let value = serde_json::to_value(&error).expect("serializable");
        assert_eq!(value["code"], "spec.missing");
        assert_eq!(value["message"], "outer: inner detail");
    }
}
