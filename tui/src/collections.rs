use crate::{controls, theme};
use ratatui::{
    Frame,
    layout::{Constraint, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{BorderType, Paragraph, Wrap},
};
use serde_json::Value;

pub fn playlist_plays(info: &Value) -> String {
    match info["playCount"].as_u64() {
        Some(n) if n >= 100_000_000 => format!("播放量 {:.1}亿", n as f64 / 100_000_000.0),
        Some(n) if n >= 10_000 => format!("播放量 {:.1}万", n as f64 / 10_000.0),
        Some(n) => format!("播放量 {n}"),
        None => "播放量未提供".into(),
    }
}

fn fitted(text: &str, width: usize) -> String {
    let mut result = String::new();
    let mut used = 0;
    let full = Line::from(text).width();
    let limit = if full > width {
        width.saturating_sub(1)
    } else {
        width
    };
    for ch in text.chars() {
        let w = Line::from(ch.to_string()).width();
        if used + w > limit {
            break;
        }
        result.push(ch);
        used += w;
    }
    if full > width && width > 0 {
        result.push('…');
        used += 1;
    }
    result.push_str(&" ".repeat(width.saturating_sub(used)));
    result
}
pub fn song_row(index: usize, track: &Value, width: u16) -> Line<'static> {
    let t = theme::current();
    let width = width as usize;
    let artist_width = if width >= 65 {
        20
    } else if width >= 45 {
        14
    } else {
        0
    };
    let prefix = format!(" {:>3}  ♪ ", index + 1);
    let title_width = width
        .saturating_sub(Line::from(prefix.as_str()).width() + artist_width + 11)
        .max(1);
    let seconds = track["duration"].as_f64().unwrap_or(0.0).max(0.0) as u64;
    Line::from(vec![
        Span::styled(prefix, Style::default().fg(t.secondary)),
        Span::styled(
            fitted(track["title"].as_str().unwrap_or(""), title_width),
            Style::default().fg(t.foreground),
        ),
        Span::styled(
            fitted(track["artist"].as_str().unwrap_or(""), artist_width),
            Style::default().fg(t.muted),
        ),
        Span::styled(
            if track["vip"] == true {
                " VIP ".to_string()
            } else {
                "     ".to_string()
            },
            Style::default().fg(t.warning),
        ),
        Span::styled(
            format!(" {:>2}:{:02}", seconds / 60, seconds % 60),
            Style::default().fg(t.muted),
        ),
    ])
}

