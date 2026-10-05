use crate::{controls::Regions, theme};
use crossterm::event::KeyCode;
use ratatui::{
    Frame,
    layout::{Constraint, Layout, Rect},
    style::Style,
    text::Line,
    widgets::{Clear, Paragraph},
};
pub const OPTIONS: [(&str, &str); 10] = [
    ("default", "歌单默认顺序"),
    ("reverse", "默认顺序倒序"),
    ("title-asc", "歌名 A → Z"),
    ("title-desc", "歌名 Z → A"),
    ("artist-asc", "歌手 A → Z"),
    ("artist-desc", "歌手 Z → A"),
    ("duration-asc", "时长 短 → 长"),
    ("duration-desc", "时长 长 → 短"),
    ("vip-first", "VIP 歌曲优先"),
    ("shuffle", "随机排列"),
];
pub struct Picker {
    pub selected: usize,
}
impl Picker {
    pub fn new(mode: &str) -> Self {
        Self {
            selected: OPTIONS.iter().position(|(id, _)| *id == mode).unwrap_or(0),
        }
    }
    pub fn move_key(&mut self, key: KeyCode) {
        match key {
            KeyCode::Up => self.selected = self.selected.saturating_sub(1),
            KeyCode::Down => self.selected = (self.selected + 1).min(OPTIONS.len() - 1),
            KeyCode::Home => self.selected = 0,
            KeyCode::End => self.selected = OPTIONS.len() - 1,
            _ => {}
        }
    }
    pub fn render(&self, f: &mut Frame, regions: &mut Regions) -> Rect {
        let area = f.area();
        let w = area.width.min(50);
        let h = area.height.min(17);
        let r = Rect::new(
            area.x + (area.width - w) / 2,
            area.y + (area.height - h) / 2,
            w,
            h,
        );
        f.render_widget(Clear, r);
        let p = theme::current();
        let b = theme::panel()
            .title(" 歌单排序 ")
            .style(Style::default().bg(p.background).fg(p.foreground));
        let inner = b.inner(r);
        f.render_widget(b, r);
        let areas = Layout::vertical([
            Constraint::Length(2),
            Constraint::Min(0),
            Constraint::Length(2),
        ])
        .split(inner);
        f.render_widget(
            Paragraph::new(" 整份歌单排序，再按结果分页\n 首次排序会读取完整歌单")
                .style(Style::default().fg(p.muted)),
            areas[0],
        );
        let visible = areas[1].height as usize;
        let first = self.selected.saturating_sub(visible.saturating_sub(1));
        for (i, (_, label)) in OPTIONS.iter().enumerate().skip(first).take(visible) {
            let row = Rect::new(
                areas[1].x,
                areas[1].y + (i - first) as u16,
                areas[1].width,
                1,
            );
            f.render_widget(
                Paragraph::new(Line::from(format!(
                    " {} {}",
                    if i == self.selected { "›" } else { " " },
                    label
                )))
                .style(
                    Style::default()
                        .fg(if i == self.selected {
                            p.accent
                        } else {
                            p.foreground
                        })
                        .bg(if i == self.selected {
                            p.surface
                        } else {
                            p.background
                        }),
                ),
                row,
            );
            regions.add(row, format!("sort-select:{i}"));
        }
        f.render_widget(
            Paragraph::new(" ↑↓ 选择 · Enter 应用 · Esc 取消\n 鼠标点击直接选择")
                .style(Style::default().fg(p.muted)),
            areas[2],
        );
        regions.sort_menu = r;
        r
    }
}
