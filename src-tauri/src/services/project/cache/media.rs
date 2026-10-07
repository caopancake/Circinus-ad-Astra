use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};
use std::time::SystemTime;

const SPRITE_MEDIA_CACHE_CAPACITY: usize = 512;
const SPRITE_MEDIA_CACHE_BYTES: usize = 64 * 1024 * 1024;
#[cfg(test)]
pub(in crate::services::project) const SPRITE_MEDIA_CACHE_CAPACITY_FOR_TEST: usize =
    SPRITE_MEDIA_CACHE_CAPACITY;

struct CachedSpriteMedia {
    resolved_path: PathBuf,
    modified: SystemTime,
    length: u64,
    data_url: String,
}

struct SpriteMediaCacheState {
    entries: HashMap<(String, String), CachedSpriteMedia>,
    order: VecDeque<(String, String)>,
    bytes: usize,
}

impl SpriteMediaCacheState {
    fn touch(&mut self, key: &(String, String)) {
        self.order.retain(|entry| entry != key);
        self.order.push_back(key.clone());
    }

    fn remove(&mut self, key: &(String, String)) {
        if let Some(entry) = self.entries.remove(key) {
            self.bytes -= entry.data_url.len();
        }
        self.order.retain(|entry| entry != key);
    }

    fn insert(&mut self, key: (String, String), entry: CachedSpriteMedia) {
        self.remove(&key);
        self.bytes += entry.data_url.len();
        self.entries.insert(key.clone(), entry);
        self.touch(&key);
        while self.entries.len() > SPRITE_MEDIA_CACHE_CAPACITY
            || self.bytes > SPRITE_MEDIA_CACHE_BYTES
        {
            let Some(oldest) = self.order.front().cloned() else {
                break;
            };
            self.remove(&oldest);
        }
    }
}

fn sprite_media_cache() -> &'static Mutex<SpriteMediaCacheState> {
    static CACHE: LazyLock<Mutex<SpriteMediaCacheState>> = LazyLock::new(|| {
        Mutex::new(SpriteMediaCacheState {
            entries: HashMap::new(),
            order: VecDeque::new(),
            bytes: 0,
        })
    });
    &CACHE
}

/// Returns the cached data URL only while the underlying file is unchanged;
/// any stat or modification mismatch is a miss so edits show up immediately.
pub(in crate::services::project) fn lookup_data_url(
    session_id: &str,
    cache_key: &str,
) -> Option<String> {
    let mut cache = match sprite_media_cache().lock() {
        Ok(cache) => cache,
        Err(_) => {
            crate::diagnostics::record("sprite media cache lock poisoned");
            return None;
        }
    };
    let key = (session_id.to_string(), cache_key.to_string());
    let entry = cache.entries.get(&key)?;
    let current = std::fs::metadata(&entry.resolved_path)
        .ok()
        .is_some_and(|metadata| {
            metadata.modified().ok() == Some(entry.modified) && metadata.len() == entry.length
        });
    if !current {
        cache.remove(&key);
        return None;
    }
    let data_url = entry.data_url.clone();
    cache.touch(&key);
    Some(data_url)
}

pub(in crate::services::project) fn insert_entry(
    session_id: &str,
    cache_key: &str,
    resolved_path: PathBuf,
    modified: SystemTime,
    length: u64,
    data_url: String,
) {
    let Ok(mut cache) = sprite_media_cache().lock() else {
        crate::diagnostics::record("sprite media cache lock poisoned");
        return;
    };
    let media_key = (session_id.to_string(), cache_key.to_string());
    cache.insert(
        media_key,
        CachedSpriteMedia {
            resolved_path,
            modified,
            length,
            data_url,
        },
    );
}

pub(in crate::services::project) fn clear_sprite_media_for_session(session_id: &str) {
    let Ok(mut cache) = sprite_media_cache().lock() else {
        crate::diagnostics::record("sprite media cache lock poisoned");
        return;
    };
    let keys = cache
        .entries
        .keys()
        .filter(|key| key.0 == session_id)
        .cloned()
        .collect::<Vec<_>>();
    for key in keys {
        cache.remove(&key);
    }
}

#[cfg(test)]
pub(in crate::services::project) fn cached_sprite_media_contains(
    session_id: &str,
    cache_key: &str,
) -> bool {
    let Ok(cache) = sprite_media_cache().lock() else {
        crate::diagnostics::record("sprite media cache lock poisoned");
        return false;
    };
    cache
        .entries
        .contains_key(&(session_id.to_string(), cache_key.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> SpriteMediaCacheState {
        SpriteMediaCacheState {
            entries: HashMap::new(),
            order: VecDeque::new(),
            bytes: 0,
        }
    }

    fn entry(bytes: usize) -> CachedSpriteMedia {
        CachedSpriteMedia {
            resolved_path: PathBuf::new(),
            modified: SystemTime::UNIX_EPOCH,
            length: bytes as u64,
            data_url: "a".repeat(bytes),
        }
    }

    fn key(index: usize) -> (String, String) {
        ("session".to_string(), index.to_string())
    }

    #[test]
    fn media_cache_access_and_replacement_update_lru_order() {
        let mut cache = state();
        for index in 0..SPRITE_MEDIA_CACHE_CAPACITY {
            cache.insert(key(index), entry(1));
        }
        cache.touch(&key(0));
        cache.insert(key(SPRITE_MEDIA_CACHE_CAPACITY), entry(1));
        assert!(cache.entries.contains_key(&key(0)));
        assert!(!cache.entries.contains_key(&key(1)));
        cache.insert(key(2), entry(2));
        assert_eq!(cache.order.back(), Some(&key(2)));
        assert_eq!(cache.bytes, SPRITE_MEDIA_CACHE_CAPACITY + 1);
    }

    #[test]
    fn media_cache_enforces_byte_budget_and_releases_removals() {
        let mut cache = state();
        cache.insert(key(0), entry(SPRITE_MEDIA_CACHE_BYTES / 2));
        cache.insert(key(1), entry(SPRITE_MEDIA_CACHE_BYTES / 2));
        cache.touch(&key(0));
        cache.insert(key(2), entry(1));
        assert!(cache.entries.contains_key(&key(0)));
        assert!(!cache.entries.contains_key(&key(1)));
        assert_eq!(cache.bytes, SPRITE_MEDIA_CACHE_BYTES / 2 + 1);
        cache.remove(&key(0));
        assert_eq!(cache.bytes, 1);
        cache.insert(key(3), entry(SPRITE_MEDIA_CACHE_BYTES + 1));
        assert!(cache.entries.is_empty());
        assert_eq!(cache.bytes, 0);
    }
}
