use keyring::v1::{Entry, Error};

const ACCOUNT_NAME: &str = "api-key";

fn service_name(provider: &str) -> Result<&'static str, String> {
    match provider {
        // Keep the DeepSeek identifier stable so credentials created by earlier versions
        // remain readable after upgrading to multi-provider support.
        "deepseek" => Ok("com.openscreentranslate.deepseek"),
        "openai" => Ok("com.openscreentranslate.openai"),
        "anthropic" => Ok("com.openscreentranslate.anthropic"),
        "gemini" => Ok("com.openscreentranslate.google-gemini"),
        "compatible" => Ok("com.openscreentranslate.openai-compatible"),
        _ => Err("不支持所选的 AI 供应商".to_string()),
    }
}

fn api_key_entry(provider: &str) -> Result<Entry, String> {
    Entry::new(service_name(provider)?, ACCOUNT_NAME)
        .map_err(|error| format!("无法连接系统凭据库：{error}"))
}

fn normalized_api_key(api_key: &str) -> Result<&str, String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        Err("API Key 不能为空".to_string())
    } else {
        Ok(api_key)
    }
}

pub fn save_api_key(provider: &str, api_key: &str) -> Result<(), String> {
    api_key_entry(provider)?
        .set_password(normalized_api_key(api_key)?)
        .map_err(|error| format!("无法将 API Key 保存到系统凭据库：{error}"))
}

pub fn read_api_key(provider: &str) -> Result<Option<String>, String> {
    match api_key_entry(provider)?.get_password() {
        Ok(api_key) => match normalized_api_key(&api_key) {
            Ok(api_key) => Ok(Some(api_key.to_string())),
            Err(_) => Ok(None),
        },
        Err(Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("无法从系统凭据库读取 API Key：{error}")),
    }
}

pub fn delete_api_key(provider: &str) -> Result<(), String> {
    match api_key_entry(provider)?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("无法从系统凭据库移除 API Key：{error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::{normalized_api_key, service_name};

    #[test]
    fn trims_api_keys() {
        assert_eq!(
            normalized_api_key("  test-api-key  ").expect("API Key should be accepted"),
            "test-api-key"
        );
    }

    #[test]
    fn rejects_empty_api_keys() {
        assert_eq!(
            normalized_api_key("   ").expect_err("empty API Key should fail"),
            "API Key 不能为空"
        );
    }

    #[test]
    fn uses_separate_services_for_each_provider() {
        assert_eq!(
            service_name("deepseek").expect("DeepSeek should be supported"),
            "com.openscreentranslate.deepseek"
        );
        assert_ne!(
            service_name("openai").expect("OpenAI should be supported"),
            service_name("anthropic").expect("Anthropic should be supported")
        );
        assert_eq!(
            service_name("compatible").expect("compatible services should be supported"),
            "com.openscreentranslate.openai-compatible"
        );
        assert!(service_name("unknown").is_err());
    }
}
