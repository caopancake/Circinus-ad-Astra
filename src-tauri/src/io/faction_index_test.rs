#![cfg(test)]
use crate::{
    io::{read_faction_index, write_utf8_no_bom},
    testutil::{temp_dir, temp_linked_dir},
};

#[test]
fn faction_index_rejects_parent_escape_before_loading_business_content() {
    let root = temp_dir("faction_index_escape");
    std::fs::create_dir_all(root.join("data/world/factions")).unwrap();
    write_utf8_no_bom(
        &root.join("data/world/factions/factions.csv"),
        "id,file\noutside,../outside.faction\n",
    )
    .unwrap();
    let error = read_faction_index(&root).unwrap_err();
    assert_eq!(error.code(), "path.invalid_relative");
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn faction_index_rejects_link_parent_at_the_authorized_root_boundary() {
    let Some((root, outside, _)) = temp_linked_dir("faction_index_link", "data/custom") else {
        println!("Faction link fixture unavailable on this host");
        return;
    };
    std::fs::create_dir_all(root.join("data/world/factions")).unwrap();
    write_utf8_no_bom(
        &root.join("data/world/factions/factions.csv"),
        "id,file\noutside,data/custom/outside.faction\n",
    )
    .unwrap();
    let error = read_faction_index(&root).unwrap_err();
    assert_eq!(error.code(), "path.link_rejected");
    println!("Faction linked parent rejected by the production root boundary");
    std::fs::remove_dir_all(root).unwrap();
    std::fs::remove_dir_all(outside).unwrap();
}

#[cfg(windows)]
#[test]
fn faction_index_rejects_junction_parent_at_the_authorized_root_boundary() {
    let (root, outside, link) =
        crate::testutil::temp_junction_dir("faction_index_junction", "data/custom");
    std::fs::create_dir_all(root.join("data/world/factions")).unwrap();
    write_utf8_no_bom(
        &root.join("data/world/factions/factions.csv"),
        "faction\ndata/custom/outside.faction\n",
    )
    .unwrap();
    write_utf8_no_bom(&outside.join("outside.faction"), "{id:'outside'}").unwrap();
    let error = read_faction_index(&root).unwrap_err();
    assert_eq!(error.code(), "path.link_rejected");
    assert!(outside.join("outside.faction").is_file());
    std::fs::remove_dir(link).unwrap();
    std::fs::remove_dir_all(root).unwrap();
    std::fs::remove_dir_all(outside).unwrap();
}
