//! Shared content-blocking core (platform-independent).
//! One Engine, three outputs:
//!   1. check_request()   -> network decisions (Windows/Android/Linux hooks)
//!   2. cosmetic_js()     -> per-page CSS hiding + scriptlets (all platforms)
//!   3. webkit_rules()    -> WKContentRuleList JSON (iOS/macOS, compiled by WebKit, zero JS overhead)
use adblock::{lists::{FilterSet, ParseOptions}, request::Request, Engine};
use parking_lot::RwLock;

pub struct Blocker { engine: RwLock<Engine>, pub allow_sites: RwLock<Vec<String>>,
    /// Generic `##selector` rules as one CSS block (one rule per selector, so one bad selector can't kill the rest).
    /// adblock-rust only returns generic class/id hides via a DOM scan, which tab webviews can't call back for.
    generic_css: RwLock<String>,
    pub counts: parking_lot::Mutex<std::collections::HashMap<String, u32>>,
    /// Blocked requests since the stats were last saved (all tabs, all platforms).
    pub total: std::sync::atomic::AtomicU64 }

impl Blocker {
    /// Build from raw list text (EasyList, EasyPrivacy, uBO...) + user's custom filters.
    pub fn from_lists(lists: &[String], custom: &[String]) -> Self {
        let mut fs = FilterSet::new(false);
        for l in lists { fs.add_filter_list(l, ParseOptions::default()); }
        fs.add_filters(custom, ParseOptions::default());
        Self { engine: RwLock::new(Engine::from_filter_set(fs, true)), allow_sites: Default::default(), counts: Default::default(),
               generic_css: RwLock::new(generic_css(lists, custom)), total: Default::default() }
    }

    /// Hot-swap engine after a user-triggered list update.
    pub fn reload(&self, lists: &[String], custom: &[String]) {
        let nb = Blocker::from_lists(lists, custom);
        *self.engine.write() = nb.engine.into_inner();
        *self.generic_css.write() = nb.generic_css.into_inner();
    }

    pub fn is_allowed_site(&self, host: &str) -> bool {
        self.allow_sites.read().iter().any(|s| host == s || host.ends_with(&format!(".{s}")))
    }

    /// request_type: "script" | "image" | "xmlhttprequest" | "sub_frame" | "document" | ...
    pub fn check_request(&self, url: &str, source: &str, request_type: &str) -> bool {
        let Ok(req) = Request::new(url, source, request_type) else { return false };
        if let Ok(u) = url::Url::parse(source) { if self.is_allowed_site(u.host_str().unwrap_or("")) { return false; } }
        let r = self.engine.read().check_network_request(&req);
        r.matched && r.exception.is_none()
    }

    /// JS to eval at page start: injects hiding CSS + scriptlets for this URL.
    pub fn cosmetic_js(&self, page_url: &str) -> String {
        let res = self.engine.read().url_cosmetic_resources(page_url);
        let mut css = String::new();
        if !res.generichide {
            for s in &res.hide_selectors { css.push_str(s); css.push(','); }
        }
        let mut rule = if res.generichide { String::new() } else { self.generic_css.read().clone() };
        for sel in css.split(',').filter(|s| is_plain(s)) { rule.push_str(sel); rule.push_str("{display:none!important}\n"); }
        format!(
            "(()=>{{try{{{scr}}}catch(e){{}}const s=document.createElement('style');s.textContent={rule};\
             (document.head||document.documentElement).appendChild(s);}})();",
            scr = res.injected_script, rule = serde_json::to_string(&rule).unwrap()
        )
    }

    /// For WKWebView: Safari-format content-blocker JSON. Feed to WKContentRuleListStore.
    /// (Rebuild from raw lists; the compiled Engine can't be converted back.)
    pub fn webkit_rules(lists: &[String], custom: &[String]) -> String {
        let mut fs = FilterSet::new(true);
        for l in lists { fs.add_filter_list(l, ParseOptions::default()); }
        fs.add_filters(custom, ParseOptions::default());
        match fs.into_content_blocking() {
            Ok((rules, _unused)) => serde_json::to_string(&rules).unwrap_or("[]".into()),
            Err(_) => "[]".into(),
        }
    }
}

