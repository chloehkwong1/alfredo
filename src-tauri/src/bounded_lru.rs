//! Small bespoke bounded LRU keyed by `K`. Used by `github_manager` to cap
//! the per-token `GithubManager` and `(repo → token)` caches so power users
//! with many accounts can't grow them without bound, and reused by other
//! cache sites (e.g. parent-head and fetch-throttle caches) for the same
//! reason.
//!
//! Why bespoke: cap is tiny (8 in practice), so the cost of true LRU here is
//! a handful of `VecDeque` ops per call. A "drop an arbitrary entry" scheme
//! is cheaper per op but causes eviction oscillation when the working set
//! crosses the cap; true LRU avoids that without pulling in a crate.
//!
//! Semantics:
//! - `insert(k, v)`: inserts (or overwrites). On overflow, evicts the
//!   least-recently-used key (front of the order queue).
//! - `get(&k)`: moves `k` to the back of the order queue (most recently used).
//! - `get_or_insert_with(k, f)`: convenience for the cache shape — touch on
//!   hit, build + insert on miss.

use std::borrow::Borrow;
use std::collections::{HashMap, VecDeque};
use std::hash::Hash;

/// Bounded LRU map. Capacity must be > 0.
#[derive(Debug)]
pub struct BoundedLru<K, V> {
    map: HashMap<K, V>,
    order: VecDeque<K>,
    cap: usize,
}

