use ratatui::layout::Rect;
use std::io::{self, Write};
const ID: u32 = 47201;
pub struct Cover {
    last: Option<(Rect, String)>,
    id: u32,
}
impl Default for Cover {
    fn default() -> Self {
        Self::with_id(ID)
    }
}
fn png_dimensions(png: &str) -> Option<(u32, u32)> {
    let mut bytes = Vec::with_capacity(24);
    let mut bits = 0u32;
    let mut count = 0;
    for ch in png.bytes().take(32) {
        let value = match ch {
            b'A'..=b'Z' => ch - b'A',
            b'a'..=b'z' => ch - b'a' + 26,
            b'0'..=b'9' => ch - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        };
        bits = (bits << 6) | value as u32;
        count += 6;
        if count >= 8 {
            count -= 8;
            bytes.push((bits >> count) as u8);
            bits &= (1 << count) - 1;
        }
    }
    if bytes.len() < 24
        || bytes[..8] != [137, 80, 78, 71, 13, 10, 26, 10]
        || &bytes[12..16] != b"IHDR"
    {
        return None;
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().ok()?);
    let height = u32::from_be_bytes(bytes[20..24].try_into().ok()?);
    (width > 0 && height > 0).then_some((width, height))
}
fn fit_ratio(bounds: Rect, width: u32, height: u32, cell_ratio: f64) -> Rect {
    if bounds.area() == 0 {
        return bounds;
    }
    let ratio = width as f64 / height as f64 / cell_ratio;
    let w = (bounds.height as f64 * ratio)
        .floor()
        .max(1.0)
        .min(bounds.width as f64) as u16;
    let h = (w as f64 / ratio)
        .floor()
        .max(1.0)
        .min(bounds.height as f64) as u16;
    Rect::new(
        bounds.x + (bounds.width - w) / 2,
        bounds.y + (bounds.height - h) / 2,
        w,
        h,
    )
}
pub fn fit_image(png: &str, bounds: Rect) -> Rect {
    let (width, height) = png_dimensions(png).unwrap_or((1, 1));
    let cell_ratio = crossterm::terminal::window_size()
        .ok()
        .filter(|s| s.width > 0 && s.height > 0 && s.columns > 0 && s.rows > 0)
        .map(|s| s.width as f64 / s.columns as f64 / (s.height as f64 / s.rows as f64))
        .unwrap_or(0.5);
    fit_ratio(bounds, width, height, cell_ratio)
}
pub fn supported() -> bool {
    std::env::var_os("KITTY_WINDOW_ID").is_some()
        || std::env::var("TERM").unwrap_or_default().contains("kitty")
}
pub fn encode(png: &str, rect: Rect) -> String {
    encode_id(png, rect, ID)
}
fn encode_id(png: &str, rect: Rect, id: u32) -> String {
    if png.is_empty()
        || png.len() > 3 * 1024 * 1024
        || !png
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"+/=".contains(&c))
    {
        return String::new();
    }
    let mut output = format!("\x1b7\x1b[{};{}H", rect.y + 1, rect.x + 1);
    let chunks = png.as_bytes().chunks(4096);
    let total = chunks.len();
    for (i, chunk) in chunks.enumerate() {
        let more = if i + 1 < total { 1 } else { 0 };
        let prefix = if i == 0 {
            format!(
                "a=T,f=100,t=d,i={id},q=2,C=1,z=1,c={},r={},m={more}",
                rect.width, rect.height
            )
        } else {
            format!("m={more}")
        };
        output.push_str(&format!(
            "\x1b_G{};{}\x1b\\",
            prefix,
            std::str::from_utf8(chunk).unwrap()
        ));
    }
    output.push_str("\x1b8");
    output
}
impl Cover {
    pub fn with_id(id: u32) -> Self {
        Self { last: None, id }
    }
    pub fn invalidate(&mut self) -> io::Result<()> {
        self.clear()
    }
    pub fn clear(&mut self) -> io::Result<()> {
        if self.last.take().is_some() {
            let mut out = io::stdout();
            write!(out, "\x1b_Ga=d,d=I,i={},q=2\x1b\\", self.id)?;
            out.flush()?;
        }
        Ok(())
    }
    pub fn show(&mut self, png: &str, rect: Rect) -> io::Result<()> {
        if self
            .last
            .as_ref()
            .is_some_and(|(r, p)| *r == rect && p == png)
        {
            return Ok(());
        }
        self.clear()?;
        let data = if self.id == ID {
            encode(png, rect)
        } else {
            encode_id(png, rect, self.id)
        };
        if data.is_empty() {
            return Ok(());
        }
        let mut out = io::stdout();
        out.write_all(data.as_bytes())?;
        out.flush()?;
        self.last = Some((rect, png.to_string()));
        Ok(())
    }
}
impl Drop for Cover {
    fn drop(&mut self) {
        let _ = self.clear();
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn original_image_ratio_fits_and_centers_in_small_and_large_areas() {
        let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGN8AAAAASUVORK5CYII=";
        assert_eq!(png_dimensions(png), Some((1, 1)));
        assert_eq!(png_dimensions("bad"), None);
        assert_eq!(
            fit_ratio(Rect::new(2, 3, 32, 8), 1, 1, 0.5),
            Rect::new(10, 3, 16, 8)
        );
        assert_eq!(
            fit_ratio(Rect::new(2, 3, 32, 16), 1, 2, 0.5),
            Rect::new(10, 3, 16, 16)
        );
        assert_eq!(
            fit_ratio(Rect::new(2, 3, 32, 16), 2, 1, 0.5),
            Rect::new(2, 7, 32, 8)
        );
        assert_eq!(
            fit_ratio(Rect::new(0, 0, 30, 15), 1, 1, 0.6),
            Rect::new(2, 0, 25, 15)
        );
        assert_eq!(fit_ratio(Rect::default(), 1, 1, 0.5), Rect::default());
    }
    #[test]
    fn protocol_chunks_and_rejects_control_injection() {
        let s = encode(&"A".repeat(9000), Rect::new(3, 4, 32, 16));
        assert_eq!(s.matches("\x1b_G").count(), 3);
        assert!(s.contains("m=0;"));
        assert!(s.starts_with("\x1b7\x1b[5;4H"));
        assert!(encode("abc\x1b", Rect::default()).is_empty());
    }
}

// Restore complete graphemes, never paint a space over the continuation of a CJK
// character. Old multicell footprints may cut through newly positioned labels.
fn restore_cells(
    frame: &mut ratatui::Frame,
    rects: impl IntoIterator<Item = Rect>,
) -> Vec<(u16, u16, ratatui::buffer::Cell)> {
    let rects: Vec<_> = rects.into_iter().collect();
    let area = frame.area();
    let mut result = Vec::new();
    for y in area.y..area.bottom() {
        let mut ranges = rects.iter().filter(|r| y >= r.y && y < r.bottom());
        let Some(first) = ranges.next() else {
            continue;
        };
        let (mut left, mut right) = (first.x, first.right());
        for r in ranges {
            left = left.min(r.x);
            right = right.max(r.right());
        }
        let mut x = area.x;
        while x < right.min(area.right()) {
            let Some(cell) = frame.buffer_mut().cell((x, y)) else {
                break;
            };
            let width = ratatui::text::Line::from(cell.symbol()).width().max(1) as u16;
            if x + width > left && x < right {
                let mut cell = cell.clone();
                cell.set_diff_option(ratatui::buffer::CellDiffOption::None);
                result.push((x, y, cell));
            }
            x += width;
        }
    }
    result
}

// Keep OSC 66 cells out of Ratatui's diff. Redraw only when the icon layer changes.
#[derive(Default)]
pub struct TextIcons {
    icons: Vec<(Rect, String)>,
    cells: Vec<(u16, u16, ratatui::buffer::Cell)>,
    clear: Vec<(u16, u16, ratatui::buffer::Cell)>,
    dirty: bool,
    invalid: bool,
}
impl TextIcons {
    pub fn invalidate(&mut self) {
        self.invalid = true;
    }
    pub fn capture(&mut self, frame: &mut ratatui::Frame, icons: &[(Rect, String)]) {
        let mut cells = Vec::new();
        for (rect, _) in icons {
            for y in rect.y..rect.bottom() {
                for x in rect.x..rect.right() {
                    if let Some(cell) = frame.buffer_mut().cell_mut((x, y)) {
                        cells.push((x, y, cell.clone()));
                        cell.set_diff_option(ratatui::buffer::CellDiffOption::Skip);
                    }
                }
            }
        }
        self.dirty = self.invalid || self.icons != icons || self.cells != cells;
        self.invalid = false;
        self.clear.clear();
        if self.dirty {
            self.clear = restore_cells(frame, self.icons.iter().map(|(r, _)| *r));
        }
        self.icons = icons.to_vec();
        self.cells = cells;
    }
    pub fn paint<B: ratatui::backend::Backend<Error = io::Error>>(
        &mut self,
        backend: &mut B,
    ) -> io::Result<()> {
        if !self.dirty {
            return Ok(());
        }
        backend.draw(self.clear.iter().map(|(x, y, cell)| (*x, *y, cell)))?;
        self.clear.clear();
        self.dirty = false;
        if self.icons.is_empty() {
            return Ok(());
        }
        let mut out = io::stdout();
        let ratatui::style::Color::Rgb(red, green, blue) = crate::theme::current().accent else {
            return Ok(());
        };
        write!(out, "\x1b7\x1b[38;2;{red};{green};{blue}m")?;
        for (r, glyph) in &self.icons {
            if !glyph.chars().any(char::is_control) {
                if let Some((_, _, cell)) =
                    self.cells.iter().find(|(x, y, _)| *x == r.x && *y == r.y)
                {
                    let foreground = if matches!(cell.fg, ratatui::style::Color::Rgb(..)) {
                        cell.fg
                    } else {
                        crate::theme::current().accent
                    };
                    if let ratatui::style::Color::Rgb(red, green, blue) = foreground {
                        write!(out, "\x1b[38;2;{red};{green};{blue}m")?;
                    }
                    if let ratatui::style::Color::Rgb(red, green, blue) = cell.bg {
                        write!(out, "\x1b[48;2;{red};{green};{blue}m")?;
                    }
                }
                write!(
                    out,
                    "\x1b[{};{}H\x1b]66;s=2:w=2;{}\x1b\\",
                    r.y + 1,
                    r.x + 1,
                    glyph
                )?;
            }
        }
        write!(out, "\x1b[0m\x1b8")?;
        out.flush()
    }
}
#[cfg(test)]
mod icon_tests {
    use super::*;
    use ratatui::{Terminal, backend::TestBackend};
    #[test]
    fn restoring_old_icons_preserves_whole_chinese_labels() {
        let mut terminal = Terminal::new(TestBackend::new(30, 4)).unwrap();
        let mut layer = TextIcons::default();
        terminal
            .draw(|f| layer.capture(f, &[(Rect::new(2, 1, 4, 2), "\u{f015}".into())]))
            .unwrap();
        terminal
            .draw(|f| {
                f.render_widget(
                    ratatui::widgets::Paragraph::new("主页"),
                    Rect::new(4, 1, 10, 1),
                );
                layer.capture(f, &[]);
            })
            .unwrap();
        assert!(
            layer
                .clear
                .iter()
                .any(|(x, y, c)| *x == 4 && *y == 1 && c.symbol() == "主")
        );
        assert!(
            !layer.clear.iter().any(|(x, y, _)| *x == 5 && *y == 1),
            "continuation cell must never erase 主"
        );
    }
    #[test]
    fn unchanged_icons_are_not_erased_or_repainted() {
        let mut terminal = Terminal::new(TestBackend::new(40, 10)).unwrap();
        let mut layer = TextIcons::default();
        let icons = vec![(Rect::new(2, 2, 4, 2), "\u{f015}".into())];
        terminal.draw(|frame| layer.capture(frame, &icons)).unwrap();
        assert!(layer.dirty);
        for _ in 0..20 {
            terminal.draw(|frame| layer.capture(frame, &icons)).unwrap();
            assert!(!layer.dirty);
            assert!(layer.clear.is_empty());
        }
        layer.invalidate();
        terminal.draw(|frame| layer.capture(frame, &icons)).unwrap();
        assert!(layer.dirty);
        terminal.draw(|frame| layer.capture(frame, &[])).unwrap();
        assert!(layer.dirty);
        assert_eq!(layer.clear.len(), 8);
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct LargeLine {
    pub vertical: u8,
    pub fraction: Option<(u8, u8)>,
    pub rect: Rect,
    pub text: String,
    pub color: ratatui::style::Color,
}
#[derive(Default)]
pub struct LyricsText {
    icons: Vec<LargeLine>,
    cells: Vec<(u16, u16, ratatui::buffer::Cell)>,
    clear: Vec<(u16, u16, ratatui::buffer::Cell)>,
    dirty: bool,
    invalid: bool,
    erase: Vec<Rect>,
}
impl LyricsText {
    pub fn invalidate(&mut self) {
        self.invalid = true;
    }
    pub fn capture(&mut self, frame: &mut ratatui::Frame, icons: &[LargeLine]) {
        let mut cells = Vec::new();
        for item in icons {
            let rect = item.rect;
            for y in rect.y..rect.bottom() {
                for x in rect.x..rect.right() {
                    if let Some(cell) = frame.buffer_mut().cell_mut((x, y)) {
                        cells.push((x, y, cell.clone()));
                        cell.set_diff_option(ratatui::buffer::CellDiffOption::Skip);
                    }
                }
            }
        }
        self.dirty = self.invalid || self.icons != icons || self.cells != cells;
        self.invalid = false;
        self.clear.clear();
        self.erase.clear();
        if self.dirty {
            self.erase = self.icons.iter().map(|item| item.rect).collect();
            self.clear = restore_cells(frame, self.icons.iter().map(|item| item.rect));
        }
        self.icons = icons.to_vec();
        self.cells = cells;
    }
    // Remove old multicells BEFORE Ratatui writes normal text over them. Writing
    // into a still-live multicell changes Kitty's cursor advance, so the backend's
    // consecutive-cell optimization can otherwise erase the panel to its right.
    // The current frame's cells are restored in paint(), after the normal diff.
    pub fn erase_previous(&mut self, out: &mut impl Write) -> io::Result<()> {
        if self.erase.is_empty() {
            return Ok(());
        }
        write!(out, "\x1b7\x1b[0m")?;
        for rect in &self.erase {
            for y in rect.y..rect.bottom() {
                write!(
                    out,
                    "\x1b[{};{}H{}",
                    y + 1,
                    rect.x + 1,
                    " ".repeat(rect.width as usize)
                )?;
            }
        }
        write!(out, "\x1b8")?;
        out.flush()?;
        self.erase.clear();
        Ok(())
    }
    pub fn paint<B: ratatui::backend::Backend<Error = io::Error>>(
        &mut self,
        backend: &mut B,
    ) -> io::Result<()> {
        if !self.dirty {
            return Ok(());
        }
        backend.draw(self.clear.iter().map(|(x, y, cell)| (*x, *y, cell)))?;
        self.clear.clear();
        self.dirty = false;
        if self.icons.is_empty() {
            return Ok(());
        }
        let mut out = io::stdout();
        write!(out, "\x1b7\x1b[1m")?;
        for item in &self.icons {
            let r = item.rect;
            let glyph = &item.text;
            if !glyph.chars().any(char::is_control)
                && r.height == 2
                && r.width > 0
                && r.width <= 14
                && r.width % 2 == 0
            {
                if let ratatui::style::Color::Rgb(red, green, blue) = item.color {
                    write!(out, "\x1b[38;2;{red};{green};{blue}m")?;
                }
                if let Some((_, _, cell)) =
                    self.cells.iter().find(|(x, y, _)| *x == r.x && *y == r.y)
                {
                    if let ratatui::style::Color::Rgb(red, green, blue) = cell.bg {
                        write!(out, "\x1b[48;2;{red};{green};{blue}m")?;
                    }
                }
                if let Some((n, d)) = item.fraction {
                    write!(
                        out,
                        "\x1b[{};{}H\x1b]66;s=2:n={n}:d={d}:w={}:v={}:h=0;{}\x1b\\",
                        r.y + 1,
                        r.x + 1,
                        r.width / 2,
                        item.vertical,
                        glyph
                    )?;
                } else {
                    write!(
                        out,
                        "\x1b[{};{}H\x1b]66;s=2:w={};{}\x1b\\",
                        r.y + 1,
                        r.x + 1,
                        r.width / 2,
                        glyph
                    )?;
                }
            }
        }
        write!(out, "\x1b[0m\x1b8")?;
        out.flush()
    }
}
