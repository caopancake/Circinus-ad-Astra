use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateModPayload {
    pub destination: NewModDestination,
    pub template: NewModTemplate,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum NewModDestination {
    GameMods {
        #[serde(rename = "starsectorRoot")]
        starsector_root: String,
    },
    Directory {
        #[serde(rename = "parentDirectory")]
        parent_directory: String,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewModTemplate {
    pub id: String,
    pub name: String,
    pub version: String,
    pub game_version: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedMod {
    pub mod_root: String,
    pub starsector_root: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_payload_roundtrips_with_camel_case_template() {
        let payload = CreateModPayload {
            destination: NewModDestination::GameMods {
                starsector_root: "D:/games/starsector".to_string(),
            },
            template: NewModTemplate {
                id: "my_mod".to_string(),
                name: "My Mod".to_string(),
                version: "1.0.0".to_string(),
                game_version: "0.97a".to_string(),
            },
        };
        let json = serde_json::to_value(&payload).expect("serializable");
        assert_eq!(json["destination"]["kind"], "game-mods");
        assert_eq!(json["destination"]["starsectorRoot"], "D:/games/starsector");
        assert_eq!(json["template"]["gameVersion"], "0.97a");

        let back: CreateModPayload = serde_json::from_value(json).expect("deserializable");
        assert_eq!(back.template.id, "my_mod");
    }

    #[test]
    fn directory_destination_uses_parent_directory_field() {
        let json = serde_json::json!({
            "kind": "directory",
            "parentDirectory": "C:/tmp"
        });
        let destination: NewModDestination = serde_json::from_value(json).expect("deserializable");
        match destination {
            NewModDestination::Directory { parent_directory } => {
                assert_eq!(parent_directory, "C:/tmp")
            }
            NewModDestination::GameMods { .. } => panic!("wrong destination kind"),
        }
    }

    #[test]
    fn created_mod_serializes_optional_root_explicitly() {
        let created = CreatedMod {
            mod_root: "C:/games/mods/x".to_string(),
            starsector_root: None,
        };
        let json = serde_json::to_value(&created).expect("serializable");
        assert_eq!(json["modRoot"], "C:/games/mods/x");
        assert!(json["starsectorRoot"].is_null());
    }
}
