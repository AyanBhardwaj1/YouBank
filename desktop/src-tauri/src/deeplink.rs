//! `youbank://` links: open a ticker, a deal or a Studio document in the app, from email, Slack or
//! notes. A link only ever becomes a path on the configured YouBank site, or a question for quick ask;
//! anything unrecognised opens the home page, so a crafted link cannot send the window elsewhere.
//!
//!   youbank://ticker/AAPL        the terminal on AAPL
//!   youbank://deal/42            the pipeline (deal 42)
//!   youbank://studio/17          Studio document 17
//!   youbank://edge, news, studio, crm, settings
//!   youbank://ask?q=Revenue%20of%20MSFT   quick ask, with the question filled in
//!   youbank://agent/files        the desktop agent's settings, on a section
//!   youbank://open?path=/app/news?view=deals   any page under /app

use url::Url;

#[derive(Debug, PartialEq, Eq)]
pub enum Link {
    /// A path on the site, starting with "/".
    Open(String),
    /// Open quick ask with this question typed in (not sent).
    Ask(String),
    /// Open the desktop agent's settings on a section.
    Agent(Option<String>),
}

fn ticker(s: &str) -> Option<String> {
    let t = s.trim().to_ascii_uppercase();
    (!t.is_empty() && t.len() <= 10 && t.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')).then_some(t)
}

fn id(s: &str) -> Option<u64> {
    s.trim().parse::<u64>().ok().filter(|n| *n > 0 && *n < 1_000_000_000_000)
}

/// A site path that stays inside the app's pages. Pure.
pub fn safe_app_path(p: &str) -> Option<String> {
    let p = p.trim();
    let ok = (p == "/app" || p.starts_with("/app/") || p.starts_with("/app?"))
        && !p.contains("//")
        && !p.contains('\\')
        && !p.contains("..")
        && p.len() <= 500
        && !p.chars().any(|c| c.is_control());
    ok.then(|| p.to_string())
}

/// What a `youbank://` link asks for. Pure.
pub fn parse(raw: &str) -> Option<Link> {
    let u = Url::parse(raw).ok()?;
    if u.scheme() != "youbank" {
        return None;
    }
    let host = u.host_str().unwrap_or("").to_ascii_lowercase();
    let rest: Vec<String> = u.path_segments().map(|s| s.filter(|x| !x.is_empty()).map(String::from).collect()).unwrap_or_default();
    let first = rest.first().map(String::as_str).unwrap_or("");
    let query = |k: &str| u.query_pairs().find(|(name, _)| name == k).map(|(_, v)| v.into_owned());
    let open = |p: &str| Some(Link::Open(p.to_string()));
    match host.as_str() {
        "ticker" | "company" => match ticker(first) {
            Some(t) => Some(Link::Open(format!("/app/terminal?ticker={t}"))),
            None => open("/app/terminal"),
        },
        "deal" => match id(first) {
            Some(n) => Some(Link::Open(format!("/app/crm?tab=pipeline&deal={n}"))),
            None => open("/app/crm?tab=pipeline"),
        },
        "studio" => match id(first) {
            Some(n) => Some(Link::Open(format!("/app/studio/{n}"))),
            None => open("/app/studio"),
        },
        "edge" => open("/app/edge"),
        "news" => open("/app/news"),
        "crm" => open("/app/crm"),
        "settings" => open("/app/settings"),
        "agent" => Some(Link::Agent(rest.first().filter(|s| ["account", "files", "office", "alerts", "tasks", "app"].contains(&s.as_str())).cloned())),
        "ask" => Some(Link::Ask(query("q").unwrap_or_default().chars().take(2000).collect())),
        "open" => Some(Link::Open(query("path").as_deref().and_then(safe_app_path).unwrap_or_else(|| "/app".into()))),
        _ => open("/app"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links() {
        assert_eq!(parse("youbank://ticker/aapl"), Some(Link::Open("/app/terminal?ticker=AAPL".into())));
        assert_eq!(parse("youbank://ticker/BRK.B"), Some(Link::Open("/app/terminal?ticker=BRK.B".into())));
        assert_eq!(parse("youbank://ticker/<script>"), Some(Link::Open("/app/terminal".into())));
        assert_eq!(parse("youbank://deal/42"), Some(Link::Open("/app/crm?tab=pipeline&deal=42".into())));
        assert_eq!(parse("youbank://studio/17"), Some(Link::Open("/app/studio/17".into())));
        assert_eq!(parse("youbank://studio/abc"), Some(Link::Open("/app/studio".into())));
        assert_eq!(parse("youbank://ask?q=Revenue%20of%20MSFT"), Some(Link::Ask("Revenue of MSFT".into())));
        assert_eq!(parse("youbank://open?path=/app/news?view=deals"), Some(Link::Open("/app/news?view=deals".into())));
        assert_eq!(parse("youbank://open?path=//evil.example"), Some(Link::Open("/app".into())));
        assert_eq!(parse("youbank://open?path=https://evil.example"), Some(Link::Open("/app".into())));
        assert_eq!(parse("youbank://agent/files"), Some(Link::Agent(Some("files".into()))));
        assert_eq!(parse("youbank://agent/../../x"), Some(Link::Agent(None)));
        assert_eq!(parse("youbank://whatever"), Some(Link::Open("/app".into())));
        assert_eq!(parse("https://youbank.app/ticker/AAPL"), None);
    }

    #[test]
    fn app_paths() {
        assert!(safe_app_path("/app/edge").is_some());
        assert!(safe_app_path("/app/../api/desktop/me").is_none());
        assert!(safe_app_path("/api/desktop/me").is_none());
        assert!(safe_app_path("/application").is_none());
    }
}