impl Blocker {
    /// iOS/macOS: WKContentRuleList caps ~150k rules per list. Return shards <= 40k rules, each a
    /// standalone JSON list. Extras: block 3rd-party cookies, upgrade http->https.
    pub fn webkit_rule_shards(lists: &[String], custom: &[String]) -> Vec<String> {
        let all: serde_json::Value = serde_json::from_str(&Self::webkit_rules(lists, custom)).unwrap_or_default();
        let mut rules = all.as_array().cloned().unwrap_or_default();
        rules.push(serde_json::json!({"trigger":{"url-filter":".*","load-type":["third-party"]},"action":{"type":"block-cookies"}}));
        rules.push(serde_json::json!({"trigger":{"url-filter":"^http://.*"},"action":{"type":"make-https"}}));
        rules.chunks(40_000).map(|c| serde_json::to_string(c).unwrap()).collect()
    }
}

/// Collect plain generic hiding rules (`##sel`), minus generic exceptions (`#@#sel`).
/// Procedural/scriptlet rules are skipped (R-15/R-16 handle those).
const PROCEDURAL: &[&str] = &[":-abp-", ":has-text(", ":xpath(", ":upward(", ":style(", ":remove(", ":matches-", ":min-text-length(", ":watch-attr("];
/// A selector the browser can use as plain CSS (no scriptlets, no procedural operators).
fn is_plain(sel: &str) -> bool {
    !sel.is_empty() && !sel.starts_with("+js(") && !sel.contains(['{', '}', '<']) && !PROCEDURAL.iter().any(|p| sel.contains(p))
}
fn generic_css(lists: &[String], custom: &[String]) -> String {
    use std::collections::HashSet;
    let (mut hide, mut except) = (Vec::new(), HashSet::new());
    for line in lists.iter().flat_map(|l| l.lines()).chain(custom.iter().map(String::as_str)) {
        let line = line.trim();
        if let Some(sel) = line.strip_prefix("#@#") { except.insert(sel); }
        else if let Some(sel) = line.strip_prefix("##") {
            if is_plain(sel) { hide.push(sel); }
        }
    }
    let mut seen = HashSet::new();
    let mut css = String::with_capacity(hide.len() * 40);
    for sel in hide { if !except.contains(sel) && seen.insert(sel) { css.push_str(sel); css.push_str("{display:none!important}\n"); } }
    css
}

#[cfg(test)]
mod tests {
    use super::*;
    fn b() -> Blocker {
        Blocker::from_lists(&["||ads.example.com^\n@@||ads.example.com/ok.js^\n##.banner-ad\nexample.org##.sponsored".into()], &[])
    }
    #[test] fn blocks_listed_host() { assert!(b().check_request("https://ads.example.com/x.js", "https://site.com/", "script")); }
    #[test] fn honors_exception() { assert!(!b().check_request("https://ads.example.com/ok.js", "https://site.com/", "script")); }
    #[test] fn passes_clean_host() { assert!(!b().check_request("https://cdn.site.com/app.js", "https://site.com/", "script")); }
    #[test] fn per_site_allow_disables_blocking() {
        let bl = b(); bl.allow_sites.write().push("site.com".into());
        assert!(!bl.check_request("https://ads.example.com/x.js", "https://site.com/", "script"));
    }
    #[test] fn cosmetic_css_contains_selector() { assert!(b().cosmetic_js("https://example.org/").contains(".banner-ad")); }
    #[test] fn generic_exception_and_procedural_skipped() {
        let bl = Blocker::from_lists(&["##.a1\n##.a2\n#@#.a2\n##div:has-text(x)\n##+js(foo)".into()], &[]);
        let js = bl.cosmetic_js("https://x.com/");
        assert!(js.contains(".a1{"), "generic rule missing");
        assert!(!js.contains(".a2{"), "#@# exception ignored");
        assert!(!js.contains("has-text"), "procedural selector leaked into CSS");
        assert!(!js.contains("+js"), "scriptlet leaked into CSS");
    }
    #[test] fn webkit_shards_are_json_with_extras() {
        let s = Blocker::webkit_rule_shards(&["||ads.example.com^".into()], &[]);
        assert!(!s.is_empty() && s[0].contains("block-cookies") && s[0].contains("make-https"));
    }
}

impl Blocker {
    /// Increment and return the blocked-request count for a tab label (R-22).
    pub fn bump(&self, label: &str) -> u32 {
        self.total.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let mut m = self.counts.lock();
        let c = m.entry(label.to_string()).or_insert(0);
        *c += 1;
        *c
    }
}