pub fn columns(area: Rect, has_info: bool) -> (Rect, Rect) {
    if !has_info || area.width < 76 {
        return (Rect::default(), area);
    }
    let width = if area.width >= 110 { 34 } else { 28 };
    let parts = Layout::horizontal([
        Constraint::Length(width),
        Constraint::Length(1),
        Constraint::Min(40),
    ])
    .split(area);
    (parts[0], parts[2])
}
pub fn banner(
    frame: &mut Frame,
    area: Rect,
    section: &str,
    kind: &str,
    regions: &mut controls::Regions,
) {
    let t = theme::current();
    if matches!(kind, "created" | "collected") {
        frame.render_widget(
            Paragraph::new(vec![
                Line::from(Span::styled(
                    " 我的音乐收藏",
                    Style::default().fg(t.accent).add_modifier(Modifier::BOLD),
                )),
                Line::from(vec![
                    Span::styled(
                        if kind == "created" {
                            " ● 我创建的歌单    ○ 我收藏的歌单"
                        } else {
                            " ○ 我创建的歌单    ● 我收藏的歌单"
                        },
                        Style::default().fg(t.secondary),
                    ),
                    Span::styled("  [N] 切换", Style::default().fg(t.muted)),
                ]),
            ])
            .block(theme::panel().border_type(BorderType::Rounded)),
            area,
        );
        regions.add(area, "key:n");
        return;
    }
    let songs = matches!(kind, "daily" | "new");
    let (name, subtitle) = if section == "recommend" {
        ("为你推荐", "每日精选 · 从熟悉的旋律找到新喜欢")
    } else {
        ("发现音乐", "新歌与无损精选 · 探索更多声音")
    };
    frame.render_widget(
        Paragraph::new(vec![
            Line::from(vec![
                Span::styled(
                    format!(" {name}  "),
                    Style::default().fg(t.accent).add_modifier(Modifier::BOLD),
                ),
                Span::styled(subtitle, Style::default().fg(t.muted)),
            ]),
            Line::from(vec![
                Span::styled(
                    if songs {
                        " ● 歌曲  "
                    } else {
                        " ○ 歌曲  "
                    },
                    Style::default().fg(if songs { t.accent } else { t.muted }),
                ),
                Span::styled(
                    if !songs && kind != "ranks" {
                        " ● 歌单  "
                    } else {
                        " ○ 歌单  "
                    },
                    Style::default().fg(t.secondary),
                ),
                Span::styled(" N 切换", Style::default().fg(t.muted)),
            ]),
        ])
        .block(
            theme::panel()
                .border_type(BorderType::Rounded)
                .border_style(Style::default().fg(theme::section().border)),
        ),
        area,
    );
    if area.width >= 55 {
        controls::button(
            frame,
            Rect::new(area.right() - 24, area.y + 1, 22, 1),
            if songs {
                "精选歌单 [N]"
            } else {
                "推荐歌曲 [N]"
            },
            "key:n",
            regions,
        );
    }
    if section == "discover" && area.width >= 85 {
        controls::button(
            frame,
            Rect::new(area.right() - 43, area.y + 1, 18, 1),
            "排行榜 [T]",
            "key:t",
            regions,
        );
    }
}
pub fn info(frame: &mut Frame, area: Rect, info: &Value, hd: bool) -> Option<Rect> {
    if area.width == 0 || area.height == 0 {
        return None;
    }
    let t = theme::current();
    let block = theme::panel()
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(t.secondary))
        .title(" 歌单档案 ");
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let cover_height = (inner.width.saturating_sub(2) / 2)
        .min(14)
        .min(inner.height.saturating_sub(8));
    let parts = Layout::vertical([
        Constraint::Length(cover_height),
        Constraint::Length(1),
        Constraint::Min(0),
    ])
    .split(inner);
    let image = Rect::new(
        inner.x + 1,
        inner.y,
        inner.width.saturating_sub(2),
        cover_height,
    );
    let high = hd && info["png"].as_str().is_some_and(|v| !v.is_empty()) && cover_height > 0;
    if !high {
        if let Some(pixels) = info["pixels"].as_array().filter(|p| p.len() == 3072) {
            let mut lines = Vec::new();
            for y in 0..cover_height {
                let py = (y as usize * 32 / cover_height.max(1) as usize).min(30);
                let spans = (0..image.width)
                    .map(|x| {
                        let px = x as usize * 32 / image.width.max(1) as usize;
                        let color = |row: usize| {
                            let at = (row * 32 + px) * 3;
                            Color::Rgb(
                                pixels[at].as_u64().unwrap_or(0) as u8,
                                pixels[at + 1].as_u64().unwrap_or(0) as u8,
                                pixels[at + 2].as_u64().unwrap_or(0) as u8,
                            )
                        };
                        Span::styled("▀", Style::default().fg(color(py)).bg(color(py + 1)))
                    })
                    .collect::<Vec<_>>();
                lines.push(Line::from(spans));
            }
            frame.render_widget(Paragraph::new(lines), image);
        } else {
            frame.render_widget(
                Paragraph::new("\n      ♫\n\n  歌单封面暂未提供")
                    .style(Style::default().fg(t.muted).bg(t.surface)),
                image,
            );
        }
    }
    let mut text = vec![Line::from(Span::styled(
        info["title"].as_str().unwrap_or("歌单"),
        Style::default().fg(t.accent).add_modifier(Modifier::BOLD),
    ))];
    let count = info["count"].as_u64();
    let creator = info["creator"].as_str().unwrap_or("");
    text.push(Line::from(Span::styled(
        format!(
            "{}{}",
            count
                .map(|n| format!("{n} 首歌曲"))
                .unwrap_or_else(|| "曲数未知".into()),
            if creator.is_empty() {
                String::new()
            } else {
                format!(" · {creator}")
            }
        ),
        Style::default().fg(t.muted),
    )));
    text.push(Line::default());
    let tags = info["tags"]
        .as_array()
        .map(|tags| {
            tags.iter()
                .filter_map(Value::as_str)
                .map(|s| format!("#{s}"))
                .collect::<Vec<_>>()
                .join("  ")
        })
        .unwrap_or_default();
    text.push(Line::from(Span::styled(
        if tags.is_empty() {
            "暂无标签".into()
        } else {
            tags
        },
        Style::default().fg(t.secondary),
    )));
    text.push(Line::default());
    text.push(Line::from(Span::styled(
        "关于这份歌单",
        Style::default()
            .fg(t.foreground)
            .add_modifier(Modifier::BOLD),
    )));
    let description = info["description"]
        .as_str()
        .filter(|v| !v.is_empty())
        .unwrap_or("这份歌单暂无简介。");
    text.push(Line::from(Span::styled(
        description,
        Style::default().fg(t.muted),
    )));
    frame.render_widget(Paragraph::new(text).wrap(Wrap { trim: true }), parts[2]);
    high.then_some(image)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn info_panel_preserves_song_space_and_hides_on_small_windows() {
        for width in [45, 75, 76, 100, 140] {
            let area = Rect::new(22, 4, width, 30);
            let (info, list) = columns(area, true);
            assert!(list.width >= 40);
            assert!(list.right() <= area.right());
            if width >= 76 {
                assert_eq!(info.x, area.x);
                assert_eq!(list.x, info.right() + 1);
            } else {
                assert_eq!(list, area);
            }
        }
    }
}
