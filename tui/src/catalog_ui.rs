use crate::{collections, controls, theme};
use ratatui::{
    Frame,
    layout::{Constraint, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{BorderType, ListItem, Paragraph, Wrap},
};
use serde_json::Value;
pub const SEARCH_TYPES: [&str; 4] = ["song", "playlist", "album", "artist"];
pub const ARTIST_TABS: [&str; 3] = ["heat", "songs", "albums"];
pub const PROFILE_TABS: [&str; 5] = ["简介", "基本资料", "演艺经历", "主要作品", "荣誉记录"];
fn count(value: &Value) -> String {
    value
        .as_f64()
        .map(|v| {
            if v >= 10000.0 {
                format!("{:.1}万", v / 10000.0)
            } else {
                format!("{v:.0}")
            }
        })
        .unwrap_or_else(|| "未提供".into())
}
fn tabs(
    frame: &mut Frame,
    area: Rect,
    labels: &[&str],
    values: &[&str],
    active: &str,
    prefix: &str,
    regions: &mut controls::Regions,
) {
    if labels.is_empty() || area.width == 0 || area.height == 0 {
        return;
    }
    let block = theme::panel().border_type(BorderType::Rounded);
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let width = inner.width / labels.len() as u16;
    for (i, label) in labels.iter().enumerate() {
        let rect = Rect::new(
            inner.x + i as u16 * width,
            inner.y,
            width,
            inner.height.min(1),
        );
        controls::button(
            frame,
            rect,
            &format!("{} {label}", if active == values[i] { "●" } else { "○" }),
            &format!("catalog:{prefix}:{}", values[i]),
            regions,
        );
    }
}
pub fn layout(
    frame: &mut Frame,
    area: Rect,
    mode: &str,
    search_type: &str,
    artist_tab: &str,
    profile_tab: usize,
    info: &Value,
    hd: bool,
    regions: &mut controls::Regions,
) -> (Rect, Option<Rect>) {
    if mode == "search" {
        let p = Layout::vertical([Constraint::Length(3), Constraint::Min(0)]).split(area);
        tabs(
            frame,
            p[0],
            &["歌曲 [N]", "歌单", "专辑", "歌手"],
            &SEARCH_TYPES,
            search_type,
            "searchtype",
            regions,
        );
        return (p[1], None);
    }
    if mode == "profile" {
        let p = Layout::vertical([
            Constraint::Length(2),
            Constraint::Length(3),
            Constraint::Min(0),
        ])
        .split(area);
        frame.render_widget(
            Paragraph::new(format!(
                " {} · 歌手资料  /  N 切换资料 · Esc 返回歌手",
                info["name"].as_str().unwrap_or("歌手")
            ))
            .style(
                Style::default()
                    .fg(theme::current().accent)
                    .add_modifier(Modifier::BOLD),
            ),
            p[0],
        );
        tabs(
            frame,
            p[1],
            &PROFILE_TABS,
            &["0", "1", "2", "3", "4"],
            &profile_tab.to_string(),
            "profiletab",
            regions,
        );
        return (p[2], None);
    }
    if mode != "artist" {
        return (area, None);
    }
    let parts = Layout::horizontal([
        Constraint::Length(if area.width >= 70 { 36 } else { 0 }),
        Constraint::Length(if area.width >= 70 { 1 } else { 0 }),
        Constraint::Min(30),
    ])
    .split(area);
    let image = artist_card(frame, parts[0], info, hd, regions);
    let p = Layout::vertical([
        Constraint::Length(2),
        Constraint::Length(3),
        Constraint::Min(0),
    ])
    .split(parts[2]);
    frame.render_widget(
        Paragraph::new(format!(
            " {} · 已获取 {} / {} 首{}",
            info["name"].as_str().unwrap_or("歌手"),
            info["loaded"].as_u64().unwrap_or(0),
            info["expected"]
                .as_u64()
                .map(|n| n.to_string())
                .unwrap_or_else(|| "—".into()),
            if info["complete"] == true {
                ""
            } else {
                " · 部分"
            }
        ))
        .style(
            Style::default()
                .fg(theme::current().accent)
                .add_modifier(Modifier::BOLD),
        ),
        p[0],
    );
    tabs(
        frame,
        p[1],
        &["热门单曲 [N]", "单曲", "专辑"],
        &ARTIST_TABS,
        artist_tab,
        "artisttab",
        regions,
    );
    (p[2], image)
}
fn artist_card(
    frame: &mut Frame,
    area: Rect,
    info: &Value,
    hd: bool,
    regions: &mut controls::Regions,
) -> Option<Rect> {
    if area.width == 0 || area.height < 5 {
        return None;
    }
    let p = Layout::vertical([
        Constraint::Length(area.height.saturating_sub(13).min(18)),
        Constraint::Min(0),
    ])
    .split(area);
    let photo = theme::panel()
        .title(format!(
            " 歌手影像 · {} / {} ",
            (info["photoIndex"].as_u64().unwrap_or(0) + 1)
                .min(info["photos"].as_array().map_or(0, Vec::len) as u64),
            info["photos"].as_array().map_or(0, Vec::len)
        ))
        .border_type(BorderType::Rounded);
    let inner = photo.inner(p[0]);
    frame.render_widget(photo, p[0]);
    let image = Rect::new(
        inner.x,
        inner.y,
        inner.width,
        inner.height.saturating_sub(1),
    );
    let image = crate::kitty::fit_image(info["png"].as_str().unwrap_or(""), image);
    let mut hd_area = None;
    if hd && info["png"].as_str().is_some_and(|s| !s.is_empty()) && image.area() > 0 {
        hd_area = Some(image);
    } else if let Some(pixels) = info["pixels"].as_array().filter(|a| a.len() == 3072) {
        let mut lines = vec![];
        for y in 0..image.height {
            let mut spans = vec![];
            for x in 0..image.width {
                let color = |lower: bool| {
                    let px = x as usize * 32 / image.width as usize;
                    let py =
                        (y as usize * 2 + usize::from(lower)) * 32 / (image.height as usize * 2);
                    let i = (py * 32 + px) * 3;
                    ratatui::style::Color::Rgb(
                        pixels[i].as_u64().unwrap_or(0) as u8,
                        pixels[i + 1].as_u64().unwrap_or(0) as u8,
                        pixels[i + 2].as_u64().unwrap_or(0) as u8,
                    )
                };
                spans.push(Span::styled(
                    "▀",
                    Style::default().fg(color(false)).bg(color(true)),
                ));
            }
            lines.push(Line::from(spans));
        }
        frame.render_widget(Paragraph::new(lines), image);
    } else {
        frame.render_widget(
            Paragraph::new(
                if info["photos"].as_array().is_some_and(|p| !p.is_empty()) {
                    if info["photoUnavailable"] == true {
                        "影像暂不可用，可切换照片"
                    } else {
                        "影像加载中…"
                    }
                } else {
                    "暂无歌手照片"
                },
            )
            .style(Style::default().fg(theme::current().muted)),
            image,
        );
    }
    if inner.height > 0 {
        let width = inner.width / 2;
        controls::button(
            frame,
            Rect::new(inner.x, inner.bottom() - 1, width, 1),
            "‹ 上一张 [,]",
            "catalog:artistphoto:-1",
            regions,
        );
        controls::button(
            frame,
            Rect::new(inner.x + width, inner.bottom() - 1, inner.width - width, 1),
            "下一张 [.] ›",
            "catalog:artistphoto:1",
            regions,
        );
    }
    let t = theme::current();
    let info_block = theme::panel()
        .title(" 歌手名片 ")
        .border_type(BorderType::Rounded);
    let inside = info_block.inner(p[1]);
    frame.render_widget(info_block, p[1]);
    let birthday = info["birthday"]
        .as_str()
        .filter(|s| !s.is_empty())
        .unwrap_or("未提供");
    let lines = vec![
        Line::from(Span::styled(
            info["name"].as_str().unwrap_or("歌手"),
            Style::default().fg(t.accent).add_modifier(Modifier::BOLD),
        )),
        Line::from(format!("生日  {birthday}")),
        Line::from(format!("粉丝数  {}", count(&info["fans"]))),
        Line::from(format!(
            "单曲 {}  · 专辑 {}",
            count(&info["songs"]),
            count(&info["albums"])
        )),
        Line::from(""),
        Line::from(info["notice"].as_str().unwrap_or("")),
    ];
    frame.render_widget(
        Paragraph::new(lines)
            .style(Style::default().fg(t.foreground))
            .wrap(Wrap { trim: false }),
        Rect::new(
            inside.x,
            inside.y,
            inside.width,
            inside.height.saturating_sub(1),
        ),
    );
    if inside.height > 0 {
        controls::button(
            frame,
            Rect::new(inside.x, inside.bottom() - 1, inside.width, 1),
            "歌手资料 [J]  ›",
            "catalog:artistprofile",
            regions,
        );
    }
    hd_area
}
fn wrapped_prose(text: &str, width: usize) -> Vec<Line<'static>> {
    if width == 0 {
        return vec![];
    }
    let mut lines = vec![];
    for source in text.split('\n') {
        let mut tokens = vec![];
        let mut word = String::new();
        for ch in source.chars() {
            if ch.is_ascii() && !ch.is_ascii_whitespace() {
                word.push(ch);
            } else {
                if !word.is_empty() {
                    tokens.push(std::mem::take(&mut word));
                }
                tokens.push(if ch == '\t' {
                    "    ".into()
                } else {
                    ch.to_string()
                });
            }
        }
        if !word.is_empty() {
            tokens.push(word);
        }
        let mut current = String::new();
        let mut used = 0;
        for token in tokens {
            let token_width = Line::from(token.as_str()).width();
            if token_width <= width {
                if used + token_width > width {
                    lines.push(Line::from(std::mem::take(&mut current)));
                    used = 0;
                }
                current.push_str(&token);
                used += token_width;
            } else {
                for ch in token.chars() {
                    let w = Line::from(ch.to_string()).width();
                    if used + w > width {
                        lines.push(Line::from(std::mem::take(&mut current)));
                        used = 0;
                    }
                    current.push(ch);
                    used += w;
                }
            }
        }
        lines.push(Line::from(current));
    }
    lines
}
pub fn profile(
    frame: &mut Frame,
    area: Rect,
    info: &Value,
    tab: usize,
    scroll: &mut u16,
    regions: &mut controls::Regions,
) {
    let title = PROFILE_TABS[tab.min(4)];
    let text = info["sections"][title]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("酷狗暂未提供这部分资料。");
    let block = theme::panel()
        .title(format!(" {title} · ↑↓ / 滚轮浏览 "))
        .border_type(BorderType::Rounded);
    let inner = block.inner(area);
    let lines = wrapped_prose(text, inner.width as usize);
    let max = lines
        .len()
        .saturating_sub(inner.height as usize)
        .min(u16::MAX as usize) as u16;
    *scroll = (*scroll).min(max);
    let paragraph = Paragraph::new(lines).style(Style::default().fg(theme::current().foreground));
    frame.render_widget(paragraph.scroll((*scroll, 0)).block(block), area);
    regions.profile = inner;
}
pub fn row(index: usize, track: &Value, width: u16) -> ListItem<'static> {
    if track["kind"] == "song" {
        return ListItem::new(collections::song_row(index, track, width));
    }
    let t = theme::current();
    let detail = match track["kind"].as_str().unwrap_or("") {
        "artist" => format!(
            "粉丝 {} · 单曲 {} · 专辑 {}",
            count(&track["fans"]),
            count(&track["songs"]),
            count(&track["albums"])
        ),
        "album" => format!(
            "{} · {} · {} 首",
            track["artist"].as_str().unwrap_or(""),
            track["date"].as_str().unwrap_or(""),
            track["count"]
                .as_u64()
                .map(|n| n.to_string())
                .unwrap_or_else(|| "—".into())
        ),
        _ => format!(
            "{} · {} 首 · {}",
            track["creator"].as_str().unwrap_or(""),
            track["count"]
                .as_u64()
                .map(|n| n.to_string())
                .unwrap_or_else(|| "—".into()),
            collections::playlist_plays(track)
        ),
    };
    let artist = matches!(
        track["kind"].as_str(),
        Some("artist" | "playlist" | "album")
    );
    let padding = if artist { "        " } else { "" };
    let mut lines = vec![
        Line::from(Span::styled(
            format!(
                "{padding} {:>3}  {}",
                index + 1,
                track["title"].as_str().unwrap_or("")
            ),
            Style::default()
                .fg(t.foreground)
                .add_modifier(Modifier::BOLD),
        )),
        Line::from(Span::styled(
            format!("{padding}      {detail}"),
            Style::default().fg(t.muted),
        )),
    ];
    if artist {
        lines.push(Line::from(""));
    }
    ListItem::new(lines)
}
pub fn thumbnail(frame: &mut Frame, rect: Rect, track: &Value, hd: bool) -> Option<(Rect, String)> {
    if hd && crate::kitty::supported() {
        if let Some(png) = track["thumbnailPng"].as_str().filter(|s| !s.is_empty()) {
            return Some((rect, png.to_string()));
        }
    }
    let pixels = track["thumbnailPixels"].as_array();
    if let Some(pixels) = pixels.filter(|p| p.len() == 3072) {
        let mut lines = Vec::new();
        for y in 0..rect.height {
            let mut spans = Vec::new();
            for x in 0..rect.width {
                let color = |lower: bool| {
                    let px = x as usize * 32 / rect.width as usize;
                    let py =
                        (y as usize * 2 + usize::from(lower)) * 32 / (rect.height as usize * 2);
                    let i = (py * 32 + px) * 3;
                    ratatui::style::Color::Rgb(
                        pixels[i].as_u64().unwrap_or(0) as u8,
                        pixels[i + 1].as_u64().unwrap_or(0) as u8,
                        pixels[i + 2].as_u64().unwrap_or(0) as u8,
                    )
                };
                spans.push(Span::styled(
                    "▀",
                    Style::default().fg(color(false)).bg(color(true)),
                ));
            }
            lines.push(Line::from(spans));
        }
        frame.render_widget(Paragraph::new(lines), rect);
    } else {
        frame.render_widget(
            Paragraph::new(" ◌ ").style(Style::default().fg(theme::current().muted)),
            rect,
        );
    }
    None
}
