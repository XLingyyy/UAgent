//! The single native endpoint policy for settings and the actual transport preflight.
//! Parsing only: no DNS, HTTP, credentials or connectivity claims.
#![cfg(windows)]
use crate::product_settings_store::{
    EndpointDecision, NativeEndpointPolicy, Result, StoreError, WireApi,
};
use serde::{Deserialize, Serialize};

pub(crate) struct DesktopEndpointPolicy;
pub(crate) static NATIVE_ENDPOINT_POLICY: DesktopEndpointPolicy = DesktopEndpointPolicy;
const POLICY_REVISION: &str = "desktop-endpoint-policy-v2-official-responses";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct NativeEndpointDecision {
    pub canonical_base_url: String,
    pub policy_revision: String,
    pub transport_supported: bool,
}
impl From<EndpointDecision> for NativeEndpointDecision {
    fn from(value: EndpointDecision) -> Self {
        Self {
            canonical_base_url: value.canonical_base_url,
            policy_revision: value.policy_revision,
            transport_supported: value.transport_supported,
        }
    }
}
fn rejected() -> StoreError {
    StoreError { kind: "endpointPolicy".into(), message: "provider endpoint must be a strict HTTPS URL or a loopback HTTP URL without credentials, query or fragment".into() }
}
impl NativeEndpointPolicy for DesktopEndpointPolicy {
    fn validate_endpoint(&self, wire_api: WireApi, base_url: &str) -> Result<EndpointDecision> {
        if base_url.is_empty()
            || base_url.len() > 4096
            || base_url
                .chars()
                .any(|c| c.is_whitespace() || c.is_control())
            || base_url.contains(['\\', '?', '#'])
        {
            return Err(rejected());
        }
        let (_, rest) = base_url.split_once("://").ok_or_else(rejected)?;
        let authority = rest.split('/').next().ok_or_else(rejected)?;
        if authority.is_empty() || authority.contains(['@', '%']) {
            return Err(rejected());
        }
        // Reject spellings that URL parsing would silently collapse to a different
        // endpoint, including encoded dot segments and alternate IPv4 notations.
        for segment in rest.split('/').skip(1) {
            let dots = segment.to_ascii_lowercase().replace("%2e", ".");
            if dots == "." || dots == ".." {
                return Err(rejected());
            }
        }
        let url = tauri::Url::parse(base_url).map_err(|_| rejected())?;
        if !matches!(url.scheme(), "https" | "http")
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(rejected());
        }
        let host = url.host_str().ok_or_else(rejected)?;
        let address_host = host.trim_start_matches('[').trim_end_matches(']');
        let loopback = host == "localhost"
            || address_host
                .parse::<std::net::IpAddr>()
                .is_ok_and(|ip| ip.is_loopback());
        if url.scheme() == "http" && !loopback {
            return Err(rejected());
        }
        if let Ok(std::net::IpAddr::V4(ip)) = address_host.parse::<std::net::IpAddr>() {
            let raw_host = authority.split(':').next().unwrap_or("");
            if raw_host != ip.to_string() {
                return Err(rejected());
            }
        }
        let mut canonical_base_url = url.as_str().to_string();
        if url.path() == "/" {
            canonical_base_url.pop();
        }
        let transport_supported = (canonical_base_url == "https://api.deepseek.com"
            && matches!(
                wire_api,
                WireApi::ChatCompletions | WireApi::OpenaiCompatible
            ))
            || (canonical_base_url
                .strip_suffix('/')
                .unwrap_or(&canonical_base_url)
                == "https://api.openai.com/v1"
                && matches!(wire_api, WireApi::Responses));
        Ok(EndpointDecision {
            canonical_base_url,
            policy_revision: POLICY_REVISION.into(),
            transport_supported,
        })
    }
}

/// The official Responses HTTPS target. Configuration is not a connectivity observation.
pub(crate) fn prepare_responses_endpoint(base_url: &str) -> Result<String> {
    let checked = NATIVE_ENDPOINT_POLICY.validate_endpoint(WireApi::Responses, base_url)?;
    let root = checked
        .canonical_base_url
        .strip_suffix('/')
        .unwrap_or(&checked.canonical_base_url);
    if root != "https://api.openai.com/v1" {
        return Err(StoreError {
            kind: "endpointPolicy".into(),
            message:
                "native Responses supports only the official https://api.openai.com/v1 API root"
                    .into(),
        });
    }
    Ok(format!("{root}/responses"))
}

