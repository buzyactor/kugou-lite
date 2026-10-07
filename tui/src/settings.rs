use serde_json::{Value, json};
use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::OnceLock,
};
pub const QUALITIES: &[&str] = &["flac", "320", "128", "high", "viper_clear", "viper_atmos"];
pub fn quality_label(value: &str) -> &str {
    match value {
        "flac" => "FLAC 无损",
        "320" => "MP3 320 kbps",
        "128" => "MP3 128 kbps",
        "high" => "Hi-Res 高解析无损",
        "viper_clear" => "蝰蛇超清",
        "viper_atmos" => "蝰蛇全景声",
        other => other,
    }
}
#[derive(Clone)]
pub struct Settings {
    pub kotonoha_enabled: bool,
    pub kotonoha_endpoint: String,
    pub kotonoha_clock_ms: u64,
    pub rich_search: bool,
    pub clear_queues_on_exit: bool,
    pub auto_skip_errors: bool,
    pub in_app_notifications: bool,
    pub desktop_notifications: bool,
    pub track_notifications: bool,
    pub notification_timeout: u64,
    pub status_rows: u8,
    pub status_items: Vec<String>,
    pub scale_lyrics: bool,
    pub large_lyric: bool,
    pub lyric_align: u8,
    pub theme: usize,
    pub sidebar: bool,
    pub translation: bool,
    pub hd: bool,
    pub volume: u8,
    pub quality: String,
    pub mode: String,
    pub mouse: bool,
    pub large_icons: bool,
    pub cava_style: u8,
    pub lyric_return: u64,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            kotonoha_enabled: false,
            kotonoha_endpoint: "ws://127.0.0.1:28745/kotonoha/adapter".into(),
            kotonoha_clock_ms: 1000,
            rich_search: true,
            clear_queues_on_exit: false,
            auto_skip_errors: true,
            in_app_notifications: true,
            desktop_notifications: true,
            track_notifications: true,
            notification_timeout: 5,
            status_rows: 2,
            status_items: STATUS_ITEMS.iter().map(|(id, _)| id.to_string()).collect(),
            scale_lyrics: true,
            large_lyric: true,
            lyric_align: 1,
            theme: 0,
            sidebar: true,
            translation: true,
            hd: true,
            volume: 70,
            quality: "flac".into(),
            mode: "sequence".into(),
            mouse: true,
            large_icons: true,
            cava_style: 0,
            lyric_return: 6,
        }
    }
}
impl Settings {
    pub fn file() -> PathBuf {
        CONFIG
            .get()
            .cloned()
            .unwrap_or_else(|| directory().join("config.json"))
    }
    fn legacy_file() -> PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join(".local/ui.json")
    }
    pub fn load() -> io::Result<Self> {
        let path = Self::file();
        let source = if path.exists() {
            path.clone()
        } else {
            Self::legacy_file()
        };
        let mut settings = match fs::read_to_string(&source) {
            Ok(text) => Self::parse(&text)?,
            Err(e) if e.kind() == io::ErrorKind::NotFound => Self::default(),
            Err(e) => return Err(e),
        };
        settings.theme = crate::theme::selected();
        if !path.exists() {
            settings.save()?;
        }
        Ok(settings)
    }
    pub fn parse(text: &str) -> io::Result<Self> {
        let v: Value = serde_json::from_str(text).map_err(invalid)?;
        if !v.is_object() {
            return Err(invalid("配置必须是 JSON 对象"));
        }
        for key in [
            "kotonoha_enabled",
            "rich_search",
            "clear_queues_on_exit",
            "auto_skip_errors",
            "in_app_notifications",
            "desktop_notifications",
            "track_notifications",
            "scale_lyrics",
            "large_lyric",
            "mouse",
            "large_icons",
            "sidebar",
            "translation",
            "hd",
        ] {
            if v.get(key).is_some_and(|v| !v.is_boolean()) {
                return Err(invalid(format!("{key} 必须是布尔值")));
            }
        }
        for (key, min, max) in [
            ("kotonoha_clock_ms", 250, 10000),
            ("notification_timeout", 1, 30),
            ("status_rows", 1, 3),
            ("lyric_align", 0, 2),
            ("cava_style", 0, 3),
            ("volume", 0, 100),
            ("lyric_return", 3, 15),
        ] {
            if v.get(key)
                .is_some_and(|v| !v.as_u64().is_some_and(|n| n >= min && n <= max))
            {
                return Err(invalid(format!("{key} 超出范围 {min}..{max}")));
            }
        }
        for (key, choices) in [
            ("quality", QUALITIES),
            ("mode", &["sequence", "loop", "shuffle", "single"][..]),
        ] {
            if v.get(key)
                .is_some_and(|v| !v.as_str().is_some_and(|s| choices.contains(&s)))
            {
                return Err(invalid(format!("无效的 {key}")));
            }
        }
        if let Some(items) = v.get("status_items") {
            let items = items
                .as_array()
                .ok_or_else(|| invalid("status_items 必须是数组"))?;
            let mut seen = std::collections::HashSet::new();
            for item in items {
                let id = item
                    .as_str()
                    .filter(|id| STATUS_ITEMS.iter().any(|(key, _)| key == id))
                    .ok_or_else(|| invalid("未知的状态栏板块"))?;
                if !seen.insert(id) {
                    return Err(invalid("状态栏板块不可重复"));
                }
            }
        }
        if let Some(endpoint) = v.get("kotonoha_endpoint") {
            if !endpoint.as_str().is_some_and(valid_kotonoha_endpoint) {
                return Err(invalid(
                    "kotonoha_endpoint 必须是无凭据的本机 adapter WebSocket 地址",
                ));
            }
        }
        Ok(Self {
            kotonoha_enabled: v["kotonoha_enabled"].as_bool().unwrap_or(false),
            kotonoha_endpoint: v["kotonoha_endpoint"]
                .as_str()
                .unwrap_or("ws://127.0.0.1:28745/kotonoha/adapter")
                .into(),
            kotonoha_clock_ms: v["kotonoha_clock_ms"].as_u64().unwrap_or(1000),
            rich_search: v["rich_search"].as_bool().unwrap_or(true),
            clear_queues_on_exit: v["clear_queues_on_exit"].as_bool().unwrap_or(false),
            auto_skip_errors: v["auto_skip_errors"].as_bool().unwrap_or(true),
            in_app_notifications: v["in_app_notifications"].as_bool().unwrap_or(true),
            desktop_notifications: v["desktop_notifications"].as_bool().unwrap_or(true),
            track_notifications: v["track_notifications"].as_bool().unwrap_or(true),
            notification_timeout: v["notification_timeout"].as_u64().unwrap_or(5),
            status_rows: v["status_rows"].as_u64().unwrap_or(2) as u8,
            status_items: v["status_items"]
                .as_array()
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|s| s.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_else(|| Self::default().status_items),
            scale_lyrics: v["scale_lyrics"].as_bool().unwrap_or(true),
            large_lyric: v["large_lyric"].as_bool().unwrap_or(true),
            lyric_align: v["lyric_align"].as_u64().unwrap_or(1).min(2) as u8,
            theme: v["theme"]
                .as_str()
                .and_then(|id| crate::theme::palettes().iter().position(|p| p.id == id))
                .unwrap_or(0),
            mouse: v["mouse"].as_bool().unwrap_or(true),
            large_icons: v["large_icons"].as_bool().unwrap_or(true),
            cava_style: v["cava_style"].as_u64().unwrap_or(0).min(3) as u8,
            lyric_return: v["lyric_return"].as_u64().unwrap_or(6).clamp(3, 15),
            sidebar: v["sidebar"].as_bool().unwrap_or(true),
            translation: v["translation"].as_bool().unwrap_or(true),
            hd: v["hd"].as_bool().unwrap_or(true),
            volume: v["volume"].as_u64().unwrap_or(70).min(100) as u8,
            quality: v["quality"]
                .as_str()
                .filter(|s| QUALITIES.contains(s))
                .unwrap_or("flac")
                .into(),
            mode: v["mode"]
                .as_str()
                .filter(|s| ["sequence", "loop", "shuffle", "single"].contains(s))
                .unwrap_or("sequence")
                .into(),
        })
    }
    pub fn kotonoha_json(&self) -> Value {
        json!({"enabled":self.kotonoha_enabled,"endpoint":self.kotonoha_endpoint,"clockMs":self.kotonoha_clock_ms})
    }
    pub fn save(&self) -> io::Result<()> {
        atomic_write(&Self::file(), &self.json())?;
        crate::theme::save(self.theme)
    }
    pub fn json(&self) -> Value {
        json!({"kotonoha_enabled":self.kotonoha_enabled,"kotonoha_endpoint":self.kotonoha_endpoint,"kotonoha_clock_ms":self.kotonoha_clock_ms,"rich_search":self.rich_search,"clear_queues_on_exit":self.clear_queues_on_exit,"auto_skip_errors":self.auto_skip_errors,"in_app_notifications":self.in_app_notifications,"desktop_notifications":self.desktop_notifications,"track_notifications":self.track_notifications,"notification_timeout":self.notification_timeout,"schema_version":1,"status_rows":self.status_rows,"status_items":self.status_items,"scale_lyrics":self.scale_lyrics,"large_lyric":self.large_lyric,"lyric_align":self.lyric_align,"sidebar":self.sidebar,"translation":self.translation,"hd":self.hd,"volume":self.volume,"quality":self.quality,"mode":self.mode,"mouse":self.mouse,"large_icons":self.large_icons,"cava_style":self.cava_style,"lyric_return":self.lyric_return})
    }
}
fn valid_kotonoha_endpoint(endpoint: &str) -> bool {
    let Some(rest) = endpoint
        .strip_prefix("ws://")
        .or_else(|| endpoint.strip_prefix("wss://"))
    else {
        return false;
    };
    let Some((authority, path)) = rest.split_once('/') else {
        return false;
    };
    if endpoint.len() > 2048 || path != "kotonoha/adapter" {
        return false;
    }
    for host in ["127.0.0.1", "localhost", "[::1]"] {
        if authority == host {
            return true;
        }
        if let Some(port) = authority
            .strip_prefix(host)
            .and_then(|s| s.strip_prefix(':'))
        {
            if !port.is_empty()
                && port.bytes().all(|b| b.is_ascii_digit())
                && port.parse::<u16>().is_ok_and(|n| n > 0)
            {
                return true;
            }
        }
    }
    false
}
pub const STATUS_ITEMS: [(&str, &str); 9] = [
    ("controls", "播放按钮"),
    ("song", "歌曲与歌手"),
    ("quality", "音质与采样参数"),
    ("bitrate", "实时码率"),
    ("volume", "应用音量"),
    ("mode", "播放顺序"),
    ("queue", "播放队列"),
    ("time", "进度时间"),
    ("lyrics", "当前歌词与译文"),
];
static CONFIG: OnceLock<PathBuf> = OnceLock::new();
pub fn directory() -> PathBuf {
    std::env::var_os("XDG_CONFIG_HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("HOME").unwrap_or_else(|| ".".into())).join(".config")
        })
        .join("kugou-lite")
}
pub fn invalid(e: impl std::fmt::Display) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, e.to_string())
}
pub fn atomic_write(path: &Path, v: &Value) -> io::Result<()> {
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        fs::create_dir_all(parent)?;
    }
    let temp = path.with_extension(format!("{}.tmp", std::process::id()));
    fs::write(
        &temp,
        format!("{}\n", serde_json::to_string_pretty(v).map_err(invalid)?),
    )?;
    fs::rename(temp, path)
}
/// Process file operations before starting the interface or account worker.
pub fn cli() -> io::Result<bool> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut operations = Vec::new();
    let mut i = 0;
    while i < args.len() {
        let flag = args[i].as_str();
        if ["--help", "-h"].contains(&flag) {
            println!(
                "Kugou Lite\n--config PATH             指定配置文件\n--import-config PATH      导入配置并退出\n--export-config PATH      导出配置并退出\n--import-theme PATH       导入并启用主题后退出\n--export-theme PATH       导出当前主题并退出\n默认目录：{}",
                directory().display()
            );
            return Ok(true);
        }
        if ![
            "--config",
            "--import-config",
            "--export-config",
            "--import-theme",
            "--export-theme",
        ]
        .contains(&flag)
        {
            return Err(invalid(format!("未知参数：{flag}")));
        }
        let path = args
            .get(i + 1)
            .ok_or_else(|| invalid(format!("{flag} 缺少文件路径")))?;
        if flag == "--config" {
            CONFIG
                .set(PathBuf::from(path))
                .map_err(|_| invalid("--config 只能指定一次"))?;
        } else {
            operations.push((flag.to_string(), PathBuf::from(path)));
        }
        i += 2;
    }
    crate::theme::initialize()?;
    for (flag, path) in &operations {
        match flag.as_str() {
            "--import-config" => {
                let s = Settings::parse(&fs::read_to_string(path)?)?;
                atomic_write(&Settings::file(), &s.json())?;
            }
            "--export-config" => atomic_write(path, &Settings::load()?.json())?,
            "--import-theme" => crate::theme::import(path)?,
            "--export-theme" => {
                let p = crate::theme::parse(&fs::read_to_string(directory().join("theme.json"))?)?;
                atomic_write(path, &crate::theme::serialize(p))?;
            }
            _ => unreachable!(),
        }
        println!("{flag}: {}", path.display());
    }
    Ok(!operations.is_empty())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn config_roundtrip_and_validation() {
        let s = Settings::default();
        assert!(Settings::parse("{}").unwrap().auto_skip_errors);
        assert!(
            !Settings::parse(r#"{"auto_skip_errors":false}"#)
                .unwrap()
                .auto_skip_errors
        );
        assert_eq!(
            Settings::parse(&s.json().to_string()).unwrap().json(),
            s.json()
        );
        for text in [
            "[]",
            r#"{"kotonoha_enabled":"yes"}"#,
            r#"{"kotonoha_clock_ms":249}"#,
            r#"{"kotonoha_clock_ms":10001}"#,
            r#"{"kotonoha_endpoint":"ws://127.0.0.1:28745/kotonoha/adapter?token=private"}"#,
            r#"{"kotonoha_endpoint":"ws://user:secret@127.0.0.1:28745/kotonoha/adapter"}"#,
            r#"{"kotonoha_endpoint":"ws://example.com/kotonoha/adapter"}"#,
            r#"{"notification_timeout":0}"#,
            r#"{"notification_timeout":31}"#,
            r#"{"desktop_notifications":"yes"}"#,
            r#"{"volume":101}"#,
            r#"{"mouse":"yes"}"#,
            r#"{"scale_lyrics":"yes"}"#,
            r#"{"lyric_align":3}"#,
            r#"{"quality":"aac"}"#,
            r#"{"clear_queues_on_exit":"yes"}"#,
            r#"{"auto_skip_errors":1}"#,
        ] {
            assert!(Settings::parse(text).is_err(), "{text}");
        }
        for quality in QUALITIES {
            let configured = Settings::parse(&json!({"quality":quality}).to_string()).unwrap();
            assert_eq!(configured.quality, *quality);
            assert_eq!(
                Settings::parse(&configured.json().to_string())
                    .unwrap()
                    .quality,
                *quality
            );
        }
        assert!(s.json().get("theme").is_none());
        let configured=Settings::parse(r#"{"kotonoha_enabled":true,"kotonoha_endpoint":"ws://[::1]:28746/kotonoha/adapter","kotonoha_clock_ms":750}"#).unwrap();
        assert_eq!(
            Settings::parse(&configured.json().to_string())
                .unwrap()
                .kotonoha_json(),
            configured.kotonoha_json()
        );
    }
}
