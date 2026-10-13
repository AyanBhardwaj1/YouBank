//! Calls to YouBank's /api/desktop/** routes, as the connected person (the device token from the
//! keychain). Errors come back as plain sentences for the person: the server already words its own
//! (and hides anything internal behind a reference), and network trouble is said simply.

use reqwest::{header, Method, RequestBuilder, Response, StatusCode};
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::fmt;
use std::time::Duration;
use url::Url;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone)]
pub enum ApiError {
    /// No token, or the server no longer accepts it (disconnected from Settings, say).
    SignedOut,
    /// The site could not be reached.
    Offline,
    /// Too many requests; try again after this many seconds.
    Limited(u64, String),
    /// Needs a paid plan (402), with the server's sentence.
    Plan(String),
    /// Studio moved on since the local file was pulled (409), with the newest change's id when known.
    Conflict(String, Option<i64>),
    /// Anything else the server said, with its status.
    Server(u16, String),
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ApiError::SignedOut => write!(f, "This computer is not connected to YouBank. Choose Connect to connect it."),
            ApiError::Offline => write!(f, "YouBank could not be reached. Check your connection; the app will try again."),
            ApiError::Limited(_, m) | ApiError::Plan(m) | ApiError::Conflict(m, _) | ApiError::Server(_, m) => write!(f, "{m}"),
        }
    }
}

impl From<ApiError> for String {
    fn from(e: ApiError) -> Self {
        e.to_string()
    }
}

#[derive(Clone)]
pub struct Api {
    pub http: reqwest::Client,
    pub base: Url,
    pub token: Option<String>,
}

pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(format!("YouBank-Desktop/{VERSION} ({})", std::env::consts::OS))
        .connect_timeout(Duration::from_secs(10))
        .gzip(true)
        .build()
        .expect("http client")
}

impl Api {
    pub fn url(&self, path: &str) -> Url {
        self.base.join(path.trim_start_matches('/')).unwrap_or_else(|_| self.base.clone())
    }

    /// A request with the device token and the app's version (the server records it on the device).
    pub fn request(&self, method: Method, path: &str) -> Result<RequestBuilder, ApiError> {
        let mut r = self.http.request(method, self.url(path)).header("x-youbank-desktop", VERSION).timeout(Duration::from_secs(60));
        if let Some(t) = &self.token {
            r = r.header(header::AUTHORIZATION, format!("Bearer {t}"));
        }
        Ok(r)
    }

    pub fn authed(&self, method: Method, path: &str) -> Result<RequestBuilder, ApiError> {
        if self.token.is_none() {
            return Err(ApiError::SignedOut);
        }
        self.request(method, path)
    }

    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T, ApiError> {
        json(send(self.authed(Method::GET, path)?).await?).await
    }

    pub async fn post<B: Serialize + ?Sized, T: DeserializeOwned>(&self, path: &str, body: &B) -> Result<T, ApiError> {
        json(send(self.authed(Method::POST, path)?.json(body)).await?).await
    }

    pub async fn put<B: Serialize + ?Sized, T: DeserializeOwned>(&self, path: &str, body: &B) -> Result<T, ApiError> {
        json(send(self.authed(Method::PUT, path)?.json(body)).await?).await
    }

    pub async fn delete<T: DeserializeOwned>(&self, path: &str) -> Result<T, ApiError> {
        json(send(self.authed(Method::DELETE, path)?).await?).await
    }

    /// Calls anyone may make (pairing), without the token.
    pub async fn post_open<B: Serialize + ?Sized, T: DeserializeOwned>(&self, path: &str, body: &B) -> Result<T, ApiError> {
        json(send(self.request(Method::POST, path)?.json(body)).await?).await
    }

    /// Whether the site answers at all, for the offline screen: its robots.txt, the cheapest page it serves.
    /// Any answer counts; a site that answers with an error shows its own error page, which says more.
    pub async fn reachable(&self) -> bool {
        self.http.get(self.url("/robots.txt")).timeout(Duration::from_secs(8)).send().await.is_ok()
    }
}

/// Send, and turn any failure into an ApiError the person can read.
pub async fn send(r: RequestBuilder) -> Result<Response, ApiError> {
    let res = r.send().await.map_err(|e| {
        log::info!("request failed: {e}");
        ApiError::Offline
    })?;
    let status = res.status();
    if status.is_success() {
        return Ok(res);
    }
    let retry = res.headers().get(header::RETRY_AFTER).and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<u64>().ok()).unwrap_or(300);
    let body: serde_json::Value = res.json().await.unwrap_or(serde_json::Value::Null);
    let message = body.get("error").and_then(|v| v.as_str()).map(str::to_string).unwrap_or_else(|| generic(status));
    Err(match status.as_u16() {
        401 => ApiError::SignedOut,
        402 => ApiError::Plan(message),
        409 => ApiError::Conflict(message, body.get("cursor").and_then(|v| v.as_i64())),
        429 => ApiError::Limited(retry, message),
        s => ApiError::Server(s, message),
    })
}

async fn json<T: DeserializeOwned>(res: Response) -> Result<T, ApiError> {
    res.json::<T>().await.map_err(|e| {
        log::warn!("unexpected answer: {e}");
        ApiError::Server(502, "YouBank sent an answer this version of the app does not understand. Check for updates.".into())
    })
}

fn generic(s: StatusCode) -> String {
    if s.is_server_error() {
        "Something went wrong on YouBank's side. Try again in a moment.".into()
    } else {
        "That did not work. Try again, or check for an update to the app.".into()
    }
}
