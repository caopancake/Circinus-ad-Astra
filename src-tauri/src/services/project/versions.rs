use super::model::ProjectSession;
use crate::{
    errors::AppResult,
    io::{FsRootBoundary, file_version},
    models::FileVersion,
};
use std::{collections::BTreeMap, path::Path};

pub(super) fn capture_versions(root: &Path) -> AppResult<BTreeMap<String, FileVersion>> {
    let mut versions = BTreeMap::new();
    for (_, path) in super::cache::persistent::session_source_files(root)? {
        let relative = crate::io::forward_slash_path(
            path.strip_prefix(root)
                .expect("session source belongs to root"),
        );
        versions.insert(relative, file_version(&path)?);
    }
    let missions = root.join("data/missions");
    if missions.is_dir() {
        for entry in std::fs::read_dir(missions)? {
            let path = entry?.path();
            crate::io::validate_walk_entry(&path, "mission version")?;
            if path.is_dir() {
                let relative = crate::io::forward_slash_path(
                    path.strip_prefix(root).expect("mission belongs to root"),
                );
                versions.insert(relative, file_version(&path)?);
            }
        }
    }
    Ok(versions)
}

pub(super) fn version_for_path(session: &ProjectSession, path: &str) -> FileVersion {
    session
        .source_versions
        .get(path)
        .cloned()
        .unwrap_or_else(|| FileVersion {
            path: Path::new(&session.manifest.mod_root)
                .join(path)
                .to_string_lossy()
                .to_string(),
            fingerprint: None,
        })
}

pub(super) fn refresh_versions(
    session: &mut ProjectSession,
    changes: &[crate::models::FileChangeRecord],
) -> AppResult<()> {
    let boundary = FsRootBoundary::new(Path::new(&session.manifest.mod_root), "version root")?;
    for change in changes {
        for path in [&change.before_path, &change.after_path] {
            if let Some(relative) =
                boundary.resolve_changed_path_to_relative(path, "changed version")?
            {
                session.source_versions.insert(
                    relative.clone(),
                    file_version(&boundary.root().join(&relative))?,
                );
                if let Some(mission) = relative
                    .strip_prefix("data/missions/")
                    .and_then(|suffix| suffix.split('/').next())
                    .filter(|name| *name != "mission_list.csv")
                {
                    let dir = format!("data/missions/{mission}");
                    session
                        .source_versions
                        .insert(dir.clone(), file_version(&boundary.root().join(dir))?);
                }
            }
        }
    }
    session.manifest.base_versions = vec![version_for_path(session, "mod_info.json")];
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::models::EntityKind;
    #[test]
    fn session_versions_cover_mission_directory_and_skin_resource_override() {
        let root = crate::testutil::temp_dir("versioned_mission_skin");
        std::fs::create_dir_all(root.join("data/hulls/skins")).unwrap();
        std::fs::write(
            root.join("data/hulls/base.ship"),
            r#"{"hullId":"base","spriteName":"graphics/base.png"}"#,
        )
        .unwrap();
        std::fs::write(
            root.join("data/hulls/skins/skin.skin"),
            r#"{"skinHullId":"skin","baseHullId":"base","spriteName":"graphics/skin.png"}"#,
        )
        .unwrap();
        std::fs::create_dir_all(root.join("data/missions/demo")).unwrap();
        std::fs::write(
            root.join("data/missions/mission_list.csv"),
            "mission\ndemo\n",
        )
        .unwrap();
        std::fs::write(
            root.join("data/missions/demo/descriptor.json"),
            "{\"title\":\"demo\"}",
        )
        .unwrap();
        let mut trace = super::super::PerformanceTrace::new("project.openSession");
        let manifest = super::super::open_project_session_traced(&root, None, &mut trace).unwrap();
        let skin = super::super::query_entity(&manifest.session_id, EntityKind::Skin, "skin")
            .unwrap()
            .unwrap();
        assert_eq!(skin.resource_refs["sprite"].rel_path, "graphics/skin.png");
        assert_eq!(skin.base_versions.len(), 1);
        assert!(skin.base_versions[0].fingerprint.is_some());
        let mission = super::super::query_entity_edit_target(
            &manifest.session_id,
            EntityKind::Mission,
            "demo",
        )
        .unwrap()
        .base_versions;
        assert_eq!(mission.len(), 2);
        assert!(mission.iter().all(|version| version.fingerprint.is_some()));
        crate::io::verify_versions(&manifest.mod_root, &mission).unwrap();
        std::fs::write(root.join("data/missions/demo/new.txt"), "external").unwrap();
        assert!(crate::io::verify_versions(&manifest.mod_root, &mission).is_err());
        super::super::close_project_session(manifest.session_id).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
}