impl<K, V> BoundedLru<K, V>
where
    K: Eq + Hash + Clone,
{
    /// Construct a new bounded LRU with the given capacity.
    /// Capacity of 0 is silently bumped to 1 — a zero-cap cache is useless
    /// and the alternative is panicking on every insert.
    pub fn new(cap: usize) -> Self {
        let cap = cap.max(1);
        Self {
            map: HashMap::with_capacity(cap),
            order: VecDeque::with_capacity(cap),
            cap,
        }
    }

    /// Insert `(k, v)`. If `k` was already present, the existing value is
    /// replaced and the key is moved to the back (most recently used).
    /// If inserting a new key would exceed capacity, the front (least
    /// recently used) key is evicted first.
    pub fn insert(&mut self, k: K, v: V) -> Option<V> {
        if self.map.contains_key(&k) {
            // Refresh order to back, replace value in-place.
            self.touch(&k);
            return self.map.insert(k, v);
        }

        if self.map.len() >= self.cap {
            if let Some(evict) = self.order.pop_front() {
                self.map.remove(&evict);
            }
        }
        self.order.push_back(k.clone());
        self.map.insert(k, v)
    }

    /// Look up `k`. On hit, moves `k` to the back of the LRU order.
    pub fn get<Q>(&mut self, k: &Q) -> Option<&V>
    where
        K: Borrow<Q>,
        Q: Hash + Eq + ?Sized,
    {
        if self.map.contains_key(k) {
            self.touch(k);
            return self.map.get(k);
        }
        None
    }

    /// Get the value for `k`, or build + insert one via `f` on miss.
    /// Either way, `k` ends up at the back of the LRU order.
    ///
    /// `#[allow(dead_code)]` because this helper is intended for cache sites
    /// added in later sections (parent-head / fetch-throttle); keeping it
    /// here avoids churn there.
    #[allow(dead_code)]
    pub fn get_or_insert_with<F>(&mut self, k: &K, f: F) -> &mut V
    where
        F: FnOnce() -> V,
    {
        if !self.map.contains_key(k) {
            self.insert(k.clone(), f());
        } else {
            self.touch(k);
        }
        // Safe: we just ensured the key is present, and we hold `&mut self`
        // so no concurrent eviction can race us.
        #[allow(clippy::expect_used)]
        self.map.get_mut(k).expect("key present after insert_or_touch")
    }

    /// `#[allow(dead_code)]` because this is only used in tests inside other
    /// modules (e.g. `github_manager`); the `--lib` clippy gate doesn't see
    /// those uses.
    #[allow(dead_code)]
    pub fn contains_key<Q>(&self, k: &Q) -> bool
    where
        K: Borrow<Q>,
        Q: Hash + Eq + ?Sized,
    {
        self.map.contains_key(k)
    }

    pub fn remove<Q>(&mut self, k: &Q) -> Option<V>
    where
        K: Borrow<Q>,
        Q: Hash + Eq + ?Sized,
    {
        if let Some(pos) = self.order.iter().position(|x| x.borrow() == k) {
            self.order.remove(pos);
        }
        self.map.remove(k)
    }

    #[allow(dead_code)]
    pub fn len(&self) -> usize {
        self.map.len()
    }

    /// Iterate values in insertion/touch order (front = LRU, back = MRU).
    /// Used by `github_manager::invalidate_for_repo` to scan for shared
    /// tokens. Order is the LRU queue, not the underlying HashMap.
    pub fn values(&self) -> impl Iterator<Item = &V> {
        self.order
            .iter()
            .filter_map(|k| self.map.get(k))
    }

    fn touch<Q>(&mut self, k: &Q)
    where
        K: Borrow<Q>,
        Q: Hash + Eq + ?Sized,
    {
        if let Some(pos) = self.order.iter().position(|x| x.borrow() == k) {
            // Move to back. `remove` is O(n) but n <= cap (small, e.g. 8).
            if let Some(key) = self.order.remove(pos) {
                self.order.push_back(key);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insert_under_cap_keeps_all() {
        let mut lru: BoundedLru<&'static str, i32> = BoundedLru::new(4);
        lru.insert("a", 1);
        lru.insert("b", 2);
        lru.insert("c", 3);
        assert_eq!(lru.len(), 3);
        assert!(lru.contains_key(&"a"));
        assert!(lru.contains_key(&"b"));
        assert!(lru.contains_key(&"c"));
    }

    #[test]
    fn insert_over_cap_evicts_front() {
        let mut lru: BoundedLru<&'static str, i32> = BoundedLru::new(3);
        lru.insert("a", 1);
        lru.insert("b", 2);
        lru.insert("c", 3);
        lru.insert("d", 4); // evicts "a"
        assert_eq!(lru.len(), 3);
        assert!(!lru.contains_key(&"a"));
        assert!(lru.contains_key(&"b"));
        assert!(lru.contains_key(&"c"));
        assert!(lru.contains_key(&"d"));
    }

    #[test]
    fn get_touches_to_back() {
        let mut lru: BoundedLru<&'static str, i32> = BoundedLru::new(3);
        lru.insert("a", 1);
        lru.insert("b", 2);
        lru.insert("c", 3);
        // Touch "a" so it's now MRU; "b" becomes LRU.
        assert_eq!(lru.get(&"a"), Some(&1));
        lru.insert("d", 4); // should evict "b", not "a"
        assert!(lru.contains_key(&"a"));
        assert!(!lru.contains_key(&"b"));
        assert!(lru.contains_key(&"c"));
        assert!(lru.contains_key(&"d"));
    }

    #[test]
    fn insert_existing_key_replaces_and_touches() {
        let mut lru: BoundedLru<&'static str, i32> = BoundedLru::new(3);
        lru.insert("a", 1);
        lru.insert("b", 2);
        lru.insert("c", 3);
        lru.insert("a", 99); // replaces value, moves "a" to MRU
        assert_eq!(lru.get(&"a"), Some(&99));
        lru.insert("d", 4); // should evict "b", not "a"
        assert!(lru.contains_key(&"a"));
        assert!(!lru.contains_key(&"b"));
    }

    #[test]
    fn remove_drops_entry_and_order() {
        let mut lru: BoundedLru<&'static str, i32> = BoundedLru::new(3);
        lru.insert("a", 1);
        lru.insert("b", 2);
        assert_eq!(lru.remove(&"a"), Some(1));
        assert!(!lru.contains_key(&"a"));
        assert_eq!(lru.len(), 1);
        // Re-insert past the original slot — eviction order should still be correct.
        lru.insert("c", 3);
        lru.insert("d", 4);
        lru.insert("e", 5); // evicts LRU, which is now "b"
        assert!(!lru.contains_key(&"b"));
        assert!(lru.contains_key(&"c"));
        assert!(lru.contains_key(&"d"));
        assert!(lru.contains_key(&"e"));
    }

    #[test]
    fn get_or_insert_with_builds_once_and_touches() {
        let mut lru: BoundedLru<&'static str, i32> = BoundedLru::new(2);
        let mut calls = 0;
        {
            let v = lru.get_or_insert_with(&"a", || {
                calls += 1;
                7
            });
            assert_eq!(*v, 7);
        }
        // Second call should hit cache, not call f.
        {
            let v = lru.get_or_insert_with(&"a", || {
                calls += 1;
                99
            });
            assert_eq!(*v, 7);
        }
        assert_eq!(calls, 1);
    }

    #[test]
    fn zero_cap_is_promoted_to_one() {
        let mut lru: BoundedLru<&'static str, i32> = BoundedLru::new(0);
        lru.insert("a", 1);
        assert_eq!(lru.len(), 1);
        lru.insert("b", 2);
        assert_eq!(lru.len(), 1);
        assert!(!lru.contains_key(&"a"));
        assert!(lru.contains_key(&"b"));
    }

    #[test]
    fn values_iterates_in_lru_order() {
        let mut lru: BoundedLru<&'static str, i32> = BoundedLru::new(4);
        lru.insert("a", 1);
        lru.insert("b", 2);
        lru.insert("c", 3);
        let collected: Vec<i32> = lru.values().copied().collect();
        assert_eq!(collected, vec![1, 2, 3]);
        // Touch "a", now order should be b, c, a.
        let _ = lru.get(&"a");
        let collected: Vec<i32> = lru.values().copied().collect();
        assert_eq!(collected, vec![2, 3, 1]);
    }
}
