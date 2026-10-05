use crate::{controls, theme};
use ratatui::{
    Frame,
    layout::{Constraint, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{BorderType, Paragraph, Wrap},
};

pub fn input(frame: &mut Frame, area: Rect, query: &str, active: bool) {
    let t = theme::current();
    let mut visible = query.to_string();
    let limit = area.width.saturating_sub(7) as usize;
    while Line::from(visible.as_str()).width() > limit && !visible.is_empty() {
        visible.remove(0);
    }
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled("  /  ", Style::default().fg(t.secondary)),
            Span::styled(
                if query.is_empty() {
                    "输入歌曲、歌手或专辑…".into()
                } else {
                    visible
                },
                Style::default().fg(if query.is_empty() {
                    t.muted
                } else {
                    t.foreground
                }),
            ),
            Span::styled(if active { "▏" } else { "" }, Style::default().fg(t.accent)),
        ]))
        .block(
            theme::panel()
                .title(if active {
                    " 搜索 · 正在输入 "
                } else {
                    " 搜索结果 · / 重新搜索 "
                })
                .border_type(BorderType::Rounded)
                .border_style(Style::default().fg(t.accent)),
        ),
        area,
    );
}
pub const MOODS: &[&str] = &[
    "每一种心情，都有一首刚好合适的歌。",
    "下一首喜欢的歌，也许只差一次好奇。",
    "给今天留一段旋律，让心情慢慢找到拍子。",
    "输入一个名字，打开一扇通往音乐的小门。",
    "有些心事说不出口，让一首歌替你接住。",
    "从熟悉的一句开始，遇见意料之外的喜欢。",
    "今天的故事还没结束，先替它挑一首配乐。",
    "让耳朵散散步，下一站也许就是你的单曲循环。",
    "世界有点吵，在这里找一首属于自己的歌。",
    "把此刻的心情放进搜索框，听听它会去哪里。",
    "一段前奏就能点亮一天，来找你的那一段。",
    "别急着决定喜欢什么，让旋律先来敲门。",
];
const SEEDS: &[&str] = &[
    "夜晚爵士",
    "轻松民谣",
    "电子音乐",
    "古典钢琴",
    "动漫原声",
    "雨天纯音乐",
    "华语经典",
    "日系摇滚",
    "电影配乐",
    "城市流行",
    "独立音乐",
    "游戏音乐",
    "治愈人声",
    "清晨轻音乐",
    "运动节奏",
    "睡前氛围",
];

