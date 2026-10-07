use crate::{controls::Regions, theme};
use crossterm::event::KeyCode;
use ratatui::{
    Frame,
    layout::Rect,
    style::Style,
    widgets::{Clear, Paragraph},
};
use serde_json::Value;

pub enum Dialog {
    Menu {
        title: String,
        rows: Vec<(String, String)>,
        selected: usize,
    },
    Text {
        title: String,
        value: String,
        command: String,
    },
}
pub enum Action {
    None,
    Close,
    Send(String),
}
impl Dialog {
    pub fn from_event(event: &Value) -> Self {
        let title = event["title"].as_str().unwrap_or("歌曲操作").to_string();
        if event["kind"] == "text_prompt" {
            Self::Text {
                title,
                value: event["value"].as_str().unwrap_or("").into(),
                command: event["command"].as_str().unwrap_or("").into(),
            }
        } else {
            Self::Menu {
                title,
                rows: event["actions"]
                    .as_array()
                    .map(|rows| {
                        rows.iter()
                            .filter_map(|row| {
                                Some((
                                    row["title"].as_str()?.into(),
                                    row["command"].as_str()?.into(),
                                ))
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
                selected: 0,
            }
        }
    }
    pub fn key(&mut self, key: KeyCode) -> Action {
        if key == KeyCode::Esc {
            return Action::Close;
        }
        match self {
            Self::Menu { rows, selected, .. } => match key {
                KeyCode::Up => *selected = selected.saturating_sub(1),
                KeyCode::Down => *selected = (*selected + 1).min(rows.len().saturating_sub(1)),
                KeyCode::Home => *selected = 0,
                KeyCode::End => *selected = rows.len().saturating_sub(1),
                KeyCode::Enter => {
                    if let Some((_, command)) = rows.get(*selected) {
                        return Action::Send(command.clone());
                    }
                }
                _ => {}
            },
            Self::Text { value, command, .. } => match key {
                KeyCode::Delete => value.clear(),
                KeyCode::Backspace => {
                    value.pop();
                }
                KeyCode::Char(c) if !c.is_control() && value.chars().count() < 80 => value.push(c),
                KeyCode::Enter if !value.trim().is_empty() => {
                    return Action::Send(format!(
                        "{}{}",
                        command,
                        serde_json::to_string(value.trim()).unwrap()
                    ));
                }
                _ => {}
            },
        }
        Action::None
    }
    pub fn click(&self, index: usize) -> Action {
        match self {
            Self::Menu { rows, .. } => rows
                .get(index)
                .map(|(_, cmd)| Action::Send(cmd.clone()))
                .unwrap_or(Action::None),
            _ => Action::None,
        }
    }
    pub fn render(&self, f: &mut Frame, regions: &mut Regions) -> Rect {
        let area = f.area();
        let w = area.width.min(72);
        let height = match self {
            Self::Menu { rows, .. } => rows.len() as u16 + 4,
            Self::Text { .. } => 6,
        };
        let h = area.height.min(height);
        let rect = Rect::new(
            area.x + (area.width - w) / 2,
            area.y + (area.height - h) / 2,
            w,
            h,
        );
        let palette = theme::current();
        f.render_widget(Clear, rect);
        let title = match self {
            Self::Menu { title, .. } | Self::Text { title, .. } => title,
        };
        let panel = theme::panel().title(format!(" {} ", title)).style(
            Style::default()
                .bg(palette.background)
                .fg(palette.foreground),
        );
        let inner = panel.inner(rect);
        f.render_widget(panel, rect);
        match self {
            Self::Menu { rows, selected, .. } => {
                let visible = inner.height.saturating_sub(2) as usize;
                let first = selected.saturating_sub(visible.saturating_sub(1));
                for (i, (title, _)) in rows.iter().enumerate().skip(first).take(visible) {
                    let row = Rect::new(inner.x, inner.y + (i - first) as u16, inner.width, 1);
                    f.render_widget(
                        Paragraph::new(format!(
                            " {} {}",
                            if *selected == i { "›" } else { " " },
                            title
                        ))
                        .style(
                            Style::default()
                                .fg(if *selected == i {
                                    palette.accent
                                } else {
                                    palette.foreground
                                })
                                .bg(if *selected == i {
                                    palette.surface
                                } else {
                                    palette.background
                                }),
                        ),
                        row,
                    );
                    regions.add(row, format!("song-select:{i}"));
                }
            }
            Self::Text { value, .. } => f.render_widget(
                Paragraph::new(format!("\n {}▏", value)).style(Style::default().fg(palette.accent)),
                inner,
            ),
        }
        if inner.height > 0 {
            f.render_widget(
                Paragraph::new(match self {
                    Self::Text { .. } => " 输入内容 · Backspace 删除 · Enter 保存 · Esc 取消",
                    Self::Menu { .. } => " ↑↓ / 鼠标选择 · Enter 确认 · Esc 取消",
                })
                .style(Style::default().fg(palette.muted)),
                Rect::new(inner.x, inner.bottom() - 1, inner.width, 1),
            );
        }
        regions.song_menu = rect;
        rect
    }
}
