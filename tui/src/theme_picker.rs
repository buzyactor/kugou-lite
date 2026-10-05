use crate::{controls::Regions, theme};
use crossterm::event::KeyCode;
use ratatui::{
    Frame,
    layout::{Constraint, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Clear, Paragraph},
};
pub struct Picker {
    pub original: usize,
    pub selected: usize,
    scroll: usize,
}
pub enum Action {
    Preview(usize),
    Confirm,
    Cancel,
    None,
}
impl Picker {
    pub fn new(index: usize) -> Self {
        Self {
            original: index,
            selected: index,
            scroll: 0,
        }
    }
    pub fn key(&mut self, key: KeyCode) -> Action {
        let count = theme::palettes().len();
        match key {
            KeyCode::Esc => return Action::Cancel,
            KeyCode::Enter | KeyCode::Char(' ') => return Action::Confirm,
            KeyCode::Up | KeyCode::Left => self.selected = self.selected.saturating_sub(1),
            KeyCode::Down | KeyCode::Right => self.selected = (self.selected + 1).min(count - 1),
            KeyCode::PageUp => self.selected = self.selected.saturating_sub(8),
            KeyCode::PageDown => self.selected = (self.selected + 8).min(count - 1),
            KeyCode::Home => self.selected = 0,
            KeyCode::End => self.selected = count - 1,
            _ => return Action::None,
        }
        Action::Preview(self.selected)
    }
    pub fn render(&mut self, frame: &mut Frame, regions: &mut Regions) -> Rect {
        let area = frame.area();
        let width = area.width.min(78);
        let height = area.height.min(30);
        let rect = Rect::new(
            area.x + (area.width - width) / 2,
            area.y + (area.height - height) / 2,
            width,
            height,
        );
        frame.render_widget(Clear, rect);
        let p = theme::current();
        let block = theme::panel()
            .title(" 选择主题 · 即时预览 ")
            .style(Style::default().bg(p.background).fg(p.foreground));
        let inner = block.inner(rect);
        frame.render_widget(block, rect);
        let areas = Layout::vertical([
            Constraint::Length(2),
            Constraint::Min(1),
            Constraint::Length(2),
        ])
        .split(inner);
        frame.render_widget(
            Paragraph::new(format!(
                " {} · {}/{}",
                theme::palettes()[self.selected].name,
                self.selected + 1,
                theme::palettes().len()
            ))
            .style(Style::default().fg(p.accent).add_modifier(Modifier::BOLD)),
            areas[0],
        );
        let visible = areas[1].height as usize;
        if self.selected < self.scroll {
            self.scroll = self.selected;
        }
        if self.selected >= self.scroll + visible {
            self.scroll = self.selected.saturating_sub(visible.saturating_sub(1));
        }
        for (i, palette) in theme::palettes()
            .iter()
            .enumerate()
            .skip(self.scroll)
            .take(visible)
        {
            let row = Rect::new(
                areas[1].x,
                areas[1].y + (i - self.scroll) as u16,
                areas[1].width,
                1,
            );
            let mut spans = vec![Span::raw(format!(
                " {} {:>2}  {:<30} ",
                if i == self.selected {
                    "›"
                } else if i == self.original {
                    "✓"
                } else {
                    " "
                },
                i + 1,
                palette.name
            ))];
            for color in [
                palette.background,
                palette.foreground,
                palette.accent,
                palette.secondary,
                palette.warning,
            ] {
                spans.push(Span::styled("  ", Style::default().bg(color)));
                spans.push(Span::raw(" "));
            }
            frame.render_widget(
                Paragraph::new(Line::from(spans)).style(Style::default().fg(p.foreground).bg(
                    if i == self.selected {
                        p.surface
                    } else {
                        p.background
                    },
                )),
                row,
            );
            regions.add(row, format!("theme-select:{i}"));
        }
        frame.render_widget(
            Paragraph::new(" ↑↓ / 滚轮预览 · PgUp/PgDn 翻页\n Enter 应用    Esc 取消")
                .style(Style::default().fg(p.muted)),
            areas[2],
        );
        regions.add(
            Rect::new(areas[2].x, areas[2].y + 1, 14.min(areas[2].width), 1),
            "theme-confirm",
        );
        if areas[2].width > 14 {
            regions.add(
                Rect::new(areas[2].x + 14, areas[2].y + 1, areas[2].width - 14, 1),
                "theme-cancel",
            );
        }
        regions.theme_menu = rect;
        rect
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn picker_previews_scrolls_and_keeps_original_for_cancel() {
        let mut picker = Picker::new(0);
        assert!(matches!(picker.key(KeyCode::Down), Action::Preview(1)));
        assert_eq!(picker.original, 0);
        picker.key(KeyCode::End);
        assert_eq!(picker.selected, theme::palettes().len() - 1);
        let mut terminal =
            ratatui::Terminal::new(ratatui::backend::TestBackend::new(80, 20)).unwrap();
        let mut regions = Regions::default();
        terminal
            .draw(|f| {
                picker.render(f, &mut regions);
            })
            .unwrap();
        assert!(
            regions
                .hits
                .iter()
                .any(|h| h.action == format!("theme-select:{}", picker.selected))
        );
        assert!(matches!(picker.key(KeyCode::Esc), Action::Cancel));
        assert!(matches!(picker.key(KeyCode::Enter), Action::Confirm));
    }
}
