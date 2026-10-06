use crate::{
    controls::Regions,
    settings::{QUALITIES, quality_label},
    theme,
};
use crossterm::event::KeyCode;
use ratatui::{
    Frame,
    layout::{Constraint, Layout, Rect},
    style::Style,
    text::Line,
    widgets::{Clear, Paragraph},
};
pub struct Picker {
    pub selected: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::{Terminal, backend::TestBackend};
    #[test]
    fn all_options_have_click_targets_and_small_windows_keep_selection_visible() {
        for (w, h) in [(100, 30), (40, 10)] {
            let mut terminal = Terminal::new(TestBackend::new(w, h)).unwrap();
            let mut regions = Regions::default();
            let mut picker = Picker::new("viper_atmos");
            terminal
                .draw(|f| {
                    picker.render(f, &mut regions, "viper_atmos", "FLAC · 96000 Hz");
                })
                .unwrap();
            let text = terminal
                .backend()
                .buffer()
                .content
                .iter()
                .map(|c| c.symbol())
                .collect::<String>();
            assert!(
                text.replace(' ', "").contains("蝰蛇全景声"),
                "{w}x{h}: {text}"
            );
            assert!(
                regions
                    .hits
                    .iter()
                    .any(|hit| hit.action == "quality-select:5")
            );
            if h >= 14 {
                for i in 0..QUALITIES.len() {
                    let hit = regions
                        .hits
                        .iter()
                        .find(|hit| hit.action == format!("quality-select:{i}"))
                        .unwrap();
                    assert!(crate::controls::contains(
                        regions.quality_menu,
                        hit.rect.x,
                        hit.rect.y
                    ));
                }
            }
            picker.move_key(KeyCode::Home);
            assert_eq!(picker.selected, 0);
            picker.move_key(KeyCode::Up);
            assert_eq!(picker.selected, 0);
            picker.move_key(KeyCode::End);
            assert_eq!(picker.selected, 5);
            picker.move_key(KeyCode::Down);
            assert_eq!(picker.selected, 5);
        }
    }
}
impl Picker {
    pub fn new(mode: &str) -> Self {
        Self {
            selected: QUALITIES.iter().position(|id| *id == mode).unwrap_or(0),
        }
    }
    pub fn move_key(&mut self, key: KeyCode) {
        match key {
            KeyCode::Up => self.selected = self.selected.saturating_sub(1),
            KeyCode::Down => self.selected = (self.selected + 1).min(QUALITIES.len() - 1),
            KeyCode::Home => self.selected = 0,
            KeyCode::End => self.selected = QUALITIES.len() - 1,
            _ => {}
        }
    }
    pub fn render(
        &self,
        f: &mut Frame,
        regions: &mut Regions,
        preferred: &str,
        actual: &str,
    ) -> Rect {
        let area = f.area();
        let w = area.width.min(58);
        let h = area.height.min(14);
        let r = Rect::new(
            area.x + (area.width - w) / 2,
            area.y + (area.height - h) / 2,
            w,
            h,
        );
        f.render_widget(Clear, r);
        let p = theme::current();
        let b = theme::panel()
            .title(" 切换音质 ")
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
            Paragraph::new(format!(
                " 当前请求：{}\n 实际播放：{}",
                quality_label(preferred),
                actual
            ))
            .style(Style::default().fg(p.muted)),
            areas[0],
        );
        let visible = areas[1].height as usize;
        let first = self.selected.saturating_sub(visible.saturating_sub(1));
        for (i, id) in QUALITIES.iter().enumerate().skip(first).take(visible) {
            let row = Rect::new(
                areas[1].x,
                areas[1].y + (i - first) as u16,
                areas[1].width,
                1,
            );
            f.render_widget(
                Paragraph::new(Line::from(format!(
                    " {} {}{}",
                    if i == self.selected { "›" } else { " " },
                    quality_label(id),
                    if *id == preferred { " · 当前" } else { "" }
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
            regions.add(row, format!("quality-select:{i}"));
        }
        f.render_widget(
            Paragraph::new(" ↑↓ 选择 · Enter 应用 · Esc 取消\n 鼠标点击直接选择")
                .style(Style::default().fg(p.muted)),
            areas[2],
        );
        regions.quality_menu = r;
        r
    }
}
