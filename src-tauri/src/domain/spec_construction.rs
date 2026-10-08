use crate::{
    errors::{AppError, AppResult},
    models::{AssociatedSpecCreateParams, WeaponSpecClass},
};
use serde_json::Value;
use std::{path::Path, sync::LazyLock};

static SPEC_DEFAULTS: LazyLock<Value> = LazyLock::new(|| {
    let defaults: Value = serde_json::from_str(include_str!("../../../schemas/spec-defaults.json"))
        .expect("embedded spec defaults must parse");
    assert_eq!(
        defaults["$schema"], "circinus-ad-astra/spec-defaults/v1",
        "embedded spec defaults must declare the formal format"
    );
    defaults
});

pub fn create_associated_spec(params: &AssociatedSpecCreateParams) -> Value {
    let (template, id_field) = match params {
        AssociatedSpecCreateParams::Ship { .. } => (&SPEC_DEFAULTS["ship"], "hullId"),
        AssociatedSpecCreateParams::Weapon { spec_class, .. } => (
            &SPEC_DEFAULTS["weapon"][match spec_class {
                WeaponSpecClass::Projectile => "projectile",
                WeaponSpecClass::Beam => "beam",
            }],
            "id",
        ),
        AssociatedSpecCreateParams::System { .. } => (&SPEC_DEFAULTS["system"], "id"),
        AssociatedSpecCreateParams::Skill { .. } => (&SPEC_DEFAULTS["skill"], "id"),
    };
    let mut content = template.clone();
    let fields = content
        .as_object_mut()
        .expect("embedded spec template must be an object");
    fields.insert(id_field.to_string(), Value::String(params.id().to_string()));
    if let AssociatedSpecCreateParams::Ship { hull_name, .. } = params {
        fields.insert("hullName".to_string(), Value::String(hull_name.clone()));
    }
    content
}

/// Pulse weapons are unsupported by the vanilla game; structured writes allow projectile and beam.
pub fn validate_weapon_spec_class(content: &Value, path: &Path) -> AppResult<()> {
    if matches!(
        content.get("specClass").and_then(Value::as_str),
        Some("projectile" | "beam")
    ) {
        return Ok(());
    }
    Err(AppError::message(
        "spec.weapon_class_unsupported",
        format!(
            "{}: specClass must be projectile or beam; pulse is unsupported by the vanilla game",
            path.display()
        ),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn associated_creation_uses_shared_typed_templates_and_explicit_parameters() {
        let ship = create_associated_spec(&AssociatedSpecCreateParams::Ship {
            id: "ship".into(),
            hull_name: "Ship".into(),
        });
        assert_eq!(ship["hullId"], "ship");
        assert_eq!(ship["hullName"], "Ship");
        assert!(ship["width"].is_number());
        assert!(ship["weaponSlots"].is_array());
        assert!(ship["builtInWeapons"].is_object());
        let weapon = create_associated_spec(&AssociatedSpecCreateParams::Weapon {
            id: "beam".into(),
            spec_class: WeaponSpecClass::Beam,
        });
        assert_eq!(weapon["specClass"], "beam");
        assert_eq!(weapon["textureType"], "SMOOTH");
        assert_eq!(weapon["turretOffsets"], json!([10, 0]));
        let projectile = create_associated_spec(&AssociatedSpecCreateParams::Weapon {
            id: "gun".into(),
            spec_class: WeaponSpecClass::Projectile,
        });
        assert_eq!(projectile["barrelMode"], "ALTERNATING");
        assert_eq!(projectile["projectileSpecId"], "");
        let system = create_associated_spec(&AssociatedSpecCreateParams::System {
            id: "system".into(),
        });
        assert_eq!(system["aiType"], "NONE");
        let skill =
            create_associated_spec(&AssociatedSpecCreateParams::Skill { id: "skill".into() });
        assert_eq!(skill["effectGroups"], json!([]));
        assert!(skill["governingAptitude"].is_string());
        assert!(SPEC_DEFAULTS["projectile"]["projectile"]["fadeTime"].is_number());
        assert_eq!(
            SPEC_DEFAULTS["projectile"]["missile"]["engineSpec"],
            json!({"turnAcc":0,"turnRate":0,"acc":0,"dec":0})
        );
    }

    #[test]
    fn template_instances_keep_independent_nested_values() {
        let seed = AssociatedSpecCreateParams::Ship {
            id: "s".into(),
            hull_name: "Ship".into(),
        };
        let mut first = create_associated_spec(&seed);
        first["builtInWeapons"]["_slot"] = json!("w");
        assert_eq!(create_associated_spec(&seed)["builtInWeapons"], json!({}));
    }

    #[test]
    fn structured_weapon_type_error_has_stable_code_and_field_location() {
        let path = Path::new("data/weapons/demo.wpn");
        for spec_class in ["projectile", "beam"] {
            validate_weapon_spec_class(&json!({"specClass":spec_class}), path).unwrap();
        }
        let error = validate_weapon_spec_class(&json!({"specClass":"pulse"}), path).unwrap_err();
        assert_eq!(error.code(), "spec.weapon_class_unsupported");
        assert!(error.to_string().contains("specClass"));
        assert!(error.to_string().contains("demo.wpn"));
    }
}