fn fitted(text: &str, width: usize) -> String {
    let mut out = String::new();
    let truncate = Line::from(text).width() > width;
    let limit = width.saturating_sub(usize::from(truncate));
    for ch in text.chars() {
        if Line::from(out.as_str()).width() + Line::from(ch.to_string()).width() > limit {
            break;
        }
        out.push(ch);
    }
    if truncate && width > 0 {
        out.push('…');
    }
    out
}
// Integer scaling keeps English words and punctuation contiguous between chunks.
fn large(
    frame: &mut Frame,
    area: Rect,
    text: &str,
    color: ratatui::style::Color,
    regions: &mut controls::Regions,
) {
    if !crate::kitty::supported() || area.height < 2 {
        frame.render_widget(
            Paragraph::new(fitted(text, area.width as usize))
                .style(Style::default().fg(color).add_modifier(Modifier::BOLD)),
            area,
        );
        return;
    }
    let text = fitted(text, area.width as usize / 2);
    let mut chunk = String::new();
    let mut native = 0;
    let mut x = area.x;
    for ch in text.chars() {
        let width = Line::from(ch.to_string()).width() as u16;
        if native + width > 7 {
            regions.lyric_text.push(crate::kitty::LargeLine {
                rect: Rect::new(x, area.y, native * 2, 2),
                text: std::mem::take(&mut chunk),
                color,
                fraction: None,
                vertical: 2,
            });
            x += native * 2;
            native = 0;
        }
        chunk.push(ch);
        native += width;
    }
    if native > 0 {
        regions.lyric_text.push(crate::kitty::LargeLine {
            rect: Rect::new(x, area.y, native * 2, 2),
            text: chunk,
            color,
            fraction: None,
            vertical: 2,
        });
    }
}
pub fn entry(
    frame: &mut Frame,
    area: Rect,
    query: &str,
    suggestions: &[String],
    selected: Option<usize>,
    unavailable: bool,
    hot: &[String],
    hot_unavailable: bool,
    mood: usize,
    regions: &mut controls::Regions,
) {
    let t = theme::current();
    let parts = Layout::vertical([
        Constraint::Length(4),
        Constraint::Length(3),
        Constraint::Min(0),
    ])
    .split(area);
    frame.render_widget(
        Paragraph::new(vec![
            Line::from(Span::styled(
                "  FIND YOUR NEXT TRACK",
                Style::default().fg(t.accent).add_modifier(Modifier::BOLD),
            )),
            Line::from(Span::styled(
                format!("  {}", MOODS[mood % MOODS.len()]),
                Style::default().fg(t.muted),
            )),
        ]),
        parts[0],
    );
    input(frame, parts[1], query, true);
    if query.trim().is_empty() {
        let bottom = Layout::vertical([Constraint::Length(3), Constraint::Min(0)]).split(parts[2]);
        frame.render_widget(Paragraph::new("  从一个名字、一句歌词或一种心情开始。\n  点击灵感或热搜开始探索 · 输入后实时建议 · Esc 返回").style(Style::default().fg(t.muted)),bottom[0]);
        let cards = if area.width >= 60 {
            Layout::horizontal([Constraint::Percentage(50), Constraint::Percentage(50)])
                .split(bottom[1])
        } else {
            Layout::vertical([Constraint::Percentage(50), Constraint::Percentage(50)])
                .split(bottom[1])
        };
        for (column, title) in [" 搜索灵感 · 给心情选个方向 ", " 酷狗热搜 · 此刻大家在听 "]
            .iter()
            .enumerate()
        {
            let block = theme::panel()
                .title(*title)
                .border_type(BorderType::Rounded)
                .border_style(Style::default().fg(if column == 0 {
                    t.secondary
                } else {
                    t.accent
                }));
            let inner = block.inner(cards[column]);
            frame.render_widget(block, cards[column]);
            if inner.height == 0 || inner.width == 0 {
                continue;
            }
            if column == 1 && hot.is_empty() {
                frame.render_widget(
                    Paragraph::new(if hot_unavailable {
                        "  热搜暂不可用，试试左侧灵感。"
                    } else {
                        "  正在获取实时热搜…"
                    })
                    .style(Style::default().fg(t.muted))
                    .wrap(Wrap { trim: false }),
                    inner,
                );
                continue;
            }
            let rows = (inner.height / 2).max(1) as usize;
            let cols = if column == 0 && inner.width >= 38 {
                2
            } else {
                1
            };
            let width = inner.width / cols;
            let items: Vec<&str> = if column == 0 {
                SEEDS.to_vec()
            } else {
                hot.iter().map(String::as_str).collect()
            };
            for (i, text) in items.iter().take(rows * cols as usize).enumerate() {
                let r = Rect::new(
                    inner.x + (i / rows) as u16 * width,
                    inner.y + (i % rows) as u16 * 2,
                    width,
                    1,
                );
                let label = if column == 1 {
                    format!(" {:02}  {text}", i + 1)
                } else {
                    format!(" ♪ {text}")
                };
                frame.render_widget(
                    Paragraph::new(fitted(&label, width as usize)).style(
                        Style::default()
                            .fg(if column == 1 && i < 3 {
                                t.accent
                            } else {
                                t.foreground
                            })
                            .add_modifier(Modifier::BOLD),
                    ),
                    r,
                );
                regions.add(r, format!("search-seed:{text}"));
            }
        }
        return;
    }
    let block = theme::panel()
        .title(" 实时搜索建议 · 最多 16 条 · ↑↓ 选择 · Tab 补全 · Enter 搜索 ")
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(t.secondary));
    let inner = block.inner(parts[2]);
    frame.render_widget(block, parts[2]);
    if suggestions.is_empty() {
        frame.render_widget(
            Paragraph::new(if unavailable {
                "  暂无可用建议，仍可按 Enter 搜索。"
            } else {
                "  正在寻找相关建议…"
            })
            .style(Style::default().fg(t.muted)),
            inner,
        );
        return;
    }
    if inner.height == 0 {
        return;
    }
    let stride = if inner.height >= 3 { 3 } else { 1 };
    let rows = (inner.height / stride).max(1) as usize;
    let cols = if inner.width >= 80 { 2 } else { 1 };
    let capacity = rows * cols;
    let offset = selected.unwrap_or(0).saturating_sub(capacity - 1);
    let width = inner.width / cols as u16;
    for (local, text) in suggestions.iter().skip(offset).take(capacity).enumerate() {
        let i = offset + local;
        let r = Rect::new(
            inner.x + (local / rows) as u16 * width,
            inner.y + (local % rows) as u16 * stride,
            width,
            stride.min(2),
        );
        let chosen = selected == Some(i);
        if chosen {
            frame.render_widget(Paragraph::new(" ").style(Style::default().bg(t.surface)), r);
        }
        frame.render_widget(
            Paragraph::new(format!(" {:02}", i + 1)).style(Style::default().fg(if chosen {
                t.accent
            } else {
                t.secondary
            })),
            Rect::new(r.x, r.y, r.width.min(4), 1),
        );
        large(
            frame,
            Rect::new(
                r.x + 4.min(r.width),
                r.y,
                r.width.saturating_sub(5),
                r.height,
            ),
            text,
            if chosen { t.accent } else { t.foreground },
            regions,
        );
        regions.add(r, format!("suggestion:{i}"));
    }
}
