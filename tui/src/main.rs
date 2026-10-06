mod catalog_ui;
mod collections;
mod controls;
mod home_art;
mod kitty;
mod lyrics;
mod notifications;
mod quality_menu;
mod search_ui;
mod settings;
mod sort_menu;
mod theme;
mod theme_picker;
mod visualizer;
use crossterm::event::{
    self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, KeyEvent, KeyEventKind,
    KeyModifiers, MouseButton, MouseEventKind,
};
use qrcode::{Color as QrColor, QrCode};
use ratatui::{
    layout::{Constraint, Layout},
    style::{Color, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, List, ListItem, ListState, Paragraph, Wrap},
};
use serde_json::Value;
use std::{
    io::{self, BufRead, Write},
    process::{Child, Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

fn qr_lines(url: &str) -> Result<Vec<String>, String> {
    let code = QrCode::new(url.as_bytes()).map_err(|_| "二维码生成失败")?;
    let width = code.width() + 8; // four-module quiet zone on all sides
    let dark = |x: usize, y: usize| {
        x >= 4 && y >= 4 && x < width - 4 && y < width - 4 && code[(x - 4, y - 4)] == QrColor::Dark
    };
    Ok((0..width)
        .step_by(2)
        .map(|y| {
            (0..width)
                .map(|x| match (dark(x, y), dark(x, y + 1)) {
                    (true, true) => '█',
                    (true, false) => '▀',
                    (false, true) => '▄',
                    _ => ' ',
                })
                .collect()
        })
        .collect())
}
fn vip_text(value: &Value) -> String {
    match value.as_array() {
        Some(items) if items.is_empty() => "没有会员记录".into(),
        Some(items) => items
            .iter()
            .map(|item| {
                format!(
                    "业务 {}，{}，到期时间 {}",
                    item["type"].as_str().unwrap_or("未知"),
                    match item["active"].as_bool() {
                        Some(true) => "会员有效",
                        Some(false) => "会员未生效",
                        None => "会员状态未知",
                    },
                    item["expires"].as_str().unwrap_or("未知")
                )
            })
            .collect::<Vec<_>>()
            .join("；"),
        None => "尚未查询".into(),
    }
}
struct Worker(Child);
impl Drop for Worker {
    fn drop(&mut self) {
        drop(self.0.stdin.take());
        for _ in 0..300 {
            if matches!(self.0.try_wait(), Ok(Some(_))) {
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
// Present each Kitty frame atomically, including the external icon/cover layers.
struct SyncUpdate(bool);
impl SyncUpdate {
    fn begin() -> io::Result<Self> {
        let enabled = kitty::supported();
        if enabled {
            crossterm::execute!(io::stdout(), crossterm::terminal::BeginSynchronizedUpdate)?;
        }
        Ok(Self(enabled))
    }
}
impl Drop for SyncUpdate {
    fn drop(&mut self) {
        if self.0 {
            let _ = crossterm::execute!(io::stdout(), crossterm::terminal::EndSynchronizedUpdate);
        }
    }
}
struct MouseGuard;
impl Drop for MouseGuard {
    fn drop(&mut self) {
        let _ = crossterm::execute!(io::stdout(), DisableMouseCapture);
    }
}
fn main() -> io::Result<()> {
    if settings::cli()? {
        return Ok(());
    }
    let _mouse_guard = MouseGuard;
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap();
    let mut worker = Worker(
        Command::new("node")
            .arg(root.join("tools/tui-worker.mjs"))
            .current_dir(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?,
    );
    let output = worker.0.stdout.take().unwrap();
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        for line in io::BufReader::new(output).lines().map_while(Result::ok) {
            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                if tx.send(value).is_err() {
                    return;
                }
            }
        }
        let _ = tx.send(
            serde_json::json!({"kind":"error", "message":"接口进程已退出，请检查 Node >=22.18"}),
        );
    });
    let mut terminal = ratatui::init();
    let result = run(&mut terminal, &mut worker, rx);
    ratatui::restore();
    result
}
fn run(
    terminal: &mut ratatui::DefaultTerminal,
    worker: &mut Worker,
    rx: mpsc::Receiver<Value>,
) -> io::Result<()> {
    let mut qr: Vec<String> = vec![];
    let mut message = "按 L 扫码登录，已有登录状态可按 V 查询权益".to_string();
    let mut details = "概念 VIP 验证：登录后按 V 查询，按 C 进行一次听歌活动领取。\n领取取决于活动资格，并非每天登录就必定赠送。".to_string();
    let mut busy = false;
    let mut tracks: Vec<Value> = Vec::new();
    let mut selection = ListState::default();
    let mut editing = false;
    let mut query = String::new();
    let mut search_mood = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as usize
        % search_ui::MOODS.len();
    let mut hot_searches: Vec<String> = vec![];
    let mut hot_unavailable = false;
    let mut suggestions: Vec<String> = vec![];
    let mut suggestion_selected: Option<usize> = None;
    let mut suggestion_sent = String::new();
    let mut suggestion_unavailable = false;
    let mut query_changed = Instant::now();
    let mut search_origin: Option<(bool, bool, bool)> = None;
    let mut search_results = false;
    let mut catalog_mode = String::new();
    let mut thumbnail_key = 0u64;
    let mut catalog_type = "song".to_string();
    let mut artist_tab = "heat".to_string();
    let mut artist_info = Value::Null;
    let mut catalog_key = String::new();
    let mut profile_tab = 1usize;
    let mut profile_scroll = 0u16;
    let mut view = "tracks".to_string();
    let mut can_sort = false;
    let mut sort_mode = String::from("default");
    let mut sort_label = String::from("默认顺序");
    let mut sort_picker: Option<sort_menu::Picker> = None;
    let mut account_label = "未登录".to_string();
    let mut playback_state = "Stopped".to_string();
    let mut section = String::new();
    let mut browse_kind = String::new();
    let mut section_root = false;
    let mut collection_info = Value::Null;
    let mut collection_key = String::new();
    let mut page_title = "歌曲".to_string();
    let mut page_loaded = false;
    let mut page_description = String::new();
    let mut page = 1_u64;
    let mut media = serde_json::json!({});
    let mut media_shown = false;
    let mut seconds = 0.0;
    let mut settings = settings::Settings::load()?;
    settings.theme = theme::selected();
    if settings.mouse {
        crossterm::execute!(io::stdout(), EnableMouseCapture)?;
    }
    let mut settings_shown = false;
    let mut settings_selection = 0_usize;
    let mut settings_scroll = 0_usize;
    let mut theme_picker: Option<theme_picker::Picker> = None;
    let mut quality_picker: Option<quality_menu::Picker> = None;
    let mut settings_category = 0_usize;
    let mut live_bitrate: Option<f64> = None;
    let mut help_scroll = 0_u16;
    let mut text_icons = kitty::TextIcons::default();
    let mut lyric_text = kitty::LyricsText::default();
    let mut lyric_scroll = lyrics::ScrollState::default();
    let mut drag: Option<f64> = None;
    let mut lyric_first: Option<usize> = None;
    let mut lyric_touched = Instant::now();
    let mut home = true;
    let mut needs_login = false;
    let mut login_origin: Option<(bool, bool, bool, bool, bool, bool)> = None;
    let mut delete_account: Option<(String, String)> = None;
    let mut quality = "等待音频检测".to_string();
    let mut capacity = 0_u16;
    let mut desired_capacity = 1_u16;
    let mut spectrum = serde_json::json!({});
    let mut spectrum_animation = visualizer::Animation::default();
    let mut spectrum_clock = Instant::now();
    let mut desktop_status = String::new();
    let mut notifications = notifications::Center::new();
    let mut kitty_cover = kitty::Cover::default();
    let mut kitty_home = kitty::Cover::with_id(47202);
    let mut kitty_thumbnails: Vec<kitty::Cover> = Vec::new();
    let mut previous_frame_area = None;
    let mut cover_redraw_at: Option<Instant> = None;
    writeln!(
        worker.0.stdin.as_mut().unwrap(),
        "volume:{}",
        settings.volume
    )?;
    writeln!(
        worker.0.stdin.as_mut().unwrap(),
        "preferences:{}:{}",
        settings.quality,
        settings.mode
    )?;
    writeln!(
        worker.0.stdin.as_mut().unwrap(),
        "queuepolicy:{}",
        u8::from(settings.clear_queues_on_exit)
    )?;
    writeln!(
        worker.0.stdin.as_mut().unwrap(),
        "kotonoha:{}",
        settings.kotonoha_json()
    )?;
    writeln!(worker.0.stdin.as_mut().unwrap(), "restore")?;
    loop {
        if editing
            && settings.rich_search
            && !query.trim().is_empty()
            && query != suggestion_sent
            && query_changed.elapsed() >= Duration::from_millis(180)
        {
            writeln!(
                worker.0.stdin.as_mut().unwrap(),
                "suggestions:{}",
                query.trim()
            )?;
            suggestion_sent = query.clone();
        }
        if cover_redraw_at.is_some_and(|deadline| Instant::now() >= deadline) {
            kitty_cover.invalidate()?;
            kitty_home.invalidate()?;
            for thumbnail in &mut kitty_thumbnails {
                thumbnail.invalidate()?;
            }
            cover_redraw_at = None;
        }
        theme::set(settings.theme);
        theme::set_section(if editing {
            "search"
        } else if settings_shown {
            "settings"
        } else if home {
            "home"
        } else if media_shown {
            "playing"
        } else if !section.is_empty() {
            &section
        } else if search_results && matches!(view.as_str(), "tracks" | "catalog") {
            "search"
        } else {
            &view
        });
        let frame_started = Instant::now();
        notifications.poll(&settings);
        while let Ok(value) = rx.try_recv() {
            notifications.event(&value, &settings);
            match value["kind"].as_str().unwrap_or("") {
                "spectrum" => {
                    spectrum_animation.set(&value);
                    spectrum = value.clone();
                }
                "desktop" => desktop_status = value["message"].as_str().unwrap_or("").into(),
                "state" => {
                    playback_state = value["status"].as_str().unwrap_or("Stopped").into();
                    if playback_state == "Stopped" {
                        seconds = 0.0;
                        live_bitrate = None;
                    }
                }
                "preferences" => {
                    settings.quality = value["quality"].as_str().unwrap_or("flac").into();
                    settings.mode = value["mode"].as_str().unwrap_or("sequence").into();
                    let mut persisted = settings.clone();
                    if let Some(picker) = theme_picker.as_ref() {
                        persisted.theme = picker.original;
                    }
                    let _ = persisted.save();
                }
                "bitrate" => {
                    live_bitrate = value["value"]
                        .as_f64()
                        .filter(|v| v.is_finite() && *v > 0.0)
                }
                "quality" => {
                    quality = audio_quality_text(&value);
                    if value["codec"].is_null() {
                        live_bitrate = None;
                    }
                }
                "volume" => {
                    settings.volume = value["value"].as_u64().unwrap_or(70).min(100) as u8;
                    let mut persisted = settings.clone();
                    if let Some(picker) = theme_picker.as_ref() {
                        persisted.theme = picker.original;
                    }
                    let _ = persisted.save();
                }
                "home" => {
                    home = true;
                    media_shown = false;
                    settings_shown = false;
                    needs_login = false;
                }
                "account" => {
                    account_label = value["label"].as_str().unwrap_or("账号").into();
                }
                "time" => seconds = value["seconds"].as_f64().unwrap_or(0.0),
                "media" => {
                    media = value.clone();
                    if media["title"].as_str().unwrap_or("").is_empty() {
                        media_shown = false;
                    } else if value["fresh"] == true {
                        drag = None;
                        lyric_first = None;
                        media_shown = true;
                        seconds = value["seconds"].as_f64().unwrap_or(0.0);
                    }
                }
                "account_names" => {
                    if view == "accounts" {
                        tracks = value["accounts"].as_array().cloned().unwrap_or_default();
                    }
                }
                "queue" => {
                    collection_info = Value::Null;
                    collection_key.clear();
                    section_root = false;
                    view = "queue".into();
                    section.clear();
                    page_loaded = true;
                    page_title = value["title"].as_str().unwrap_or("队列历史").into();
                    page_description =
                        "N 切换队列 · Delete 删除此队列 · Enter 播放 · ←→ 翻页 · Tab 播放页".into();
                    if value["resized"] != true {
                        media_shown = false;
                    }
                    page = value["page"].as_u64().unwrap_or(1);
                    tracks = value["tracks"].as_array().cloned().unwrap_or_default();
                    selection.select(if tracks.is_empty() {
                        None
                    } else {
                        Some(
                            tracks
                                .iter()
                                .position(|t| t["active"] == true || t["remembered"] == true)
                                .unwrap_or(0),
                        )
                    });
                }
                "accounts" => {
                    collection_info = Value::Null;
                    collection_key.clear();
                    section_root = false;
                    needs_login = false;
                    section.clear();
                    page_loaded = true;
                    page_title = "○ 我的账号".into();
                    view = "accounts".into();
                    media_shown = false;
                    tracks = value["accounts"].as_array().cloned().unwrap_or_default();
                    selection = ListState::default();
                    selection.select(if tracks.is_empty() {
                        None
                    } else {
                        Some(value["selected"].as_u64().unwrap_or(0) as usize % tracks.len())
                    });
                    *selection.offset_mut() = (value["offset"].as_u64().unwrap_or(0) as usize)
                        .min(tracks.len().saturating_sub(1));
                    message = "Enter 切换 · L 添加 · Delete 删除账号 · H 主页".into();
                    page_description = "↑↓ 选择 · Enter 切换 · L 添加 · Delete 删除".into();
                }
                "catalog" => {
                    thumbnail_key = value["thumbnailKey"].as_u64().unwrap_or(0);
                    view = "catalog".into();
                    section.clear();
                    needs_login = false;
                    page_loaded = true;
                    section_root = false;
                    can_sort = false;
                    catalog_mode = value["mode"].as_str().unwrap_or("search").into();
                    catalog_type = value["searchType"].as_str().unwrap_or("song").into();
                    artist_tab = value["artistTab"].as_str().unwrap_or("heat").into();
                    profile_tab = value["profileTab"].as_u64().unwrap_or(1) as usize;
                    if value["resized"] != true {
                        profile_scroll = 0;
                    }
                    artist_info = value["artist"].clone();
                    catalog_key = value["key"].as_str().unwrap_or("").into();
                    collection_info = value["collectionInfo"].clone();
                    collection_key = value["collectionKey"].as_str().unwrap_or("").into();
                    search_results = true;
                    query = value["query"].as_str().unwrap_or("").into();
                    page_title = value["title"].as_str().unwrap_or("搜索").into();
                    page = value["page"].as_u64().unwrap_or(1);
                    if value["resized"] != true {
                        media_shown = false;
                    }
                    tracks = value["rows"].as_array().cloned().unwrap_or_default();
                    selection = ListState::default();
                    selection.select(if tracks.is_empty() {
                        None
                    } else {
                        Some(value["selected"].as_u64().unwrap_or(0) as usize % tracks.len())
                    });
                    *selection.offset_mut() = (value["offset"].as_u64().unwrap_or(0) as usize)
                        .min(tracks.len().saturating_sub(1));
                    page_description = if catalog_mode == "search" {
                        "N 切换分类 · ↑↓ 选择 · Enter 打开/播放 · ←→ 翻页".into()
                    } else if catalog_mode == "artist" {
                        "接口热门顺序 · N 切换 · J 资料 · , / . 照片 · ←→ 翻页".into()
                    } else {
                        "↑↓ 选择 · Enter 播放 · ←→ 翻页 · Esc 返回".into()
                    };
                    message = "分类按钮支持鼠标；Esc 返回上级".into();
                }
                "catalog_thumbnail" => {
                    if matches!(view.as_str(), "catalog" | "playlists")
                        && value["thumbnailKey"].as_u64() == Some(thumbnail_key)
                        && value["page"].as_u64() == Some(page)
                    {
                        if let Some(row) = value["rowIndex"]
                            .as_u64()
                            .and_then(|i| tracks.get_mut(i as usize))
                            .filter(|r| r["cover"] == value["cover"])
                        {
                            row["thumbnailPng"] = value["thumbnailPng"].clone();
                            row["thumbnailPixels"] = value["thumbnailPixels"].clone();
                        }
                    }
                }
                "catalog_assets" => {
                    if view == "catalog" && value["key"].as_str() == Some(catalog_key.as_str()) {
                        artist_info = value["artist"].clone();
                    }
                }
                "playlists" => {
                    thumbnail_key = value["thumbnailKey"].as_u64().unwrap_or(0);
                    collection_info = value["collectionInfo"].clone();
                    collection_key = value["collectionKey"].as_str().unwrap_or("").into();
                    browse_kind = value["browseKind"].as_str().unwrap_or("").into();
                    section_root = value["sectionRoot"].as_bool().unwrap_or(false);
                    needs_login = false;
                    section = value["section"].as_str().unwrap_or("").into();
                    page_loaded = true;
                    page_title = value["title"].as_str().unwrap_or("歌单").into();
                    page_description = "↑↓ 选择 · Enter 打开 · ←→ 翻页 · Backspace 返回栏目".into();
                    view = "playlists".into();
                    if value["resized"] != true {
                        media_shown = false;
                    }
                    page = value["page"].as_u64().unwrap_or(1);
                    tracks = value["lists"].as_array().cloned().unwrap_or_default();
                    selection = ListState::default();
                    selection.select(if tracks.is_empty() {
                        None
                    } else {
                        Some(value["selected"].as_u64().unwrap_or(0) as usize % tracks.len())
                    });
                    *selection.offset_mut() = (value["offset"].as_u64().unwrap_or(0) as usize)
                        .min(tracks.len().saturating_sub(1));
                    message = if value["selectFavorite"] == true {
                        "选择目标歌单并按 Enter 收藏"
                    } else {
                        "选择个人歌单并按 Enter 打开"
                    }
                    .into();
                }
                "tracks" => {
                    search_results = value["view"] == "search";
                    collection_info = value["collectionInfo"].clone();
                    collection_key = value["collectionKey"].as_str().unwrap_or("").into();
                    browse_kind = value["browseKind"].as_str().unwrap_or("").into();
                    section_root = value["sectionRoot"].as_bool().unwrap_or(false);
                    can_sort = value["canSort"].as_bool().unwrap_or(false);
                    sort_mode = value["sortMode"].as_str().unwrap_or("default").into();
                    sort_label = value["sortLabel"].as_str().unwrap_or("默认顺序").into();
                    needs_login = false;
                    section = value["section"].as_str().unwrap_or("").into();
                    page_loaded = true;
                    page_title = value["title"].as_str().unwrap_or("歌曲").into();
                    page_description = "↑↓ 选择 · Enter 播放 · F 收藏 · ←→ 翻页".into();
                    view = if value["view"] == "history" {
                        "history"
                    } else {
                        "tracks"
                    }
                    .into();
                    if value["resized"] != true {
                        media_shown = false;
                    }
                    page = value["page"].as_u64().unwrap_or(1);
                    tracks = value["tracks"].as_array().cloned().unwrap_or_default();
                    selection = ListState::default();
                    selection.select(if tracks.is_empty() {
                        None
                    } else {
                        Some(value["selected"].as_u64().unwrap_or(0) as usize % tracks.len())
                    });
                    *selection.offset_mut() = (value["offset"].as_u64().unwrap_or(0) as usize)
                        .min(tracks.len().saturating_sub(1));
                    qr.clear();
                    message = format!("找到 {} 首歌曲；方向键选择，Enter 播放", tracks.len());
                }
                "busy" => busy = value["value"].as_bool().unwrap_or(false),
                "search_home" => {
                    hot_searches = value["hot"]
                        .as_array()
                        .map(|rows| {
                            rows.iter()
                                .filter_map(Value::as_str)
                                .take(20)
                                .map(str::to_string)
                                .collect()
                        })
                        .unwrap_or_default();
                    hot_unavailable = value["unavailable"] == true;
                }
                "suggestions" => {
                    if editing
                        && settings.rich_search
                        && value["query"].as_str() == Some(query.trim())
                    {
                        suggestions = value["items"]
                            .as_array()
                            .map(|rows| {
                                rows.iter()
                                    .filter_map(Value::as_str)
                                    .take(16)
                                    .map(str::to_string)
                                    .collect()
                            })
                            .unwrap_or_default();
                        suggestion_selected = None;
                        suggestion_unavailable =
                            value["unavailable"] == true || suggestions.is_empty();
                    }
                }
                "collection_info" => {
                    if value["collectionKey"].as_str() == Some(collection_key.as_str())
                        && !collection_key.is_empty()
                    {
                        collection_info = value["info"].clone();
                    }
                }
                "auth_required" => {
                    needs_login = true;
                    home = false;
                    settings_shown = false;
                    media_shown = false;
                    page_loaded = false;
                    message = "登录已失效 · 点击重新扫码，或按 L".into();
                    details = value["message"].as_str().unwrap_or("请重新登录").into();
                }
                "qr" if login_origin.is_some() => {
                    match qr_lines(value["url"].as_str().unwrap_or("")) {
                        Ok(lines) => {
                            needs_login = false;
                            qr = lines;
                        }
                        Err(e) => message = e,
                    }
                }
                "clear_qr" => {
                    qr.clear();
                    if let Some(origin) = login_origin.take() {
                        (
                            home,
                            media_shown,
                            settings_shown,
                            editing,
                            needs_login,
                            page_loaded,
                        ) = origin;
                    }
                }
                "status" | "error" => {
                    message = value["message"].as_str().unwrap_or("请求失败").to_string()
                }
                "result" => {
                    page_loaded = false;
                    tracks.clear();
                    media_shown = false;
                    let result = &value["result"];
                    message = match result["verdict"].as_str().unwrap_or("") {
                        "not_tested" => "权益已读取，尚未执行领取",
                        "already_claimed" => "今天已领取，没有确认新增权益",
                        "daily_limit" => "今日领取次数已用尽",
                        "changed_needs_app_confirmation" => {
                            "接口接受且权益变化，请在官方 APP 核对到期时间"
                        }
                        "accepted_but_unverified" => "接口接受，但未观察到权益变化",
                        _ => "领取被拒绝，请检查账号活动资格",
                    }
                    .to_string();
                    details = format!(
                        "领取前：{}\n领取后：{}\n返回码：{}",
                        vip_text(&result["before"]),
                        vip_text(&result["after"]),
                        result["errorCode"]
                            .as_i64()
                            .map(|n| n.to_string())
                            .unwrap_or_else(|| "无".into())
                    );
                }
                _ => {}
            }
        }
        if lyric_first.is_some()
            && lyric_touched.elapsed() >= Duration::from_secs(settings.lyric_return)
        {
            lyric_first = None;
        }
        spectrum_animation.advance(spectrum_clock.elapsed().as_secs_f64());
        spectrum_clock = Instant::now();
        let mut regions = controls::Regions::default();
        let mut hd_area = None;
        let mut home_art_area = None;
        let mut thumbnail_areas: Vec<(ratatui::layout::Rect, String)> = Vec::new();
        let mut hd_png = media["png"].as_str().unwrap_or("").to_string();
        let sync_update = SyncUpdate::begin()?;
        terminal.try_draw(|frame| {
            if previous_frame_area.is_some_and(|area|area!=frame.area()){kitty_cover.invalidate()?;
            kitty_home.invalidate()?;for thumbnail in &mut kitty_thumbnails {thumbnail.invalidate()?;}cover_redraw_at=Some(Instant::now()+Duration::from_millis(220));}
            previous_frame_area=Some(frame.area());
            frame.render_widget(
                Block::default().style(
                    Style::default()
                        .bg(theme::current().background)
                        .fg(theme::current().foreground),
                ),
                frame.area(),
            );
            let root_areas = Layout::vertical([
                Constraint::Length(3),
                Constraint::Min(1),
                Constraint::Length(controls::footer_height(&settings)),
            ])
            .split(frame.area());
            let body = controls::navigation(
                frame,
                root_areas[1],
                settings.sidebar,
                if editing {"search"}else if settings_shown {
                    "settings"
                } else if home {
                    "home"
                } else if media_shown {
                    "playing"
                } else if !section.is_empty() {
                    &section
                } else {
                    &view
                },
                settings.large_icons,
                &mut regions,
            );
            frame.render_widget(Block::default().style(Style::default().bg(theme::section().background)),body);
            desired_capacity = body.height.saturating_sub(3).clamp(1, 1000);
            let areas = [root_areas[0], body, root_areas[2]];
            frame.render_widget(
                Paragraph::new(if editing && !settings.rich_search {
                    Line::from(vec![Span::styled(format!("搜索：{}▏", query), Style::default().fg(theme::current().header[2]))])
                } else {
                    Line::from(vec![
                        Span::styled(" \u{f001}  KUGOU LITE", Style::default().fg(theme::current().header[2])),
                        Span::styled(format!("   /   {}   ·   {}{}", account_label, if busy {"处理中 · "}else{""},message), Style::default().fg(theme::current().header[1])),
                    ])
                }).style(Style::default().bg(theme::current().header[0])).block(theme::panel().border_style(Style::default().fg(theme::current().header[3]))),
                areas[0],
            );
            if let Some((_, label)) = &delete_account {
                let parts = Layout::vertical([Constraint::Length(6), Constraint::Length(3), Constraint::Min(0)]).split(areas[1]);
                frame.render_widget(Paragraph::new(format!("\n  删除本机保存的账号：{label}\n  删除后如需使用此账号，需重新扫码。\n  Y / Enter 确认 · Esc 取消")).block(theme::panel().title(" 删除账号 ")), parts[0]);
                let buttons = Layout::horizontal([Constraint::Percentage(50), Constraint::Percentage(50)]).split(parts[1]);
                controls::button(frame, buttons[0], "确认删除", "key:y", &mut regions);
                controls::button(frame, buttons[1], "取消", "key:esc", &mut regions);
            } else if settings_shown {
                controls::settings_page(
                    frame,
                    areas[1],
                    &settings,
                    settings_category,
                    settings_selection,
                    settings_scroll,
                    help_scroll,
                    &mut regions,
                );
            } else if editing&&settings.rich_search {
                search_ui::entry(frame,areas[1],&query,&suggestions,suggestion_selected,suggestion_unavailable,&hot_searches,hot_unavailable,search_mood,&mut regions);
            } else if home {
                home_art_area = render_home(frame, areas[1], &account_label, &media, &quality, &settings);
                home_hits(areas[1], &mut regions);
            } else if qr.is_empty() && media_shown {
                let mut display_media = media.clone();
                display_media["quality"] = serde_json::json!(quality);
                display_media["volume"] = serde_json::json!(settings.volume);
                display_media["spectrum"] = spectrum_animation.frame(&spectrum);
                display_media["desktop"] = serde_json::json!(desktop_status);
                display_media["cavaStyle"] = serde_json::json!(settings.cava_style);
                display_media["mode"] = serde_json::json!(mode_text(&settings.mode));
                display_media["lyricFirst"] = serde_json::json!(lyric_first);
                display_media["scaleLyrics"] = serde_json::json!(settings.scale_lyrics);
                display_media["largeLyric"] = serde_json::json!(settings.large_lyric);
                display_media["lyricAlign"] = serde_json::json!(settings.lyric_align);
                regions.lyrics = media_columns(areas[1])[1];
                regions.add(regions.lyrics, "lyrics:reset");
                hd_area = render_media_with_layers(
                    frame,
                    areas[1],
                    &display_media,
                    seconds,
                    settings.translation,
                    settings.hd && kitty::supported(),
                    &mut regions.lyric_text,
                    &mut lyric_scroll,
                );
                let button = ratatui::layout::Rect::new(areas[1].x + areas[1].width.saturating_sub(15), areas[1].y, areas[1].width.min(14), 1);
                controls::button(frame, button, "音质 [S] ▾", "key:s", &mut regions);
            } else if qr.is_empty() && page_loaded && view=="catalog" && catalog_mode=="profile" {
                let (body,_)=catalog_ui::layout(frame,areas[1],&catalog_mode,&catalog_type,&artist_tab,profile_tab,&artist_info,false,&mut regions);
                catalog_ui::profile(frame,body,&artist_info,profile_tab,&mut profile_scroll,&mut regions);
            } else if qr.is_empty() && page_loaded {
                let search_parts=Layout::vertical([Constraint::Length(if search_results&&settings.rich_search&&(view=="tracks"||view=="catalog"&&catalog_mode=="search"){3}else{0}),Constraint::Min(0)]).split(areas[1]);
                if search_results&&settings.rich_search&&(view=="tracks"||view=="catalog"&&catalog_mode=="search"){search_ui::input(frame,search_parts[0],&query,false);regions.add(search_parts[0],"key:/");}
                let mut catalog_body=search_parts[1];
                if view=="catalog" {
                    let (body,image)=catalog_ui::layout(frame,catalog_body,&catalog_mode,&catalog_type,&artist_tab,profile_tab,&artist_info,settings.hd&&kitty::supported(),&mut regions);catalog_body=body;
                    if let Some(rect)=image {hd_area=Some(rect);hd_png=artist_info["png"].as_str().unwrap_or("").into();}
                }
                let (info_area,content_area)=collections::columns(catalog_body,(view=="tracks"||view=="catalog"&&catalog_mode=="album")&&!collection_info.is_null());
                if let Some(rect)=collections::info(frame,info_area,&collection_info,settings.hd&&kitty::supported()){
                    hd_area=Some(rect);hd_png=collection_info["png"].as_str().unwrap_or("").into();
                }
                let content_parts=Layout::vertical([Constraint::Length(1),Constraint::Length(if section_root{4}else{0}),Constraint::Min(0)]).split(content_area);
                if section_root{collections::banner(frame,content_parts[1],&section,&browse_kind,&mut regions);}
                let list_parts =
                    [content_parts[0],content_parts[2]];
                frame.render_widget(
                    Paragraph::new(format!(" {}", page_description))
                        .style(Style::default().fg(theme::current().muted)),
                    list_parts[0],
                );
                if list_parts[0].width >= 20 {
                    let r = list_parts[0];
                    if view == "accounts" {
                        controls::button(frame, ratatui::layout::Rect::new(r.right().saturating_sub(24), r.y, 12, 1), "删除选中", "key:delete", &mut regions);
                        controls::button(
                            frame,
                            ratatui::layout::Rect::new(r.right() - 12, r.y, 12, 1),
                            "+ 添加账号",
                            "key:l",
                            &mut regions,
                        );
                    } else {
                        if view=="tracks" && can_sort && r.width>=36 {
                            let w=if r.width>=52 {24} else {14};
                            controls::button(frame,ratatui::layout::Rect::new(r.right()-12-w,r.y,w,1),&format!("排序[Z] · {sort_label}"),"key:z",&mut regions);
                        }
                        controls::button(
                            frame,
                            ratatui::layout::Rect::new(r.right() - 12, r.y, 6, 1),
                            "‹ 上页",
                            "key:pgup",
                            &mut regions,
                        );
                        controls::button(
                            frame,
                            ratatui::layout::Rect::new(r.right() - 6, r.y, 6, 1),
                            "下页 ›",
                            "key:pgdown",
                            &mut regions,
                        );
                    }
                }
                regions.list = theme::panel().inner(list_parts[1]);
                let directory_cards=view=="playlists"&&!tracks.first().is_some_and(|r|r["action"].is_string());
                let cards=directory_cards;
                let artist_cards=view=="catalog"&&(catalog_mode=="search"&&matches!(catalog_type.as_str(),"artist"|"playlist"|"album")||catalog_mode=="artist"&&artist_tab=="albums");
                let row_height=if artist_cards||directory_cards {3}else if cards||view=="catalog"&&(tracks.first().is_some_and(|r|r["kind"]!="song")){2}else{1};
                desired_capacity=(regions.list.height/row_height).max(1);
                let items = tracks.iter().enumerate().map(|(i, t)| {
                    if view=="catalog" {return catalog_ui::row((t["number"].as_u64().unwrap_or(i as u64+1)-1) as usize,t,regions.list.width.saturating_sub(1));}
                    if view == "accounts" {
                        return ListItem::new(format!(
                            " {}  {}",
                            if t["active"] == true { "●" } else { "○" },
                            t["label"].as_str().unwrap_or("账号")
                        ));
                    }
                    if view == "playlists" {
                        let description = t["description"].as_str().unwrap_or("");
                        let heading=Line::from(vec![
                            Span::styled(
                                format!("{} {}  ",if directory_cards {"        "}else{""}, t["icon"].as_str().unwrap_or("≡")),
                                Style::default().fg(theme::current().accent),
                            ),
                            Span::styled(
                                t["title"].as_str().unwrap_or("歌单").to_string(),
                                Style::default().fg(theme::current().foreground),
                            ),
                            Span::styled(
                                if cards{t["count"].as_u64().map(|n|format!("   {n} 首")).unwrap_or_else(||"   曲数未知".into())}else{
                                if description.is_empty() {
                                    t["count"]
                                        .as_u64()
                                        .map(|n| format!("   {n} 首"))
                                        .unwrap_or_default()
                                } else {
                                    format!("   {description}")
                                }},
                                Style::default().fg(theme::current().muted),
                            ),
                        ]);
                        return if cards{ListItem::new(vec![heading,Line::from(Span::styled(format!("            {} · {}",collections::playlist_plays(t),if description.is_empty(){"Enter 探索"}else{description}),Style::default().fg(theme::current().muted))),Line::from("")])}else{ListItem::new(heading)};
                    }
                    let number=t["number"].as_u64().unwrap_or(i as u64+1).max(1);
                    if !section.is_empty()||!collection_info.is_null(){return ListItem::new(collections::song_row((number-1)as usize,t,regions.list.width.saturating_sub(1)));}
                    ListItem::new(Line::from(vec![
                        Span::styled(
                            format!(" {:>3}  ", number),
                            Style::default().fg(theme::current().muted),
                        ),
                        Span::styled(
                            if t["active"] == true { "▶ " } else { "♪ " },
                            Style::default().fg(theme::current().accent),
                        ),
                        Span::styled(
                            t["title"].as_str().unwrap_or("").to_string(),
                            Style::default().fg(theme::current().foreground),
                        ),
                        Span::styled(
                            format!(
                                "   / {}   {}",
                                t["artist"].as_str().unwrap_or(""),
                                clock_text(t["duration"].as_f64().unwrap_or(0.0))
                            ),
                            Style::default().fg(theme::current().muted),
                        ),
                        Span::styled(
                            if t["vip"] == true { "  VIP" } else { "" },
                            Style::default().fg(theme::current().warning),
                        ),
                    ]))
                });
                let block = theme::panel()
                    .border_type(BorderType::Rounded)
                    .border_style(Style::default().fg(theme::section().border))
                    .title(format!(
                        " {}  ·  第 {} 页  ·  {} 项 ",
                        page_title,
                        page,
                        tracks.len()
                    ));
                if tracks.is_empty() {
                    frame.render_widget(
                        Paragraph::new("\n  暂无内容。可返回栏目或按 G 刷新。").block(block),
                        list_parts[1],
                    );
                } else {
                    frame.render_stateful_widget(
                        List::new(items)
                            .block(block)
                            .scroll_padding(if matches!(section.as_str(),"recommend"|"discover"){2usize.div_ceil(row_height as usize)}else{0})
                            .highlight_symbol("▌")
                            .highlight_style(Style::default().bg(theme::current().surface)),
                        list_parts[1],
                        &mut selection,
                    );
                }
                for row in 0..regions.list.height/row_height {
                    let index = selection.offset() + row as usize;
                    if index < tracks.len() {
                        if (artist_cards||directory_cards) && regions.list.width>=8 {
                            let rect=ratatui::layout::Rect::new(regions.list.x+1,regions.list.y+row*row_height,6,3);
                            if let Some(asset)=catalog_ui::thumbnail(frame,rect,&tracks[index],settings.hd){thumbnail_areas.push(asset);}
                        }
                        regions.add(
                            ratatui::layout::Rect::new(
                                regions.list.x,
                                regions.list.y + row*row_height,
                                regions.list.width,
                                row_height,
                            ),
                            format!("row:{index}"),
                        );
                    }
                }
            } else if qr.is_empty() && needs_login {
                let parts = Layout::vertical([
                    Constraint::Length(5),
                    Constraint::Length(3),
                    Constraint::Min(0),
                ])
                .split(areas[1]);
                frame.render_widget(
                    Paragraph::new(details.clone())
                        .wrap(Wrap { trim: false })
                        .block(theme::panel().title(" 登录需要更新 ")),
                    parts[0],
                );
                controls::button(frame, parts[1], "重新扫码登录 · L", "key:l", &mut regions);
            } else if qr.is_empty() {
                frame.render_widget(
                    Paragraph::new(details.clone())
                        .wrap(Wrap { trim: false })
                        .block(theme::panel().title(" 账号与会员 ")),
                    areas[1],
                );
            } else {
                let width = qr[0].chars().count() as u16;
                if areas[1].width < width || areas[1].height < qr.len() as u16 {
                    frame.render_widget(
                        Paragraph::new(format!(
                            "请放大终端：二维码需要至少 {} 列 × {} 行，加上 7 行导航。",
                            width,
                            qr.len()
                        )),
                        areas[1],
                    );
                } else {
                    let lines: Vec<Line> = qr
                        .iter()
                        .map(|s| {
                            Line::styled(
                                s.clone(),
                                Style::default().fg(Color::Black).bg(Color::White),
                            )
                        })
                        .collect();
                    frame.render_widget(Paragraph::new(lines), areas[1]);
                }
            }
            let mut footer_media = media.clone();
            footer_media["liveBitrate"] = serde_json::json!(live_bitrate);
            controls::footer(
                frame,
                areas[2],
                &footer_media,
                seconds,
                &quality,
                &playback_state,
                &message,
                &settings,
                drag,
                &mut regions,
            );
            let mut overlays = notifications.render(frame, areas[1], &settings, &mut regions);
            if let Some(picker) = theme_picker.as_mut() {overlays.push(picker.render(frame,&mut regions));}
            if let Some(picker)=sort_picker.as_ref() {overlays.push(picker.render(frame,&mut regions));}
            if let Some(picker)=quality_picker.as_ref() {overlays.push(picker.render(frame,&mut regions,&settings.quality,&quality));}
            regions.icons.retain(|(r,_)| !overlays.iter().any(|o| r.intersection(*o).area()>0));
            regions.lyric_text.retain(|l| !overlays.iter().any(|o| l.rect.intersection(*o).area()>0));
            if hd_area.is_some_and(|r| overlays.iter().any(|o| r.intersection(*o).area()>0)) {hd_area=None;}
            if home_art_area.is_some_and(|r| overlays.iter().any(|o| r.intersection(*o).area()>0)) {home_art_area=None;}
            thumbnail_areas.retain(|(r,_)| !overlays.iter().any(|o| r.intersection(*o).area()>0));
            text_icons.capture(frame, &regions.icons);
            lyric_text.capture(frame,&regions.lyric_text);
            lyric_text.erase_previous(&mut io::stdout())?;
            Ok::<(), io::Error>(())
        })?;
        text_icons.paint(terminal.backend_mut())?;
        lyric_text.paint(terminal.backend_mut())?;
        if desired_capacity != capacity && !busy && !editing {
            capacity = desired_capacity;
            writeln!(worker.0.stdin.as_mut().unwrap(), "pagesize:{}", capacity)?;
        }
        if let Some(rect) = hd_area {
            kitty_cover.show(&hd_png, rect)?;
        } else {
            kitty_cover.clear()?;
        }
        if let Some(rect) = home_art_area {
            kitty_home.show(home_art::png(), rect)?;
        } else {
            kitty_home.clear()?;
        }
        for (index, (rect, png)) in thumbnail_areas.iter().enumerate() {
            if index >= kitty_thumbnails.len() {
                kitty_thumbnails.push(kitty::Cover::with_id(47300 + index as u32));
            }
            kitty_thumbnails[index].show(png, *rect)?;
        }
        for thumbnail in kitty_thumbnails.iter_mut().skip(thumbnail_areas.len()) {
            thumbnail.clear()?;
        }
        drop(sync_update);
        let frame_budget = if media_shown && !home && !settings_shown {
            Duration::from_micros(16_667)
        } else {
            Duration::from_millis(100)
        };
        if event::poll(frame_budget.saturating_sub(frame_started.elapsed()))? {
            let input = event::read()?;
            let mut mouse_global = false;
            let key = match input {
                Event::Resize(_, _) => {
                    kitty_cover.invalidate()?;
                    kitty_home.invalidate()?;
                    for thumbnail in &mut kitty_thumbnails {
                        thumbnail.invalidate()?;
                    }
                    cover_redraw_at = Some(Instant::now() + Duration::from_millis(220));
                    text_icons.invalidate();
                    lyric_text.invalidate();
                    drag = None;
                    continue;
                }
                Event::Mouse(mouse) if settings.mouse => {
                    let (x, y) = (mouse.column, mouse.row);
                    if quality_picker.is_some() && !controls::contains(regions.quality_menu, x, y) {
                        if matches!(mouse.kind, MouseEventKind::Down(MouseButton::Left)) {
                            quality_picker = None;
                        }
                        continue;
                    }
                    if sort_picker.is_some() && !controls::contains(regions.sort_menu, x, y) {
                        continue;
                    }
                    if theme_picker.is_some() && !controls::contains(regions.theme_menu, x, y) {
                        continue;
                    }
                    match mouse.kind {
                        MouseEventKind::ScrollUp | MouseEventKind::ScrollDown => {
                            let down = mouse.kind == MouseEventKind::ScrollDown;
                            if let Some(picker) = quality_picker.as_mut() {
                                picker.move_key(if down { KeyCode::Down } else { KeyCode::Up });
                                continue;
                            }
                            if let Some(picker) = sort_picker.as_mut() {
                                picker.move_key(if down { KeyCode::Down } else { KeyCode::Up });
                                continue;
                            }
                            if let Some(picker) = theme_picker.as_mut() {
                                if controls::contains(regions.theme_menu, x, y) {
                                    picker.key(if down { KeyCode::Down } else { KeyCode::Up });
                                    settings.theme = picker.selected;
                                }
                                continue;
                            }
                            if media_shown
                                && !settings_shown
                                && controls::contains(regions.lyrics, x, y)
                            {
                                let rows = media["lyrics"].as_array();
                                let len = rows.map_or(0, Vec::len);
                                let mut lyric_media = media.clone();
                                lyric_media["scaleLyrics"] =
                                    serde_json::json!(settings.scale_lyrics);
                                lyric_media["largeLyric"] = serde_json::json!(settings.large_lyric);
                                let current = lyrics::automatic_first(
                                    &lyric_media,
                                    seconds,
                                    lyrics::content_area(regions.lyrics),
                                    settings.translation,
                                );
                                let first = lyric_first.unwrap_or(current);
                                lyric_first = Some(if down {
                                    first.saturating_add(3).min(len.saturating_sub(1))
                                } else {
                                    first.saturating_sub(3)
                                });
                                lyric_touched = Instant::now();
                                continue;
                            }
                            if settings_shown && controls::contains(regions.help, x, y) {
                                help_scroll = if down {
                                    (help_scroll + 3).min(30)
                                } else {
                                    help_scroll.saturating_sub(3)
                                };
                                continue;
                            }
                            if settings_shown {
                                settings_selection = if down {
                                    (settings_selection + 1).min(
                                        controls::settings_indices(&settings, settings_category)
                                            .len()
                                            .saturating_sub(1),
                                    )
                                } else {
                                    settings_selection.saturating_sub(1)
                                };
                                settings_scroll = fit_selection(
                                    settings_selection,
                                    settings_scroll,
                                    regions.settings.height,
                                );
                                continue;
                            }
                            if view == "catalog"
                                && catalog_mode == "profile"
                                && controls::contains(regions.profile, x, y)
                            {
                                profile_scroll = if down {
                                    profile_scroll.saturating_add(3)
                                } else {
                                    profile_scroll.saturating_sub(3)
                                };
                                continue;
                            }
                            if controls::contains(regions.list, x, y) && !tracks.is_empty() {
                                let i = selection.selected().unwrap_or(0);
                                selection.select(Some(if down {
                                    (i + 3).min(tracks.len() - 1)
                                } else {
                                    i.saturating_sub(3)
                                }));
                            }
                            continue;
                        }
                        MouseEventKind::Down(MouseButton::Left)
                            if controls::contains(regions.progress, x, y) =>
                        {
                            if media["duration"].as_f64().unwrap_or(0.0) > 0.0 && !busy {
                                drag = Some(controls::seek_fraction(regions.progress, x));
                            }
                            continue;
                        }
                        MouseEventKind::Drag(MouseButton::Left) if drag.is_some() => {
                            drag = Some(controls::seek_fraction(regions.progress, x));
                            continue;
                        }
                        MouseEventKind::Up(MouseButton::Left) if drag.is_some() => {
                            let ratio = controls::seek_fraction(regions.progress, x);
                            drag = None;
                            if !busy {
                                writeln!(worker.0.stdin.as_mut().unwrap(), "seekpercent:{ratio}")?;
                            }
                            continue;
                        }
                        MouseEventKind::Down(MouseButton::Left) => {
                            let Some(action) = regions.hit(x, y) else {
                                continue;
                            };
                            if quality_picker.is_some() {
                                if !busy {
                                    if let Some(i) = action
                                        .strip_prefix("quality-select:")
                                        .and_then(|raw| raw.parse::<usize>().ok())
                                    {
                                        if let Some(id) = settings::QUALITIES.get(i) {
                                            writeln!(
                                                worker.0.stdin.as_mut().unwrap(),
                                                "qualityapply:{id}"
                                            )?;
                                            busy = true;
                                            quality_picker = None;
                                        }
                                    }
                                }
                                continue;
                            }
                            if sort_picker.is_some() {
                                if let Some(raw) = action.strip_prefix("sort-select:") {
                                    if let Ok(i) = raw.parse::<usize>() {
                                        if let Some((id, _)) = sort_menu::OPTIONS.get(i) {
                                            writeln!(
                                                worker.0.stdin.as_mut().unwrap(),
                                                "sort:{id}"
                                            )?;
                                            busy = true;
                                            sort_picker = None;
                                        }
                                    }
                                }
                                continue;
                            }
                            if theme_picker.is_some() {
                                if let Some(id) = action.strip_prefix("theme-select:") {
                                    if let Ok(index) = id.parse::<usize>() {
                                        if index < theme::palettes().len() {
                                            theme_picker.as_mut().unwrap().selected = index;
                                            settings.theme = index;
                                        }
                                    }
                                    continue;
                                }
                                if action != "theme-confirm" && action != "theme-cancel" {
                                    continue;
                                }
                            }
                            if let Some(id) = action.strip_prefix("notification-dismiss:") {
                                notifications.dismiss(id.parse().unwrap_or(0));
                                continue;
                            }
                            if action == "theme-confirm" || action == "theme-cancel" {
                                if let Some(picker) = theme_picker.take() {
                                    if action == "theme-confirm" {
                                        settings.save()?;
                                    } else {
                                        settings.theme = picker.original;
                                    }
                                }
                                continue;
                            }
                            if action == "lyrics:reset" {
                                lyric_first = None;
                                continue;
                            }
                            if let Some(raw) = action.strip_prefix("settings-page:") {
                                settings_category = raw.parse::<usize>().unwrap_or(0).min(5);
                                settings_selection = 0;
                                settings_scroll = 0;
                                settings_shown = true;
                                continue;
                            }
                            if let Some(command) = action.strip_prefix("catalog:") {
                                if !busy {
                                    let input = worker.0.stdin.as_mut().unwrap();
                                    writeln!(
                                        input,
                                        "focus:{}:{}",
                                        selection.selected().unwrap_or(0),
                                        selection.offset()
                                    )?;
                                    writeln!(input, "{command}")?;
                                    input.flush()?;
                                    busy = true;
                                }
                                continue;
                            }
                            if let Some(raw) = action.strip_prefix("search-seed:") {
                                query = raw.to_string();
                                suggestion_selected = None;
                                KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)
                            } else if let Some(raw) = action.strip_prefix("suggestion:") {
                                suggestion_selected = raw.parse().ok();
                                KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)
                            } else if let Some(raw) = action.strip_prefix("setting:") {
                                let id = raw.parse::<usize>().unwrap_or(0);
                                settings_selection =
                                    controls::settings_indices(&settings, settings_category)
                                        .iter()
                                        .position(|i| *i == id)
                                        .unwrap_or(0);
                                KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)
                            } else if let Some(raw) = action.strip_prefix("row:") {
                                if busy {
                                    continue;
                                }
                                editing = false;
                                selection.select(raw.parse().ok());
                                KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)
                            } else if let Some(raw) = action.strip_prefix("key:") {
                                mouse_global = true;
                                editing = false;
                                if ["r", "d", "/", "p", "a", "b", "s", "\t"].contains(&raw) {
                                    settings_shown = false;
                                }
                                let code = match raw {
                                    "esc" => KeyCode::Esc,
                                    "delete" => KeyCode::Delete,
                                    "pgup" => KeyCode::PageUp,
                                    "pgdown" => KeyCode::PageDown,
                                    "\t" => KeyCode::Tab,
                                    _ => KeyCode::Char(raw.chars().next().unwrap_or(' ')),
                                };
                                KeyEvent::new(code, KeyModifiers::NONE)
                            } else {
                                continue;
                            }
                        }
                        _ => continue,
                    }
                }
                Event::Key(key) => key,
                _ => continue,
            };
            {
                if key.kind != KeyEventKind::Press {
                    continue;
                }
                if let Some(picker) = quality_picker.as_mut() {
                    match key.code {
                        KeyCode::Esc | KeyCode::Char('s' | 'S') => quality_picker = None,
                        KeyCode::Char('q' | 'Q') => return Ok(()),
                        KeyCode::Enter | KeyCode::Char(' ') if !busy => {
                            let id = settings::QUALITIES[picker.selected];
                            writeln!(worker.0.stdin.as_mut().unwrap(), "qualityapply:{id}")?;
                            busy = true;
                            quality_picker = None;
                        }
                        _ => picker.move_key(key.code),
                    }
                    continue;
                }
                if let Some(picker) = sort_picker.as_mut() {
                    match key.code {
                        KeyCode::Esc => sort_picker = None,
                        KeyCode::Char('q' | 'Q') => return Ok(()),
                        KeyCode::Enter | KeyCode::Char(' ') => {
                            let id = sort_menu::OPTIONS[picker.selected].0;
                            writeln!(worker.0.stdin.as_mut().unwrap(), "sort:{id}")?;
                            busy = true;
                            sort_picker = None;
                        }
                        _ => picker.move_key(key.code),
                    }
                    continue;
                }
                if let Some(picker) = theme_picker.as_mut() {
                    if matches!(key.code, KeyCode::Char('q' | 'Q')) {
                        return Ok(());
                    }
                    match picker.key(key.code) {
                        theme_picker::Action::Preview(index) => settings.theme = index,
                        theme_picker::Action::Confirm => {
                            settings.save()?;
                            theme_picker = None;
                        }
                        theme_picker::Action::Cancel => {
                            settings.theme = picker.original;
                            theme_picker = None;
                        }
                        theme_picker::Action::None => {}
                    }
                    continue;
                }
                if let Some((userid, _)) = &delete_account {
                    if matches!(key.code, KeyCode::Char('q' | 'Q')) {
                        return Ok(());
                    }
                    if key.code == KeyCode::Esc {
                        delete_account = None;
                        continue;
                    }
                    if matches!(key.code, KeyCode::Enter | KeyCode::Char('y' | 'Y')) && !busy {
                        writeln!(worker.0.stdin.as_mut().unwrap(), "deleteaccount:{userid}")?;
                        busy = true;
                        delete_account = None;
                    }
                    continue;
                }
                if key.code == KeyCode::Esc
                    || (key.code == KeyCode::Char('c')
                        && key.modifiers.contains(KeyModifiers::CONTROL))
                {
                    drag = None;
                    if let Some(origin) = login_origin.take() {
                        qr.clear();
                        (
                            home,
                            media_shown,
                            settings_shown,
                            editing,
                            needs_login,
                            page_loaded,
                        ) = origin;
                        writeln!(worker.0.stdin.as_mut().unwrap(), "cancel")?;
                        message = "已取消扫码登录".into();
                    } else if editing {
                        editing = false;
                        if let Some((h, m, s)) = search_origin.take() {
                            home = h;
                            media_shown = m;
                            settings_shown = s;
                        }
                    } else if settings_shown {
                        settings_shown = false;
                    } else if media_shown {
                        media_shown = false;
                    } else if !home && !busy {
                        writeln!(worker.0.stdin.as_mut().unwrap(), "back")?;
                        busy = true;
                    }
                    continue;
                }
                if editing {
                    match key.code {
                        KeyCode::Esc => editing = false,
                        KeyCode::Backspace => {
                            query.pop();
                            suggestions.clear();
                            suggestion_selected = None;
                            suggestion_sent.clear();
                            suggestion_unavailable = false;
                            query_changed = Instant::now();
                        }
                        KeyCode::Char(c) => {
                            if query.chars().count() < 100 {
                                query.push(c);
                                suggestions.clear();
                                suggestion_selected = None;
                                suggestion_sent.clear();
                                suggestion_unavailable = false;
                                query_changed = Instant::now();
                            }
                        }
                        KeyCode::Enter if !busy => {
                            if let Some(i) = suggestion_selected {
                                if let Some(text) = suggestions.get(i) {
                                    query = text.clone();
                                }
                            }
                            editing = false;
                            search_origin = None;
                            if !query.trim().is_empty() {
                                busy = true;
                                message = "正在搜索…".into();
                                let input = worker.0.stdin.as_mut().unwrap();
                                writeln!(input, "search:{}", query.trim())?;
                                input.flush()?;
                            }
                        }
                        KeyCode::Down if !suggestions.is_empty() => {
                            suggestion_selected = Some(
                                suggestion_selected.map_or(0, |i| (i + 1) % suggestions.len()),
                            );
                        }
                        KeyCode::Up if !suggestions.is_empty() => {
                            suggestion_selected =
                                Some(suggestion_selected.map_or(suggestions.len() - 1, |i| {
                                    (i + suggestions.len() - 1) % suggestions.len()
                                }));
                        }
                        KeyCode::Tab if !suggestions.is_empty() => {
                            if let Some(text) = suggestions.get(suggestion_selected.unwrap_or(0)) {
                                query = text.clone();
                                suggestion_selected = None;
                                suggestions.clear();
                                suggestion_sent.clear();
                                query_changed = Instant::now();
                            }
                        }
                        _ => {}
                    }
                    continue;
                }
                if matches!(key.code, KeyCode::Char('q' | 'Q')) {
                    return Ok(());
                }
                if matches!(key.code, KeyCode::Char('h' | 'H') | KeyCode::F(2)) {
                    home = true;
                    settings_shown = false;
                    media_shown = false;
                    needs_login = false;
                    qr.clear();
                    login_origin = None;
                    drag = None;
                    writeln!(worker.0.stdin.as_mut().unwrap(), "home")?;
                    continue;
                }
                if key.code == KeyCode::Char('?') || key.code == KeyCode::F(1) {
                    settings_shown = !settings_shown;
                    editing = false;
                    continue;
                }
                if settings_shown
                    && key.code == KeyCode::Char(' ')
                    && controls::settings_indices(&settings, settings_category)
                        .get(settings_selection)
                        == Some(&10)
                {
                    drag = None;
                    theme_picker = Some(theme_picker::Picker::new(settings.theme));
                    continue;
                }
                if settings_shown && !mouse_global {
                    if let KeyCode::Char(ch @ '1'..='6') = key.code {
                        settings_category = (ch as u8 - b'1') as usize;
                        settings_selection = 0;
                        settings_scroll = 0;
                        continue;
                    }
                    if key.modifiers.contains(KeyModifiers::SHIFT)
                        && settings_category == 3
                        && matches!(key.code, KeyCode::Up | KeyCode::Down)
                    {
                        let ids = controls::settings_indices(&settings, settings_category);
                        if let Some(id) = ids.get(settings_selection).filter(|id| **id >= 15) {
                            let item = settings::STATUS_ITEMS[*id - 15].0;
                            if let Some(i) = settings.status_items.iter().position(|s| s == item) {
                                let next = if key.code == KeyCode::Down {
                                    (i + 1).min(settings.status_items.len() - 1)
                                } else {
                                    i.saturating_sub(1)
                                };
                                settings.status_items.swap(i, next);
                                settings_selection = next + 1;
                                settings.save()?;
                            }
                        }
                        continue;
                    }
                }
                if settings_shown
                    && !mouse_global
                    && matches!(
                        key.code,
                        KeyCode::PageDown
                            | KeyCode::PageUp
                            | KeyCode::Up
                            | KeyCode::Down
                            | KeyCode::Enter
                            | KeyCode::Right
                            | KeyCode::Left
                    )
                {
                    match key.code {
                        KeyCode::PageDown | KeyCode::PageUp => {
                            settings_category = (settings_category
                                + if key.code == KeyCode::PageDown { 1 } else { 5 })
                                % 6;
                            settings_selection = 0;
                            settings_scroll = 0;
                        }
                        KeyCode::Up if settings_category == 4 => {
                            help_scroll = help_scroll.saturating_sub(1)
                        }
                        KeyCode::Down if settings_category == 4 => {
                            help_scroll = (help_scroll + 1).min(30)
                        }
                        KeyCode::Up => {
                            settings_selection = settings_selection.saturating_sub(1);
                        }
                        KeyCode::Down => {
                            settings_selection = (settings_selection + 1).min(
                                controls::settings_indices(&settings, settings_category)
                                    .len()
                                    .saturating_sub(1),
                            );
                        }
                        KeyCode::Enter | KeyCode::Right | KeyCode::Left => {
                            let forward = key.code != KeyCode::Left;
                            let ids = controls::settings_indices(&settings, settings_category);
                            let Some(id) = ids.get(settings_selection).copied() else {
                                continue;
                            };
                            if busy && [7, 8].contains(&id) {
                                message = "等待当前请求完成后修改播放选项".into();
                                continue;
                            }
                            if id == 10 {
                                drag = None;
                                theme_picker = Some(theme_picker::Picker::new(settings.theme));
                                continue;
                            }
                            let command = change_setting(&mut settings, id, forward);
                            if settings.mouse {
                                crossterm::execute!(io::stdout(), EnableMouseCapture)?;
                            } else {
                                crossterm::execute!(io::stdout(), DisableMouseCapture)?;
                            }
                            if let Some(command) = command {
                                writeln!(worker.0.stdin.as_mut().unwrap(), "{command}")?;
                            }
                            settings.save()?;
                        }
                        _ => {}
                    }
                    settings_scroll =
                        fit_selection(settings_selection, settings_scroll, regions.settings.height);
                    continue;
                }
                if matches!(key.code, KeyCode::Char('z' | 'Z'))
                    && can_sort
                    && view == "tracks"
                    && page_loaded
                    && !busy
                    && !home
                    && !media_shown
                    && !settings_shown
                    && qr.is_empty()
                {
                    drag = None;
                    sort_picker = Some(sort_menu::Picker::new(&sort_mode));
                    continue;
                }
                let changed = match key.code {
                    KeyCode::Char('u' | 'U') => {
                        settings.sidebar = !settings.sidebar;
                        true
                    }
                    KeyCode::Char('i' | 'I') => {
                        settings.hd = !settings.hd;
                        true
                    }
                    KeyCode::Char('t' | 'T')
                        if !(!home && !media_shown && section == "discover" && section_root) =>
                    {
                        settings.translation = !settings.translation;
                        true
                    }
                    KeyCode::Char('+' | '=') => {
                        settings.volume = settings.volume.saturating_add(5).min(100);
                        writeln!(
                            worker.0.stdin.as_mut().unwrap(),
                            "volume:{}",
                            settings.volume
                        )?;
                        true
                    }
                    KeyCode::Char('-') => {
                        settings.volume = settings.volume.saturating_sub(5);
                        writeln!(
                            worker.0.stdin.as_mut().unwrap(),
                            "volume:{}",
                            settings.volume
                        )?;
                        true
                    }
                    _ => false,
                };
                if changed {
                    if settings.save().is_err() {
                        message = "设置保存失败，本次会话仍然生效".into();
                    }
                    continue;
                }
                if matches!(key.code, KeyCode::Char(' ' | 'x' | 'X')) {
                    let input = worker.0.stdin.as_mut().unwrap();
                    writeln!(
                        input,
                        "{}",
                        if key.code == KeyCode::Char(' ') {
                            "pause"
                        } else {
                            "stop"
                        }
                    )?;
                    input.flush()?;
                    continue;
                }
                if key.code == KeyCode::Tab {
                    settings_shown = false;
                    media_shown = if home { true } else { !media_shown };
                    home = false;
                    continue;
                }
                if busy {
                    continue;
                }
                if !home && !media_shown && view == "catalog" {
                    if catalog_mode == "profile" {
                        match key.code {
                            KeyCode::Down => {
                                profile_scroll = profile_scroll.saturating_add(1);
                                continue;
                            }
                            KeyCode::Up => {
                                profile_scroll = profile_scroll.saturating_sub(1);
                                continue;
                            }
                            KeyCode::PageDown => {
                                profile_scroll = profile_scroll.saturating_add(10);
                                continue;
                            }
                            KeyCode::PageUp => {
                                profile_scroll = profile_scroll.saturating_sub(10);
                                continue;
                            }
                            _ => {}
                        }
                    }
                    let command = match key.code {
                        KeyCode::Char('n' | 'N') if catalog_mode == "search" => {
                            Some("searchtoggle".to_string())
                        }
                        KeyCode::Char('n' | 'N') if catalog_mode == "artist" => {
                            Some("artisttoggle".to_string())
                        }
                        KeyCode::Char('n' | 'N') if catalog_mode == "profile" => {
                            Some("profiletoggle".to_string())
                        }
                        KeyCode::Char('j' | 'J') if catalog_mode == "artist" => {
                            Some("artistprofile".to_string())
                        }
                        KeyCode::Char(',') if catalog_mode == "artist" => {
                            Some("artistphoto:-1".to_string())
                        }
                        KeyCode::Char('.') if catalog_mode == "artist" => {
                            Some("artistphoto:1".to_string())
                        }
                        KeyCode::Left if catalog_mode == "profile" => {
                            Some(format!("profiletab:{}", (profile_tab + 4) % 5))
                        }
                        KeyCode::Right if catalog_mode == "profile" => {
                            Some(format!("profiletab:{}", (profile_tab + 1) % 5))
                        }
                        KeyCode::Char(c @ '1'..='5') if catalog_mode == "profile" => {
                            Some(format!("profiletab:{}", c as usize - '1' as usize))
                        }
                        _ => None,
                    };
                    if let Some(command) = command {
                        let input = worker.0.stdin.as_mut().unwrap();
                        writeln!(
                            input,
                            "focus:{}:{}",
                            selection.selected().unwrap_or(0),
                            selection.offset()
                        )?;
                        writeln!(input, "{command}")?;
                        input.flush()?;
                        busy = true;
                        continue;
                    }
                }
                if matches!(key.code, KeyCode::Char('/' | '2')) {
                    search_origin = Some((home, media_shown, settings_shown));
                    home = false;
                    media_shown = false;
                    settings_shown = false;
                    editing = true;
                    query.clear();
                    suggestions.clear();
                    suggestion_selected = None;
                    suggestion_sent.clear();
                    suggestion_unavailable = false;
                    search_mood = (search_mood + 1) % search_ui::MOODS.len();
                    if settings.rich_search {
                        writeln!(worker.0.stdin.as_mut().unwrap(), "searchhome")?;
                        worker.0.stdin.as_mut().unwrap().flush()?;
                    }
                    query_changed = Instant::now();
                    continue;
                }
                if !home && !media_shown && view == "accounts" && key.code == KeyCode::Delete {
                    if let Some(row) = selection.selected().and_then(|i| tracks.get(i)) {
                        if let Some(userid) = row["userid"].as_str() {
                            delete_account = Some((
                                userid.into(),
                                row["label"].as_str().unwrap_or("账号").into(),
                            ));
                        }
                    }
                    continue;
                }
                if !home && !media_shown && !tracks.is_empty() {
                    let index = selection.selected().unwrap_or(0);
                    match key.code {
                        KeyCode::Down => {
                            selection.select(Some((index + 1) % tracks.len()));
                            continue;
                        }
                        KeyCode::Up => {
                            selection.select(Some((index + tracks.len() - 1) % tracks.len()));
                            continue;
                        }
                        KeyCode::Enter => {
                            busy = true;
                            let input = worker.0.stdin.as_mut().unwrap();
                            let action = if view == "accounts" {
                                "switch"
                            } else if view == "queue" {
                                "queueplay"
                            } else if view == "catalog" && tracks[index]["kind"] != "song" {
                                "openentity"
                            } else if view == "playlists" {
                                "openlist"
                            } else {
                                "play"
                            };
                            writeln!(input, "focus:{}:{}", index, selection.offset())?;
                            writeln!(input, "{}:{}", action, index)?;
                            input.flush()?;
                            continue;
                        }
                        _ => {}
                    }
                }
                if matches!(key.code, KeyCode::Char('f' | 'F'))
                    && !home
                    && !media_shown
                    && matches!(view.as_str(), "tracks" | "catalog" | "history")
                    && !tracks.is_empty()
                    && (view != "catalog"
                        || tracks[selection.selected().unwrap_or(0)]["kind"] == "song")
                {
                    busy = true;
                    let input = worker.0.stdin.as_mut().unwrap();
                    writeln!(input, "favorite:{}", selection.selected().unwrap_or(0))?;
                    input.flush()?;
                    continue;
                }
                if media_shown
                    && !home
                    && !settings_shown
                    && !editing
                    && matches!(key.code, KeyCode::Char('s' | 'S'))
                {
                    drag = None;
                    quality_picker = Some(quality_menu::Picker::new(&settings.quality));
                    continue;
                }
                let command = match key.code {
                    KeyCode::Char('n' | 'N') if !home && !media_shown && view == "queue" => {
                        "queuenext"
                    }
                    KeyCode::Delete if !home && !media_shown && view == "queue" => "queuedelete",
                    KeyCode::Char('n' | 'N') if !home && !media_shown && section_root => {
                        "sectiontoggle"
                    }
                    KeyCode::Char('t' | 'T')
                        if !home && !media_shown && section == "discover" && section_root =>
                    {
                        "sectionranks"
                    }
                    KeyCode::Char('r' | 'R' | '5') => "recommend",
                    KeyCode::Char('d' | 'D' | '6') => "discover",
                    KeyCode::Char('b' | 'B') => "queue",
                    KeyCode::Char('e' | 'E') => "history",
                    KeyCode::Char('s' | 'S') => "quality",
                    KeyCode::Char('o' | 'O') => "order",
                    KeyCode::Char('[') => "prevtrack",
                    KeyCode::Char(']') => "nexttrack",
                    KeyCode::Backspace if !section.is_empty() => "back",
                    KeyCode::Char('g' | 'G')
                        if !section.is_empty()
                            || view == "catalog"
                            || view == "playlists" && section_root =>
                    {
                        "refresh"
                    }
                    KeyCode::Left if media_shown => "seekrelative:-10",
                    KeyCode::Right if media_shown => "seekrelative:10",
                    KeyCode::Char('a' | 'A' | '4') => "accounts",
                    KeyCode::Char('p' | 'P' | '3') => "playlists",
                    KeyCode::Right | KeyCode::PageDown
                        if !home && !media_shown && view != "accounts" =>
                    {
                        "nextpage"
                    }
                    KeyCode::Left | KeyCode::PageUp
                        if !home && !media_shown && view != "accounts" =>
                    {
                        "prevpage"
                    }
                    KeyCode::Char('l' | 'L') => "login",
                    KeyCode::Char('v' | 'V') => "status",
                    KeyCode::Char('c' | 'C') => "claim",
                    _ => continue,
                };
                if command == "login" {
                    login_origin = Some((
                        home,
                        media_shown,
                        settings_shown,
                        editing,
                        needs_login,
                        page_loaded,
                    ));
                    settings_shown = false;
                    media_shown = false;
                }
                if [
                    "recommend",
                    "discover",
                    "queue",
                    "history",
                    "quality",
                    "accounts",
                    "playlists",
                    "status",
                    "claim",
                ]
                .contains(&command)
                {
                    settings_shown = false;
                }
                if !["order", "seekrelative:-10", "seekrelative:10"].contains(&command) {
                    home = false;
                    busy = true;
                    message = "请求中…".into();
                }
                let input = worker.0.stdin.as_mut().unwrap();
                writeln!(input, "{command}")?;
                input.flush()?;
            }
        }
    }
}
fn audio_quality_text(value: &Value) -> String {
    let Some(codec) = value["codec"].as_str() else {
        return "等待音频检测".into();
    };
    let mut parts = vec![codec.to_uppercase()];
    if let Some(rate) = value["sampleRate"].as_u64().filter(|n| *n > 0) {
        parts.push(format!("{} Hz", rate));
    }
    if let Some(bits) = value["bits"].as_u64().filter(|n| *n > 0) {
        parts.push(format!("{} bit", bits));
    }
    parts.join(" · ")
}
fn clock_text(seconds: f64) -> String {
    let seconds = if seconds.is_finite() {
        seconds.max(0.0) as u64
    } else {
        0
    };
    format!("{}:{:02}", seconds / 60, seconds % 60)
}
fn mode_text(mode: &str) -> &str {
    match mode {
        "loop" => "列表循环",
        "shuffle" => "随机播放",
        "single" => "单曲循环",
        _ => "顺序播放",
    }
}
fn render_home(
    frame: &mut ratatui::Frame,
    area: ratatui::layout::Rect,
    account: &str,
    media: &Value,
    quality: &str,
    settings: &settings::Settings,
) -> Option<ratatui::layout::Rect> {
    let parts = Layout::vertical([
        Constraint::Length(4),
        Constraint::Length(if area.width >= 70 { 7 } else { 10 }),
        Constraint::Min(0),
    ])
    .split(area);
    frame.render_widget(
        Paragraph::new(vec![
            Line::styled(
                "  MUSIC FOR YOUR MOMENT",
                Style::default().fg(theme::current().accent),
            ),
            Line::from(format!("  欢迎回来，{}", account)),
        ])
        .block(
            theme::panel()
                .border_type(BorderType::Rounded)
                .border_style(Style::default().fg(theme::section().border)),
        ),
        parts[0],
    );
    let cards = if area.width >= 70 {
        Layout::horizontal([
            Constraint::Percentage(34),
            Constraint::Percentage(33),
            Constraint::Percentage(33),
        ])
        .split(parts[1])
    } else {
        Layout::vertical([
            Constraint::Length(3),
            Constraint::Length(3),
            Constraint::Min(0),
        ])
        .split(parts[1])
    };
    for (i, (title, body)) in [
        (
            " ♡ 为你推荐 · R ",
            "每日歌曲与精选歌单\n让熟悉的旋律遇见新声音",
        ),
        (
            " ◇ 发现音乐 · D ",
            "新歌速递 · 排行榜\n探索 Hi-Res 主题歌单",
        ),
        (" ≡ 我的音乐 · P ", "打开收藏的个人歌单\nB 查看当前播放队列"),
    ]
    .iter()
    .enumerate()
    {
        frame.render_widget(
            Paragraph::new(*body).wrap(Wrap { trim: false }).block(
                theme::panel()
                    .title(*title)
                    .border_type(BorderType::Rounded)
                    .border_style(Style::default().fg(theme::section().border)),
            ),
            cards[i],
        );
    }
    let panel = theme::panel()
        .title(" 正在聆听 ")
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(theme::section().border));
    let inner = panel.inner(parts[2]);
    frame.render_widget(panel, parts[2]);
    let (text_area, art_area) = if inner.width >= 84 && inner.height >= 8 {
        let width = inner
            .width
            .saturating_sub(48)
            .min(52)
            .min(inner.height.saturating_mul(2));
        (
            ratatui::layout::Rect::new(inner.x, inner.y, inner.width - width - 2, inner.height),
            ratatui::layout::Rect::new(inner.right() - width, inner.y, width, inner.height),
        )
    } else if inner.height >= 18 {
        (
            ratatui::layout::Rect::new(inner.x, inner.y, inner.width, 12),
            ratatui::layout::Rect::new(inner.x, inner.y + 12, inner.width, inner.height - 12),
        )
    } else {
        (inner, ratatui::layout::Rect::default())
    };
    frame.render_widget(Paragraph::new(format!("\n ♪ {}\n {}\n\n {} · 请求音质 {} · 应用音量 {}%\n U 切换布局 · I 高清/方块封面 · T 歌词译文\n L 扫码登录 · V 会员状态 · C 领取活动奖励",media["title"].as_str().unwrap_or("选择一首歌，开始聆听"),quality,mode_text(&settings.mode),settings::quality_label(&settings.quality),settings.volume)).wrap(Wrap{trim:false}),text_area);
    home_art::placement(art_area)
}
#[cfg(test)]
fn render_nav(
    frame: &mut ratatui::Frame,
    area: ratatui::layout::Rect,
    sidebar: bool,
    active: &str,
) -> ratatui::layout::Rect {
    controls::navigation(
        frame,
        area,
        sidebar,
        active,
        false,
        &mut controls::Regions::default(),
    )
}
fn fit_selection(selected: usize, scroll: usize, height: u16) -> usize {
    if selected < scroll {
        selected
    } else if selected >= scroll + height.max(1) as usize {
        selected + 1 - height.max(1) as usize
    } else {
        scroll
    }
}
fn home_hits(area: ratatui::layout::Rect, regions: &mut controls::Regions) {
    let parts = Layout::vertical([
        Constraint::Length(4),
        Constraint::Length(if area.width >= 70 { 7 } else { 10 }),
        Constraint::Min(0),
    ])
    .split(area);
    let cards = if area.width >= 70 {
        Layout::horizontal([
            Constraint::Percentage(34),
            Constraint::Percentage(33),
            Constraint::Percentage(33),
        ])
        .split(parts[1])
    } else {
        Layout::vertical([
            Constraint::Length(3),
            Constraint::Length(3),
            Constraint::Min(0),
        ])
        .split(parts[1])
    };
    for (i, key) in ["r", "d", "p"].iter().enumerate() {
        regions.add(cards[i], format!("key:{key}"));
    }
}
fn change_setting(s: &mut settings::Settings, index: usize, forward: bool) -> Option<String> {
    match index {
        31 => {
            s.clear_queues_on_exit = !s.clear_queues_on_exit;
            return Some(format!("queuepolicy:{}", u8::from(s.clear_queues_on_exit)));
        }
        29 => {
            s.kotonoha_enabled = !s.kotonoha_enabled;
            return Some(format!("kotonoha:{}", s.kotonoha_json()));
        }
        30 => {
            s.kotonoha_clock_ms = if forward {
                (s.kotonoha_clock_ms + 250).min(10000)
            } else {
                s.kotonoha_clock_ms.saturating_sub(250).max(250)
            };
            return Some(format!("kotonoha:{}", s.kotonoha_json()));
        }
        24 => s.in_app_notifications = !s.in_app_notifications,
        25 => s.desktop_notifications = !s.desktop_notifications,
        26 => s.track_notifications = !s.track_notifications,
        27 => {
            s.notification_timeout = if forward {
                (s.notification_timeout + 1).min(30)
            } else {
                s.notification_timeout.saturating_sub(1).max(1)
            }
        }
        14 => {
            s.status_rows = if forward {
                (s.status_rows % 3) + 1
            } else {
                ((s.status_rows + 1) % 3) + 1
            }
        }
        15..=23 => {
            let id = settings::STATUS_ITEMS[index - 15].0;
            if let Some(i) = s.status_items.iter().position(|s| s == id) {
                s.status_items.remove(i);
            } else {
                s.status_items.push(id.into());
            }
        }
        13 => s.scale_lyrics = !s.scale_lyrics,
        28 => s.rich_search = !s.rich_search,
        11 => s.large_lyric = !s.large_lyric,
        12 => s.lyric_align = (s.lyric_align + if forward { 1 } else { 2 }) % 3,
        10 => {
            s.theme = (s.theme
                + if forward {
                    1
                } else {
                    theme::palettes().len() - 1
                })
                % theme::palettes().len()
        }
        0 => s.sidebar = !s.sidebar,
        1 => s.hd = !s.hd,
        2 => s.translation = !s.translation,
        3 => s.large_icons = !s.large_icons,
        4 => s.mouse = !s.mouse,
        5 => s.cava_style = (s.cava_style + if forward { 1 } else { 3 }) % 4,
        6 => {
            s.lyric_return = if forward {
                (s.lyric_return + 1).min(15)
            } else {
                s.lyric_return.saturating_sub(1).max(3)
            }
        }
        7 => {
            let modes = ["sequence", "loop", "shuffle", "single"];
            let i = modes.iter().position(|m| *m == s.mode).unwrap_or(0);
            s.mode = modes[(i + if forward { 1 } else { 3 }) % 4].into();
            return Some(format!("mode:{}", s.mode));
        }
        8 => {
            let modes = settings::QUALITIES;
            let i = modes.iter().position(|m| *m == s.quality).unwrap_or(0);
            s.quality = modes[(i + if forward { 1 } else { modes.len() - 1 }) % modes.len()].into();
            return Some(format!("quality:{}", s.quality));
        }
        9 => {
            s.volume = if forward {
                (s.volume + 5).min(100)
            } else {
                s.volume.saturating_sub(5)
            };
            return Some(format!("volume:{}", s.volume));
        }
        _ => {}
    }
    None
}
fn media_columns(area: ratatui::layout::Rect) -> std::rc::Rc<[ratatui::layout::Rect]> {
    let inner = theme::panel().inner(area);
    let columns = Layout::horizontal([
        Constraint::Length(if inner.width >= 65 { 34 } else { 0 }),
        Constraint::Min(1),
        Constraint::Length(if inner.width >= 100 {
            (inner.width.saturating_sub(34) * 45 / 100).clamp(30, 64)
        } else {
            0
        }),
    ])
    .split(inner);
    let mut columns = columns.to_vec();
    if columns[2].width > 0 && columns[1].width >= 8 {
        columns[1].width = columns[1].width.saturating_sub(2);
    }
    columns.into()
}
#[cfg(test)]
fn render_media(
    frame: &mut ratatui::Frame,
    area: ratatui::layout::Rect,
    media: &Value,
    seconds: f64,
    translation: bool,
    hd: bool,
) -> Option<ratatui::layout::Rect> {
    render_media_with_layers(
        frame,
        area,
        media,
        seconds,
        translation,
        hd,
        &mut Vec::new(),
        &mut lyrics::ScrollState::default(),
    )
}
fn render_media_with_layers(
    frame: &mut ratatui::Frame,
    area: ratatui::layout::Rect,
    media: &Value,
    seconds: f64,
    translation: bool,
    hd: bool,
    lyric_layers: &mut Vec<kitty::LargeLine>,
    lyric_scroll: &mut lyrics::ScrollState,
) -> Option<ratatui::layout::Rect> {
    let block = theme::panel()
        .border_type(BorderType::Rounded)
        .title(format!(
            "{} · {}",
            media["title"].as_str().unwrap_or("正在播放"),
            media["lyrics"][0]["source"]
                .as_str()
                .unwrap_or("歌词加载中")
        ));
    frame.render_widget(block, area);
    let columns = media_columns(area);
    let cover_height = columns[0].height.min(16);
    let cover_area =
        ratatui::layout::Rect::new(columns[0].x, columns[0].y, columns[0].width, cover_height);
    visualizer::draw(
        frame,
        columns[2],
        &media["spectrum"],
        media["cavaStyle"].as_u64().unwrap_or(0) as u8,
    );
    let has_hd = hd
        && media["png"].as_str().is_some_and(|s| !s.is_empty())
        && columns[0].width > 0
        && cover_height > 0;
    let image_area = if has_hd {
        Some(ratatui::layout::Rect::new(
            columns[0].x,
            columns[0].y,
            32.min(columns[0].width),
            cover_height,
        ))
    } else {
        None
    };
    if let Some(pixels) = media["pixels"].as_array().filter(|_| !has_hd) {
        if pixels.len() == 3072 && columns[0].width > 0 {
            let mut lines = Vec::new();
            for y in (0..32).step_by(2) {
                let mut spans = Vec::new();
                for x in 0..32 {
                    let at = |row: usize| {
                        let i = (row * 32 + x) * 3;
                        Color::Rgb(
                            pixels[i].as_u64().unwrap_or(0) as u8,
                            pixels[i + 1].as_u64().unwrap_or(0) as u8,
                            pixels[i + 2].as_u64().unwrap_or(0) as u8,
                        )
                    };
                    spans.push(Span::styled("▀", Style::default().fg(at(y)).bg(at(y + 1))));
                }
                lines.push(Line::from(spans));
            }
            frame.render_widget(Paragraph::new(lines), cover_area);
        }
    }
    let lyric_block = theme::block(theme::current().lyric_panel)
        .style(Style::default().bg(theme::current().lyric_panel.background))
        .title(if media["lyricFirst"].is_number() {
            " 歌词浏览 · 单击归位 "
        } else {
            " 逐字歌词 · 自动跟随 "
        })
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(theme::current().lyric_panel.border));
    let lyric_area = lyrics::content_area(columns[1]);
    frame.render_widget(lyric_block, columns[1]);
    lyrics::render(
        frame,
        lyric_area,
        media,
        seconds,
        translation,
        lyric_layers,
        lyric_scroll,
    );
    image_area
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quality_settings_cycle_both_directions_and_preserve_request_values() {
        let mut s = settings::Settings::default();
        for value in settings::QUALITIES
            .iter()
            .cycle()
            .skip(1)
            .take(settings::QUALITIES.len())
        {
            assert_eq!(
                change_setting(&mut s, 8, true),
                Some(format!("quality:{value}"))
            );
            assert_eq!(&s.quality, value);
        }
        assert_eq!(
            change_setting(&mut s, 8, false),
            Some("quality:viper_atmos".into())
        );
        assert_eq!(settings::quality_label(&s.quality), "蝰蛇全景声");
    }
    #[test]
    fn navigation_and_translation_switches_change_rendered_output() {
        use ratatui::{Terminal, backend::TestBackend};
        let mut terminal = Terminal::new(TestBackend::new(110, 28)).unwrap();
        let mut left = ratatui::layout::Rect::default();
        let mut top = left;
        terminal
            .draw(|f| {
                left = render_nav(f, f.area(), true, "home");
            })
            .unwrap();
        terminal
            .draw(|f| {
                top = render_nav(f, f.area(), false, "home");
            })
            .unwrap();
        assert_eq!(left.x, 22);
        assert_eq!(left.y, 0);
        assert_eq!(top.x, 0);
        assert_eq!(top.y, 4);
        let media = serde_json::json!({"title":"Song","lyrics":[{"start":0,"duration":1000,"translation":"译文","words":[{"text":"Hello","start":0,"duration":1000}]}]});
        for enabled in [true, false] {
            terminal
                .draw(|f| {
                    render_media(f, f.area(), &media, 0.5, enabled, false);
                })
                .unwrap();
            assert_eq!(
                terminal
                    .backend()
                    .buffer()
                    .content
                    .iter()
                    .any(|c| c.symbol() == "译"),
                enabled
            );
        }
    }
    #[test]
    fn cover_and_lyrics_render_at_different_terminal_sizes() {
        use ratatui::{Terminal, backend::TestBackend};
        let media = serde_json::json!({"title":"测试播放", "pixels":vec![128;3072],"lyrics":[{"start":0,"duration":1000,"words":[{"start":0,"duration":500,"text":"你好"}]}]});
        for width in [20, 80] {
            let mut terminal = Terminal::new(TestBackend::new(width, 20)).unwrap();
            terminal
                .draw(|f| {
                    render_media(f, f.area(), &media, 0.3, true, false);
                })
                .unwrap();
            let buffer = terminal.backend().buffer();
            assert!(buffer.content.iter().any(|c| c.symbol() == "你"));
            if width == 80 {
                assert!(buffer.content.iter().any(|c| c.symbol() == "▀"));
            }
        }
    }
    #[test]
    fn spectrum_expands_with_window_without_crowding_lyrics() {
        let normal = media_columns(ratatui::layout::Rect::new(0, 0, 130, 30));
        let wide = media_columns(ratatui::layout::Rect::new(0, 0, 190, 30));
        assert!(normal[2].width > 24);
        assert!(wide[2].width > normal[2].width);
        assert!(normal[1].width >= 30 && wide[1].width >= 30);
        assert_eq!(normal[0].width, wide[0].width);
    }
    #[test]
    fn wide_playback_shows_quality_volume_and_real_spectrum() {
        use ratatui::{Terminal, backend::TestBackend};
        let media = serde_json::json!({"title":"Test","quality":"FLAC · 44100 Hz · 16 bit","volume":35,"spectrum":{"bars":vec![255;16]}});
        let mut terminal = Terminal::new(TestBackend::new(130, 30)).unwrap();
        terminal
            .draw(|f| {
                render_media(f, f.area(), &media, 0.0, true, false);
            })
            .unwrap();
        let buffer = terminal.backend().buffer();
        let text = buffer
            .content
            .iter()
            .map(|c| c.symbol())
            .collect::<String>();
        assert!(!text.contains("FLAC"), "quality belongs in status bar");
        assert!(
            !text.contains("35%"),
            "volume belongs in the bottom status bar"
        );
        assert!(!text.contains("TRACK INFO"));
        assert!(text.contains("CAVA"));
        assert!(buffer.content.iter().any(|cell| cell.symbol() == "█"));
        for width in [1, 20, 80, 130] {
            for height in [1, 5, 15] {
                let mut small = Terminal::new(TestBackend::new(width, height)).unwrap();
                small
                    .draw(|f| {
                        render_media(f, f.area(), &media, 0.0, true, false);
                    })
                    .unwrap();
            }
        }
    }
    #[test]
    fn dashboard_and_navigation_expose_discovery_at_both_layouts() {
        use ratatui::{Terminal, backend::TestBackend};
        for width in [80, 120, 160] {
            for sidebar in [false, true] {
                let mut terminal = Terminal::new(TestBackend::new(width, 40)).unwrap();
                terminal
                    .draw(|f| {
                        let area = render_nav(f, f.area(), sidebar, "recommend");
                        render_home(
                            f,
                            area,
                            "测试账号",
                            &serde_json::json!({}),
                            "FLAC",
                            &settings::Settings::default(),
                        );
                    })
                    .unwrap();
                let content = terminal
                    .backend()
                    .buffer()
                    .content
                    .iter()
                    .map(|c| c.symbol())
                    .collect::<String>();
                assert!(content.replace(' ', "").contains("推荐"));
                assert!(content.replace(' ', "").contains("发现"));
                assert!(content.replace(' ', "").contains("队列"));
            }
        }
        assert_eq!(
            audio_quality_text(
                &serde_json::json!({"codec":"mp3","sampleRate":44100,"bits":null,"bitRate":320000})
            ),
            "MP3 · 44100 Hz"
        );
    }
    #[test]
    fn qr_has_quiet_zone_and_uniform_width() {
        let lines =
            qr_lines("https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=test").unwrap();
        assert!(lines[0].trim().is_empty());
        assert!(lines[1].trim().is_empty());
        assert!(lines.iter().all(|l| l.starts_with("    ")
            && l.ends_with("    ")
            && l.chars().count() == lines[0].chars().count()));
    }
}