/// Saved credentials can target only the official DeepSeek Chat Completions endpoint.
pub(crate) fn prepare_deepseek_endpoint(base_url: &str) -> Result<String> {
    let checked = NATIVE_ENDPOINT_POLICY.validate_endpoint(WireApi::ChatCompletions, base_url)?;
    if checked.canonical_base_url != "https://api.deepseek.com" {
        return Err(StoreError {
            kind: "endpointPolicy".into(),
            message: "native DeepSeek supports only the official API root".into(),
        });
    }
    Ok("https://api.deepseek.com/chat/completions".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn responses_supports_only_the_explicit_official_v1_target() {
        for root in [
            "https://api.openai.com/v1",
            "https://api.openai.com/v1/",
            "https://API.OPENAI.COM:443/v1",
        ] {
            assert_eq!(
                prepare_responses_endpoint(root).unwrap(),
                "https://api.openai.com/v1/responses"
            );
            assert!(
                NATIVE_ENDPOINT_POLICY
                    .validate_endpoint(WireApi::Responses, root)
                    .unwrap()
                    .transport_supported
            );
        }
        assert!(
            NATIVE_ENDPOINT_POLICY
                .validate_endpoint(WireApi::ChatCompletions, "https://api.deepseek.com")
                .unwrap()
                .transport_supported
        );
    }
    #[test]
    fn responses_preparation_rejects_injected_or_ambiguous_targets() {
        for root in [
            "https://api.openai.com",
            "https://api.openai.com/v1/responses",
            "https://api.openai.com/v1//",
            "https://api.openai.com:444/v1",
            "https://api.openai.com/v1/../v1",
            "https://api.openai.com.evil.invalid/v1",
            "https://other.invalid/v1",
            "http://127.0.0.1:8000/v1",
            "https://user:pass@api.openai.com/v1",
            "https://api.openai.com/v1?api_key=synthetic",
            "https://api.openai.com/v1#fragment",
        ] {
            assert!(prepare_responses_endpoint(root).is_err(), "{root}");
        }
    }

    #[test]
    fn policy_rejects_dangerous_or_ambiguous_urls_without_network() {
        for url in [
            "",
            "https://",
            "ftp://example.invalid",
            "http://example.invalid",
            "file:///E:/x",
            "https://user:pass@example.invalid",
            "https://@example.invalid",
            "https://example.invalid?",
            "https://example.invalid/#",
            "https://example.invalid/with space",
            " https://api.deepseek.com",
            "https://example.invalid\\evil",
            "https://api%2edeepseek.com",
            "https:////api.deepseek.com",
            "https://api.deepseek.com/a/..",
            "https://api.deepseek.com/%2e",
            "https://api.deepseek.com/.%2e",
            "http://127.1",
            "http://2130706433",
            "http://0x7f000001",
            "http://localhost.evil.invalid",
            "http://[::]",
            "http://169.254.169.254",
            "https://example.invalid:invalid",
        ] {
            assert!(
                NATIVE_ENDPOINT_POLICY
                    .validate_endpoint(WireApi::OpenaiCompatible, url)
                    .is_err(),
                "{url}"
            );
        }
    }
    #[test]
    fn only_shipped_deepseek_root_and_chat_wires_support_transport() {
        for wire in [WireApi::ChatCompletions, WireApi::OpenaiCompatible] {
            for url in [
                "https://api.deepseek.com",
                "https://api.deepseek.com/",
                "https://API.DEEPSEEK.COM:443/",
            ] {
                let decision = NATIVE_ENDPOINT_POLICY.validate_endpoint(wire, url).unwrap();
                assert_eq!(decision.canonical_base_url, "https://api.deepseek.com");
                assert!(decision.transport_supported);
            }
        }
        for (wire, url) in [
            (WireApi::ChatCompletions, "https://api.openai.com/v1"),
            (WireApi::OpenaiCompatible, "https://api.openai.com/v1"),
            (WireApi::Responses, "https://other.invalid/v1"),
            (WireApi::Responses, "https://api.openai.com/v1//"),
            (WireApi::Responses, "https://api.deepseek.com"),
            (WireApi::Anthropic, "https://api.deepseek.com"),
            (WireApi::OpenaiCompatible, "https://api.deepseek.com/v1"),
            (WireApi::OpenaiCompatible, "https://api.deepseek.com:444"),
            (WireApi::OpenaiCompatible, "https://configured.invalid/v1"),
            (
                WireApi::OpenaiCompatible,
                "https://api.deepseek.com.evil.invalid",
            ),
            (WireApi::OpenaiCompatible, "http://localhost:11434/v1"),
            (WireApi::OpenaiCompatible, "http://127.0.0.1:11434/v1"),
            (WireApi::OpenaiCompatible, "http://[::1]:11434/v1"),
        ] {
            let decision = NATIVE_ENDPOINT_POLICY.validate_endpoint(wire, url).unwrap();
            assert!(!decision.transport_supported, "{url}");
            let repeated = NATIVE_ENDPOINT_POLICY
                .validate_endpoint(wire, &decision.canonical_base_url)
                .unwrap();
            assert_eq!(decision, repeated);
        }
    }
    #[test]
    fn endpoint_decision_is_descriptive_camel_case_and_rejects_extra_claims() {
        let value = NativeEndpointDecision::from(
            NATIVE_ENDPOINT_POLICY
                .validate_endpoint(WireApi::ChatCompletions, "https://api.deepseek.com")
                .unwrap(),
        );
        let mut json = serde_json::to_value(value).unwrap();
        assert_eq!(json["transportSupported"], true);
        assert!(json.get("connectionVerified").is_none());
        json["verified"] = true.into();
        assert!(serde_json::from_value::<NativeEndpointDecision>(json).is_err());
    }
}
