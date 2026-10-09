mod detection;
mod overview;

pub use detection::detect_directory;
pub use overview::{infer_starsector_root, resolve_game_mods_directory, scan_game_overview};
