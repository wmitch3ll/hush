import Tauri
import WebKit
import UIKit

/// One WKWebView per tab. Blocking = precompiled WKContentRuleLists (no per-request hook exists on iOS).
class TabsPlugin: Plugin, WKUIDelegate, WKNavigationDelegate {
    private var tabs: [String: WKWebView] = [:]
    private var active: String?
    private var topInset: CGFloat = 0
    private var lists: [WKContentRuleList] = []
    private let persistent = WKWebsiteDataStore.default()
    private let ephemeral = WKWebsiteDataStore.nonPersistent()   // private mode: zero residue

    /// Rust pushes shards (see Blocker::webkit_rule_shards). Compile once; cache by WebKit store.
    @objc func shards(_ invoke: Invoke) throws {
        struct A: Decodable { let shards: [String] }
        let json = try invoke.parseArgs(A.self).shards
        let group = DispatchGroup()
        for (i, s) in json.enumerated() {
            group.enter()
            WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "hush\(i)", encodedContentRuleList: s) { l, _ in
                if let l = l { self.lists.append(l) }; group.leave()
            }
        }
        group.notify(queue: .main) { invoke.resolve() }
    }

    @objc func openTab(_ invoke: Invoke) throws {
        struct A: Decodable { let url: String; let isPrivate: Bool? }
        let a = try invoke.parseArgs(A.self)
        DispatchQueue.main.async {
            let cfg = WKWebViewConfiguration()
            cfg.websiteDataStore = (a.isPrivate ?? false) ? self.ephemeral : self.persistent
            cfg.upgradeKnownHostsToHTTPS = true
            self.lists.forEach { cfg.userContentController.add($0) }
            let wv = WKWebView(frame: .zero, configuration: cfg)
            wv.uiDelegate = self; wv.navigationDelegate = self
            wv.allowsBackForwardNavigationGestures = true      // edge-swipe back, native feel
            wv.scrollView.contentInsetAdjustmentBehavior = .automatic   // safe area / Dynamic Island
            wv.isInspectable = false
            let id = UUID().uuidString; self.tabs[id] = wv
            self.show(id)
            if let u = URL(string: a.url) { wv.load(URLRequest(url: u)) }
            invoke.resolve(["id": id])
        }
    }
    private func show(_ id: String) {
        tabs[active ?? ""]?.removeFromSuperview()          // only ONE web view in the hierarchy
        guard let host = self.manager.viewController?.view, let wv = tabs[id] else { return }   // unknown id = just hide
        wv.frame = host.bounds.inset(by: UIEdgeInsets(top: topInset, left: 0, bottom: 0, right: 0))  // below the chrome bar
        wv.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        host.addSubview(wv); active = id
    }
    @objc func switchTab(_ invoke: Invoke) throws {
        struct A: Decodable { let id: String }; let a = try invoke.parseArgs(A.self)
        DispatchQueue.main.async { self.show(a.id); invoke.resolve() }
    }
    @objc func closeTab(_ invoke: Invoke) throws {
        struct A: Decodable { let id: String }; let a = try invoke.parseArgs(A.self)
        DispatchQueue.main.async { self.tabs.removeValue(forKey: a.id)?.removeFromSuperview(); invoke.resolve() }
    }

    @objc func setTopInset(_ invoke: Invoke) throws {
        struct A: Decodable { let px: CGFloat }; let a = try invoke.parseArgs(A.self)
        DispatchQueue.main.async {
            self.topInset = a.px
            if let id = self.active { self.show(id) }
            invoke.resolve()
        }
    }
    @objc func navigate(_ invoke: Invoke) throws {
        struct A: Decodable { let url: String }; let a = try invoke.parseArgs(A.self)
        DispatchQueue.main.async { if let u = URL(string: a.url) { self.tabs[self.active ?? ""]?.load(URLRequest(url: u)) }; invoke.resolve() }
    }
    @objc func nav(_ invoke: Invoke) throws {
        struct A: Decodable { let action: String }; let a = try invoke.parseArgs(A.self)
        DispatchQueue.main.async {
            let w = self.tabs[self.active ?? ""]
            switch a.action { case "back": w?.goBack(); case "fwd": w?.goForward(); default: w?.reload() }
            invoke.resolve()
        }
    }
    @objc func clearData(_ invoke: Invoke) throws {
        WKWebsiteDataStore.default().removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) { invoke.resolve() }
    }

    // Popups: deny every window.open / target=_blank. Real taps may load in-place (optional).
    func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration,
                 for n: WKNavigationAction, windowFeatures f: WKWindowFeatures) -> WKWebView? {
        return nil
    }
    // Cosmetic/scriptlets: iOS can't pre-inject per-URL, so inject at commit (tiny flash possible).
    func webView(_ w: WKWebView, didCommit n: WKNavigation!) {
        guard let url = w.url?.absoluteString else { return }
        // Cosmetic JS comes straight from the Rust engine over the C ABI (ios_ffi.rs).
        let js: String? = url.withCString { c in
            guard let p = hush_cosmetic_js(c) else { return nil }
            defer { hush_free(p) }
            return String(cString: p)
        }
        if let js = js, !js.isEmpty { w.evaluateJavaScript(js, completionHandler: nil) }
    }
}
@_silgen_name("hush_cosmetic_js") private func hush_cosmetic_js(_ url: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>?
@_silgen_name("hush_free") private func hush_free(_ p: UnsafeMutablePointer<CChar>?)
@_cdecl("init_plugin_hush_tabs") func initPlugin() -> Plugin { TabsPlugin() }
