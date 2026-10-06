use crate::theme;
use crate::{clock_text, mode_text, settings::Settings};
use ratatui::{
    Frame,
    layout::{Alignment, Constraint, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, Paragraph},
};
use serde_json::Value;
#[derive(Clone)]
pub struct Hit {
    pub rect: Rect,
    pub action: String,
}
#[derive(Default)]
pub struct Regions {
    pub hits: Vec<Hit>,
    pub progress: Rect,
    pub lyrics: Rect,
    pub settings: Rect,
    pub help: Rect,
    pub theme_menu: Rect,
    pub sort_menu: Rect,
    pub list: Rect,
    pub profile: Rect,
    pub icons: Vec<(Rect, String)>,
    pub lyric_text: Vec<crate::kitty::LargeLine>,
}
impl Regions {
    pub fn add(&mut self, rect: Rect, action: impl Into<String>) {
        if rect.width > 0 && rect.height > 0 {
            self.hits.push(Hit {
                rect,
                action: action.into(),
            });
        }
    }
    pub fn hit(&self, x: u16, y: u16) -> Option<String> {
        self.hits
            .iter()
            .rev()
            .find(|h| contains(h.rect, x, y))
            .map(|h| h.action.clone())
    }
}
pub fn contains(r: Rect, x: u16, y: u16) -> bool {
    x >= r.x && x < r.right() && y >= r.y && y < r.bottom()
}
pub fn seek_fraction(r: Rect, x: u16) -> f64 {
    if r.width <= 1 {
        return 0.0;
    }
    x.saturating_sub(r.x).min(r.width - 1) as f64 / (r.width - 1) as f64
}
pub fn button(f: &mut Frame, r: Rect, label: &str, action: &str, regions: &mut Regions) {
    f.render_widget(
        Paragraph::new(label).alignment(Alignment::Center).style(
            Style::default()
                .fg(theme::current().accent)
                .bg(theme::current().surface),
        ),
        r,
    );
    regions.add(r, action);
}
fn colored_icon(
    f: &mut Frame,
    r: Rect,
    glyph: &str,
    large: bool,
    color: Color,
    regions: &mut Regions,
) {
    f.render_widget(Block::default().style(Style::default().fg(color)), r);
    if large && crate::kitty::supported() && r.height >= 2 && r.width >= 4 {
        regions
            .icons
            .push((Rect::new(r.x, r.y, 4, 2), glyph.into()));
    } else {
        f.render_widget(Paragraph::new(glyph).style(Style::default().fg(color)), r);
    }
}
pub fn footer_height(settings: &Settings) -> u16 {
    settings.status_rows as u16
        + if settings.status_items.iter().any(|s| s == "lyrics") {
            2
        } else {
            0
        }
        + 1
}
pub fn bitrate_text(value: Option<f64>) -> String {
    value
        .filter(|v| v.is_finite() && *v > 0.0)
        .map(|v| format!("{:.0} kbps", v / 1000.0))
        .unwrap_or_else(|| "—".into())
}
pub fn footer(
    f: &mut Frame,
    area: Rect,
    media: &Value,
    seconds: f64,
    quality: &str,
    status: &str,
    _message: &str,
    settings: &Settings,
    drag: Option<f64>,
    regions: &mut Regions,
) {
    if area.width == 0 || area.height == 0 {
        return;
    }
    let theme = theme::current();
    f.render_widget(
        Block::default().style(Style::default().bg(theme.footer[0])),
        area,
    );
    let song = media["song"]
        .as_str()
        .or(media["title"].as_str())
        .unwrap_or("未播放");
    let artist = media["artist"].as_str().unwrap_or("");
    let mut x = area.x;
    let rows = settings
        .status_rows
        .min(area.height.saturating_sub(1) as u8) as u16;
    let status_area = Rect::new(area.x, area.bottom() - rows, area.width, rows);
    f.render_widget(
        Block::default().style(Style::default().bg(theme.status[0])),
        status_area,
    );
    let mut y = status_area.y;
    let lyric_rows =
        if settings.status_items.iter().any(|s| s == "lyrics") && area.height >= rows + 3 {
            2
        } else {
            0
        };
    let mut collapsed = false;
    for id in &settings.status_items {
        if id == "lyrics" {
            continue;
        }
        let segments: Vec<(String, &str, ratatui::style::Color)> = match id.as_str() {
            "controls" => vec![
                (" \u{f048} ".into(), "[", theme.status[1]),
                (
                    format!(
                        " {} ",
                        if status == "Playing" {
                            "\u{f04c}"
                        } else {
                            "\u{f04b}"
                        }
                    ),
                    " ",
                    theme.status[1],
                ),
                (" \u{f051} ".into(), "]", theme.status[1]),
            ],
            "song" => vec![(
                format!(" \u{f001} {song} · {artist} "),
                "\t",
                theme.status[2],
            )],
            "quality" => vec![(format!(" {quality} "), "s", theme.status[3])],
            "bitrate" => vec![(
                format!(" 实时 {} ", bitrate_text(media["liveBitrate"].as_f64())),
                "",
                theme.status[4],
            )],
            "volume" => vec![
                (" − ".into(), "-", theme.status[5]),
                (
                    format!(" \u{f028} {}% ", settings.volume),
                    "",
                    theme.status[5],
                ),
                (" + ".into(), "+", theme.status[5]),
            ],
            "mode" => vec![(
                format!(" {} ", mode_text(&settings.mode)),
                "o",
                theme.status[6],
            )],
            "queue" => vec![(" \u{f0cb} 队列 ".into(), "b", theme.status[7])],
            "time" => vec![(
                format!(
                    " {}/{} ",
                    clock_text(seconds),
                    clock_text(media["duration"].as_f64().unwrap_or(0.0))
                ),
                "",
                theme.status[8],
            )],
            _ => vec![],
        };
        let total = segments
            .iter()
            .map(|(text, _, _)| Line::from(text.as_str()).width() as u16)
            .sum::<u16>();
        let target_width = if id == "song" {
            total.min((area.width / 3).max(12))
        } else if id == "quality" {
            total.min((area.width / 3).max(15))
        } else {
            total
        };
        if x > area.x && x - area.x + target_width > area.width {
            y += 1;
            x = area.x;
        }
        if y >= status_area.bottom() {
            collapsed = true;
            continue;
        }
        let mut left = target_width.min(area.width);
        for (text, key, color) in segments {
            let width = (Line::from(text.as_str()).width() as u16).min(left);
            if width == 0 {
                continue;
            }
            let r = Rect::new(x, y, width, 1);
            f.render_widget(Paragraph::new(text).style(Style::default().fg(color)), r);
            if !key.is_empty() {
                regions.add(r, format!("key:{key}"));
            }
            x += width;
            left -= width;
        }
        if x < area.right() {
            f.render_widget(
                Paragraph::new("│").style(Style::default().fg(theme.status[10])),
                Rect::new(x, y, 1, 1),
            );
            x += 1;
        }
    }
    if collapsed && rows > 0 {
        let r = Rect::new(
            area.right().saturating_sub(3).max(area.x),
            status_area.bottom() - 1,
            3.min(area.width),
            1,
        );
        f.render_widget(
            Paragraph::new(" ⋯ ").style(Style::default().fg(theme.status[12])),
            r,
        );
        regions.add(r, "settings-page:3");
    }
    if lyric_rows > 0 {
        let original = crate::lyrics::current(media, seconds)
            .map(crate::lyrics::text)
            .unwrap_or_default();
        let translation = if settings.translation {
            crate::lyrics::current(media, seconds)
                .and_then(|l| l["translation"].as_str())
                .unwrap_or("")
        } else {
            ""
        };
        let r = Rect::new(area.x + 1, area.y, area.width.saturating_sub(2), 2);
        f.render_widget(
            Paragraph::new(vec![
                Line::styled(original, Style::default().fg(theme.footer[1])),
                Line::styled(translation, Style::default().fg(theme.footer[2])),
            ]),
            r,
        );
        regions.add(r, "key:\t");
    }
    let duration = media["duration"].as_f64().unwrap_or(0.0);
    let ratio = drag
        .unwrap_or(if duration > 0.0 {
            seconds / duration
        } else {
            0.0
        })
        .clamp(0.0, 1.0);
    let progress = Layout::horizontal([
        Constraint::Length(7),
        Constraint::Min(1),
        Constraint::Length(8),
    ])
    .split(Rect::new(area.x, status_area.y - 1, area.width, 1));
    f.render_widget(
        Paragraph::new(clock_text(if drag.is_some() {
            duration * ratio
        } else {
            seconds
        }))
        .style(Style::default().fg(theme.footer[3])),
        progress[0],
    );
    f.render_widget(
        Paragraph::new(clock_text(duration))
            .alignment(Alignment::Right)
            .style(Style::default().fg(theme.footer[4])),
        progress[2],
    );
    let r = progress[1];
    regions.progress = r;
    let at = (ratio * r.width.saturating_sub(1) as f64).round() as u16;
    let spans = (0..r.width)
        .map(|x| {
            Span::styled(
                if x == at {
                    "●"
                } else if x < at {
                    "━"
                } else {
                    "─"
                },
                Style::default().fg(if x <= at {
                    if x == at {
                        theme::current().progress[2]
                    } else {
                        theme::current().progress[1]
                    }
                } else {
                    theme::current().progress[0]
                }),
            )
        })
        .collect::<Vec<_>>();
    f.render_widget(Paragraph::new(Line::from(spans)), r);
}
pub const NAV: [(&str, &str, &str, &str); 10] = [
    ("home", "主页", "h", "\u{f015}"),
    ("recommend", "推荐", "r", "\u{f004}"),
    ("discover", "发现", "d", "\u{f14e}"),
    ("tracks", "搜索", "/", "\u{f002}"),
    ("playlists", "歌单", "p", "\u{f03a}"),
    ("accounts", "账号", "a", "\u{f007}"),
    ("playing", "播放", "\t", "\u{f001}"),
    ("queue", "队列", "b", "\u{f0cb}"),
    ("history", "历史", "e", "\u{f1da}"),
    ("settings", "设置", "?", "\u{f013}"),
];
pub fn navigation(
    f: &mut Frame,
    area: Rect,
    side: bool,
    active: &str,
    large: bool,
    regions: &mut Regions,
) -> Rect {
    let side = side && area.width >= 80;
    let parts = if side {
        Layout::horizontal([Constraint::Length(22), Constraint::Min(1)]).split(area)
    } else {
        Layout::vertical([
            Constraint::Length(if area.width < 100 { 6 } else { 4 }),
            Constraint::Min(1),
        ])
        .split(area)
    };
    let block = theme::panel()
        .style(Style::default().bg(theme::current().nav_background))
        .title(" KUGOU / LITE ")
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(theme::current().nav_border));
    let inner = block.inner(parts[0]);
    f.render_widget(block, parts[0]);
    for (i, (id, name, key, glyph)) in NAV.iter().enumerate() {
        let r = if side {
            let h = (inner.height / NAV.len() as u16).clamp(1, 3);
            Rect::new(inner.x, inner.y + i as u16 * h, inner.width, h).intersection(inner)
        } else {
            let cols = if area.width < 100 {
                5
            } else {
                NAV.len() as u16
            };
            let w = inner.width / cols;
            Rect::new(
                inner.x + (i as u16 % cols) * w,
                inner.y + (i as u16 / cols) * 2,
                w,
                2,
            )
            .intersection(inner)
        };
        if r.height == 0 || r.width == 0 {
            continue;
        }
        let palette = theme::current();
        let hue = theme::navigation_color(palette, id);
        let selected = active == *id;
        let color = hue;
        if active == *id {
            f.render_widget(
                Block::default()
                    .style(Style::default().bg(palette.nav_selected[theme::section_index(id)])),
                r,
            );
        }
        let icon_width = if large && r.height >= 2 { 5 } else { 3 };
        colored_icon(
            f,
            Rect::new(
                r.x + 1,
                r.y,
                4.min(r.width.saturating_sub(1)),
                r.height.min(2),
            ),
            glyph,
            large,
            color,
            regions,
        );
        let text = Rect::new(
            r.x + icon_width,
            r.y,
            r.width.saturating_sub(icon_width),
            r.height,
        );
        let mut label = vec![Span::styled(
            *name,
            Style::default().fg(color).add_modifier(if selected {
                Modifier::BOLD
            } else {
                Modifier::empty()
            }),
        )];
        if side {
            let shortcut = if *key == "\t" {
                "Tab".to_string()
            } else {
                key.to_uppercase()
            };
            label.push(Span::styled(
                format!("  [{shortcut}]"),
                Style::default().fg(theme::current().muted),
            ));
        }
        f.render_widget(Paragraph::new(Line::from(label)), text);
        if selected {
            f.render_widget(
                Paragraph::new(vec![Line::from("▎"); r.height as usize])
                    .style(Style::default().fg(hue)),
                Rect::new(r.x, r.y, 1, r.height),
            );
        }
        regions.add(r, format!("key:{key}"));
    }
    parts[1]
}
pub fn settings_rows(s: &Settings) -> Vec<String> {
    let mut rows = vec![
        format!(
            "导航布局      {}",
            if s.sidebar { "左侧栏" } else { "顶栏" }
        ),
        format!("高清封面      {}", if s.hd { "开启" } else { "关闭" }),
        format!(
            "歌词翻译      {}",
            if s.translation { "显示" } else { "隐藏" }
        ),
        format!(
            "放大图标      {}",
            if s.large_icons {
                "2 倍 · Kitty"
            } else {
                "标准"
            }
        ),
        format!(
            "鼠标操作      {}",
            if s.mouse {
                "开启"
            } else {
                "关闭（按 ? 回到设置）"
            }
        ),
        format!(
            "CAVA 样式     {}",
            ["极光柱状", "镜像频谱", "点阵丝带", "环形脉冲"][s.cava_style as usize]
        ),
        format!("歌词自动归位  {} 秒", s.lyric_return),
        format!("播放顺序      {}", mode_text(&s.mode)),
        format!(
            "请求音质      {}",
            crate::settings::quality_label(&s.quality)
        ),
        format!("应用音量      {}%", s.volume),
        format!(
            "颜色主题      {}/{} · {}  › Enter 选择",
            s.theme + 1,
            theme::palettes().len(),
            theme::palettes()[s.theme].name
        ),
        format!(
            "当前歌词放大  {}（含译文）",
            if s.large_lyric { "开启" } else { "关闭" }
        ),
        format!(
            "歌词排版      {}",
            ["靠左", "居中", "靠右"][s.lyric_align as usize]
        ),
        format!(
            "歌词字号缩放  {}",
            if s.scale_lyrics {
                "开启 · Kitty"
            } else {
                "关闭 · 标准字号"
            }
        ),
    ];
    rows.push(format!("状态栏行数    {}", s.status_rows));
    rows.extend(crate::settings::STATUS_ITEMS.iter().map(|(id, name)| {
        format!(
            "{}  {}",
            if s.status_items.iter().any(|s| s == id) {
                "✓"
            } else {
                "○"
            },
            name
        )
    }));
    rows.extend([
        format!(
            "软件内通知    {}",
            if s.in_app_notifications {
                "开启"
            } else {
                "关闭"
            }
        ),
        format!(
            "Linux 桌面通知 {}",
            if s.desktop_notifications {
                "开启"
            } else {
                "关闭"
            }
        ),
        format!(
            "切歌通知      {}",
            if s.track_notifications {
                "开启"
            } else {
                "关闭"
            }
        ),
        format!("通知显示时间  {} 秒", s.notification_timeout),
    ]);
    rows.push(format!(
        "搜索界面      {}",
        if s.rich_search {
            "丰富 · 独立界面"
        } else {
            "简约 · 顶栏"
        }
    ));
    rows.push(format!(
        "Kotonoha 桌面歌词  {}",
        if s.kotonoha_enabled {
            "开启"
        } else {
            "关闭"
        }
    ));
    rows.push(format!("桌面歌词校准间隔  {} ms", s.kotonoha_clock_ms));
    rows
}
pub const SETTINGS_PAGES: [&str; 6] = ["外观", "歌词", "播放", "状态栏", "快捷键 / 配置", "通知"];
pub fn settings_indices(s: &Settings, page: usize) -> Vec<usize> {
    match page {
        0 => vec![0, 1, 3, 4, 10, 28],
        1 => vec![2, 6, 11, 12, 13, 29, 30],
        2 => vec![5, 7, 8, 9],
        3 => {
            let mut ids = vec![14];
            for id in &s.status_items {
                if let Some(i) = crate::settings::STATUS_ITEMS
                    .iter()
                    .position(|(key, _)| key == id)
                {
                    ids.push(15 + i);
                }
            }
            for i in 0..crate::settings::STATUS_ITEMS.len() {
                if !ids.contains(&(15 + i)) {
                    ids.push(15 + i);
                }
            }
            ids
        }
        5 => vec![24, 25, 26, 27],
        _ => vec![],
    }
}
pub fn settings_page(
    f: &mut Frame,
    area: Rect,
    s: &Settings,
    page: usize,
    selected: usize,
    scroll: usize,
    help_scroll: u16,
    regions: &mut Regions,
) {
    let block = theme::panel().title(" \u{f013} 设置与快捷键 · PgUp/PgDn 分页 · 1–6 分类 ");
    let inner = block.inner(area);
    f.render_widget(block, area);
    let content = if inner.width >= 85 {
        let parts = Layout::horizontal([Constraint::Length(20), Constraint::Min(0)]).split(inner);
        for (i, name) in SETTINGS_PAGES.iter().enumerate() {
            let r = Rect::new(parts[0].x, parts[0].y + i as u16 * 2, parts[0].width, 2)
                .intersection(parts[0]);
            f.render_widget(
                Paragraph::new(format!(" {} {}", i + 1, name)).style(
                    Style::default()
                        .fg(if i == page {
                            theme::current().accent
                        } else {
                            theme::current().muted
                        })
                        .bg(if i == page {
                            theme::current().surface
                        } else {
                            theme::current().background
                        }),
                ),
                r,
            );
            regions.add(r, format!("settings-page:{i}"));
        }
        parts[1]
    } else {
        let parts = Layout::vertical([Constraint::Length(2), Constraint::Min(0)]).split(inner);
        let cells = Layout::horizontal([Constraint::Ratio(1, 6); 6]).split(parts[0]);
        for (i, name) in SETTINGS_PAGES.iter().enumerate() {
            f.render_widget(
                Paragraph::new(format!("{} {}", i + 1, name)).style(Style::default().fg(
                    if i == page {
                        theme::current().accent
                    } else {
                        theme::current().muted
                    },
                )),
                cells[i],
            );
            regions.add(cells[i], format!("settings-page:{i}"));
        }
        parts[1]
    };
    let parts = Layout::vertical([
        Constraint::Length(2),
        Constraint::Min(0),
        Constraint::Length(2),
    ])
    .split(content);
    f.render_widget(
        Paragraph::new(format!(
            " {} · {}/{}",
            SETTINGS_PAGES[page],
            page + 1,
            SETTINGS_PAGES.len()
        ))
        .style(Style::default().fg(theme::current().accent)),
        parts[0],
    );
    regions.settings = parts[1];
    if page == 4 {
        regions.help = parts[1];
        f.render_widget(Paragraph::new(format!("配置：{}\n主题：{}\n--import-config / --export-config + 路径\n--import-theme / --export-theme + 路径\n\nEsc 返回 · H/F2 主页 · Q 退出 · ? 设置\n/ 搜索 · R 推荐 · D 发现 · P 歌单\n推荐/发现：N 歌曲/歌单 · 发现 T 排行榜\n搜索：N 歌曲/歌单/专辑/歌手\n歌手：N 热门单曲/单曲/专辑 · J 资料 · ,/. 照片\n资料：1–5 / N / ←→ 分类 · ↑↓ / 滚轮浏览\nA 账号 · L 扫码 · Delete 删除账号\nTab 播放页 · 空格 暂停/继续\n[ / ] 上一首 / 下一首\n←→ 翻页 / 播放页跳转 10 秒\nB 队列 · O 顺序 · S 音质 · F 收藏\n+ / - 应用音量 · U 布局 · I 封面 · T 翻译\nV 会员 · C 领取 · G 刷新 · Z 歌单排序\n\n进度条可点击、拖动；歌词滚轮浏览\n设置自动保存；Shift↑↓ 调整状态栏板块顺序",crate::settings::Settings::file().display(),crate::settings::directory().join("theme.json").display())).scroll((help_scroll,0)).style(Style::default().fg(theme::current().muted)),parts[1]);
    } else {
        let rows = settings_rows(s);
        let ids = settings_indices(s, page);
        for (i, id) in ids
            .iter()
            .enumerate()
            .skip(scroll)
            .take(parts[1].height as usize)
        {
            let r = Rect::new(
                parts[1].x,
                parts[1].y + (i - scroll) as u16,
                parts[1].width,
                1,
            );
            f.render_widget(
                Paragraph::new(format!(
                    " {} {}",
                    if i == selected { "›" } else { " " },
                    rows[*id]
                ))
                .style(
                    Style::default()
                        .fg(if i == selected {
                            theme::current().accent
                        } else {
                            theme::current().foreground
                        })
                        .bg(if i == selected {
                            theme::current().surface
                        } else {
                            theme::current().background
                        }),
                ),
                r,
            );
            regions.add(r, format!("setting:{id}"));
        }
    }
    f.render_widget(
        Paragraph::new(if page == 3 {
            "Enter 显示/隐藏 · Shift↑↓ 调整板块顺序"
        } else {
            "↑↓ 选择 · Enter/←→ 修改 · PgUp/PgDn 分类"
        })
        .style(Style::default().fg(theme::current().muted)),
        parts[2],
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::{Terminal, backend::TestBackend};
    #[test]
    fn footer_hitboxes_and_progress_are_visible_and_clamped() {
        for width in [32, 80, 140] {
            let mut terminal = Terminal::new(TestBackend::new(width, 7)).unwrap();
            let mut regions = Regions::default();
            terminal
                .draw(|f| {
                    footer(
                        f,
                        f.area(),
                        &serde_json::json!({"song":"Song","artist":"Artist","duration":180}),
                        45.0,
                        "FLAC · 44100 Hz",
                        "Playing",
                        "Ready",
                        &Settings::default(),
                        None,
                        &mut regions,
                    )
                })
                .unwrap();
            assert!(regions.hits.iter().any(|h| h.action == "key: "));
            assert!(regions.hits.iter().any(|h| h.action == "key:["));
            assert!(regions.hits.iter().any(|h| h.action == "key:]"));
            assert_eq!(
                regions.progress.y, 4,
                "progress belongs above the two bottom status rows"
            );
            assert!(
                regions
                    .hits
                    .iter()
                    .filter(|h| matches!(h.action.as_str(), "key:[" | "key: " | "key:]"))
                    .all(|h| h.rect.y >= 5)
            );
            assert_eq!(seek_fraction(regions.progress, 0), 0.0);
            assert_eq!(seek_fraction(regions.progress, u16::MAX), 1.0);
            assert!(contains(
                regions.progress,
                regions.progress.x,
                regions.progress.y
            ));
            for hit in &regions.hits {
                assert!(hit.rect.right() <= width);
                assert!(hit.rect.bottom() <= 7);
            }
        }
    }
    #[test]
    fn navigation_icons_match_section_colors_and_selected_background() {
        let mut terminal = Terminal::new(TestBackend::new(140, 35)).unwrap();
        let mut regions = Regions::default();
        terminal
            .draw(|f| {
                navigation(f, f.area(), true, "recommend", true, &mut regions);
            })
            .unwrap();
        let buffer = terminal.backend().buffer();
        let selected = regions
            .hits
            .iter()
            .find(|h| h.action == "key:r")
            .unwrap()
            .rect;
        let other = regions
            .hits
            .iter()
            .find(|h| h.action == "key:d")
            .unwrap()
            .rect;
        let icon = buffer.cell((selected.x + 1, selected.y)).unwrap();
        let label = buffer.cell((selected.x + 5, selected.y)).unwrap();
        assert_eq!(icon.fg, label.fg);
        assert_ne!(label.fg, buffer.cell((other.x + 5, other.y)).unwrap().fg);
        assert_ne!(label.bg, buffer.cell((other.x + 5, other.y)).unwrap().bg);
    }
    #[test]
    fn mouse_nav_and_settings_targets_match_rendered_layouts() {
        for width in [40, 80, 140] {
            for side in [false, true] {
                let mut terminal = Terminal::new(TestBackend::new(width, 35)).unwrap();
                let mut r = Regions::default();
                terminal
                    .draw(|f| {
                        let body = navigation(f, f.area(), side, "settings", false, &mut r);
                        settings_page(f, body, &Settings::default(), 2, 0, 0, 0, &mut r);
                    })
                    .unwrap();
                let setting = r.hits.iter().find(|h| h.action == "setting:5").unwrap();
                assert_eq!(
                    r.hit(setting.rect.x, setting.rect.y),
                    Some("setting:5".into())
                );
                assert!(r.hits.iter().any(|h| h.action == "key:?"));
            }
        }
    }
}
