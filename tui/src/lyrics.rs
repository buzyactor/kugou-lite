use crate::{kitty, theme};
use ratatui::{
    Frame,
    layout::{Alignment, Rect},
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::Paragraph,
};
use serde_json::Value;
// One shared inset for drawing, wrapping and mouse scrolling. Keep multicell
// text away from panel borders even when its font has overhanging glyphs.
pub fn content_area(panel: Rect) -> Rect {
    let inner = crate::theme::panel().inner(panel);
    let inset = if inner.width >= 12 {
        2
    } else if inner.width >= 6 {
        1
    } else {
        0
    };
    Rect::new(
        inner.x + inset,
        inner.y,
        inner.width.saturating_sub(inset * 2),
        inner.height,
    )
}
pub fn current(media: &Value, seconds: f64) -> Option<&Value> {
    if !seconds.is_finite() {
        return None;
    }
    media["lyrics"].as_array()?.iter().rfind(|line| {
        line["start"]
            .as_f64()
            .is_some_and(|start| start <= seconds * 1000.0)
    })
}
pub fn text(line: &Value) -> String {
    line["words"]
        .as_array()
        .map(|words| {
            words
                .iter()
                .filter_map(|w| w["text"].as_str())
                .collect::<String>()
        })
        .unwrap_or_else(|| line["text"].as_str().unwrap_or("").to_string())
}
fn translated(line: &Value, enabled: bool) -> bool {
    enabled
        && line["translation"]
            .as_str()
            .is_some_and(|s| !s.trim().is_empty())
}
fn karaoke(line: &Value, ms: f64, active: bool) -> Vec<Span<'static>> {
    let mut spans = Vec::new();
    if let Some(words) = line["words"].as_array() {
        for word in words {
            let word_text = word["text"].as_str().unwrap_or("");
            let progress = ((ms - word["start"].as_f64().unwrap_or(0.0))
                / word["duration"].as_f64().unwrap_or(1.0).max(1.0))
            .clamp(0.0, 1.0);
            let completed = (progress * word_text.chars().count() as f64).floor() as usize;
            for (index, ch) in word_text.chars().enumerate() {
                let fg = if active {
                    if line["lineTimed"] == true
                        || (index == completed && progress > 0.0 && progress < 1.0)
                    {
                        theme::current().lyrics[6]
                    } else if index < completed {
                        theme::current().lyrics[0]
                    } else {
                        theme::current().lyrics[2]
                    }
                } else if line["start"].as_f64().unwrap_or(0.0) < ms {
                    theme::current().lyrics[5]
                } else {
                    theme::current().lyrics[1]
                };
                spans.push(Span::styled(ch.to_string(), Style::default().fg(fg)));
            }
        }
    } else {
        spans.push(Span::styled(
            text(line),
            Style::default().fg(if active {
                theme::current().lyrics[6]
            } else if line["start"].as_f64().unwrap_or(0.0) < ms {
                theme::current().lyrics[5]
            } else {
                theme::current().lyrics[1]
            }),
        ));
    }
    spans
}

#[derive(Clone, Copy, Debug)]
enum TextSize {
    Normal,
    Medium,
    Large,
}
impl TextSize {
    fn fraction(self) -> Option<(u8, u8)> {
        match self {
            Self::Medium => Some((3, 4)),
            _ => None,
        }
    }
    fn cells(self, width: usize) -> u16 {
        if matches!(self, Self::Normal) {
            width as u16
        } else if let Some((n, d)) = self.fraction() {
            (width * n as usize).div_ceil(d as usize) as u16 * 2
        } else {
            width as u16 * 2
        }
    }
    fn height(self) -> u16 {
        if matches!(self, Self::Normal) { 1 } else { 2 }
    }
}
#[derive(Clone, Debug)]
struct Chunk {
    text: String,
    style: Style,
    width: u16,
}
#[derive(Clone, Debug, Default)]
struct Row {
    chunks: Vec<Chunk>,
    width: u16,
}
fn english(ch: char) -> bool {
    (ch.is_ascii() && !ch.is_ascii_whitespace()) || matches!(ch, '’' | '‘' | '–' | '—')
}
// Keep a connected English run, including /, -, and other punctuation, together
// BEFORE rounding fractional cells. Only actual whitespace separates its words.
// Chinese remains individually timed; an English word highlights as one unit.
fn tokens(spans: Vec<Span<'static>>) -> Vec<(String, Style)> {
    let mut result: Vec<(String, Style)> = Vec::new();
    for span in spans {
        for ch in span
            .content
            .chars()
            .filter(|ch| !ch.is_control() || *ch == '\n')
        {
            if english(ch) {
                if let Some(last) = result
                    .last_mut()
                    .filter(|(text, _)| text.chars().all(english))
                {
                    last.0.push(ch);
                    let colors = theme::current().lyrics;
                    if span.style.fg == Some(colors[6])
                        || last.1.fg == Some(colors[6])
                        || (last.1.fg == Some(colors[0]) && span.style.fg == Some(colors[2]))
                        || (last.1.fg == Some(colors[2]) && span.style.fg == Some(colors[0]))
                    {
                        last.1 = Style::default().fg(colors[6]);
                    } else if span.style.fg == Some(colors[0]) {
                        last.1 = span.style;
                    }
                    continue;
                }
            } else if Line::from(ch.to_string()).width() == 0 && ch != '\n' {
                if let Some(last) = result.last_mut() {
                    last.0.push(ch);
                }
                continue;
            }
            result.push((ch.to_string(), span.style));
        }
    }
    result
}
fn chunks(text: &str, style: Style, size: TextSize) -> Vec<Chunk> {
    let mut result = Vec::new();
    let mut part = String::new();
    let mut width = 0;
    for ch in text.chars() {
        let w = Line::from(ch.to_string()).width();
        // Eight native cells give exact 1.5x/1.25x advances, avoiding internal
        // fractional gaps in words longer than the OSC 66 width limit.
        let limit = if matches!(size, TextSize::Large) {
            7
        } else {
            8
        };
        if width + w > limit && !part.is_empty() {
            result.push(Chunk {
                text: std::mem::take(&mut part),
                style,
                width: size.cells(width),
            });
            width = 0;
        }
        part.push(ch);
        width += w;
    }
    if !part.is_empty() {
        result.push(Chunk {
            text: part,
            style,
            width: size.cells(width),
        });
    }
    result
}
fn wrap(spans: Vec<Span<'static>>, size: TextSize, width: u16) -> Vec<Row> {
    let mut rows = vec![Row::default()];
    if width == 0 {
        return rows;
    }
    let mut pending: Vec<Chunk> = Vec::new();
    for (text, style) in tokens(spans) {
        if text == "\n" {
            rows.push(Row::default());
            pending.clear();
            continue;
        }
        if text.chars().all(char::is_whitespace) {
            pending.extend(chunks(&text, style, size));
            continue;
        }
        let word = chunks(&text, style, size);
        let word_width = word.iter().map(|c| c.width).sum::<u16>();
        let space = pending.iter().map(|c| c.width).sum::<u16>();
        if rows.last().unwrap().width > 0 && rows.last().unwrap().width + space + word_width > width
        {
            rows.push(Row::default());
            pending.clear();
        }
        if rows.last().unwrap().width > 0 {
            let row = rows.last_mut().unwrap();
            for chunk in pending.drain(..) {
                row.width += chunk.width;
                row.chunks.push(chunk);
            }
        } else {
            pending.clear();
        }
        for chunk in word {
            // A very long word can span rows; ordinary words stay intact.
            if chunk.width > width {
                for ch in chunk.text.chars() {
                    let w = size.cells(Line::from(ch.to_string()).width());
                    if rows.last().unwrap().width + w > width && rows.last().unwrap().width > 0 {
                        rows.push(Row::default());
                    }
                    let row = rows.last_mut().unwrap();
                    // Last-resort compact glyph on exceptionally narrow terminals.
                    row.chunks.push(Chunk {
                        text: ch.to_string(),
                        style: chunk.style,
                        width: w.min(width),
                    });
                    row.width += w.min(width);
                }
            } else {
                if rows.last().unwrap().width + chunk.width > width {
                    rows.push(Row::default());
                }
                let row = rows.last_mut().unwrap();
                row.width += chunk.width;
                row.chunks.push(chunk);
            }
        }
    }
    rows
}
struct Entry {
    original: Vec<Row>,
    translated: Vec<Row>,
    start: u32,
    height: u32,
    size: TextSize,
    translation_size: TextSize,
}
struct Layout {
    entries: Vec<Entry>,
    total: u32,
}
fn layout(media: &Value, seconds: f64, area: Rect, translation: bool, scaled: bool) -> Layout {
    let Some(lines) = media["lyrics"].as_array() else {
        return Layout {
            entries: vec![],
            total: 0,
        };
    };
    let current = lines
        .iter()
        .rposition(|l| l["start"].as_f64().unwrap_or(0.0) <= seconds * 1000.0)
        .unwrap_or(0);
    let enabled = scaled
        && media["scaleLyrics"].as_bool().unwrap_or(true)
        && area.height >= 12
        && area.width >= 16;
    let enlarged = enabled && media["largeLyric"].as_bool().unwrap_or(false);
    let mut entries = Vec::new();
    let mut start = 0;
    for (i, line) in lines.iter().enumerate() {
        let size = if i == current && enlarged {
            TextSize::Large
        } else if i == current && enabled {
            TextSize::Medium
        } else {
            TextSize::Normal
        };
        let translation_size = if !enabled {
            TextSize::Normal
        } else if i == current && enlarged {
            TextSize::Large
        } else {
            TextSize::Normal
        };
        // Inactive originals use the same compact grid as their translation.
        // Only the current entry expands; scrolling eases to its new height.
        let wrap_size = size;
        let original = wrap(
            karaoke(line, seconds * 1000.0, i == current),
            wrap_size,
            area.width,
        );
        let translated = if translated(line, translation) {
            wrap(
                vec![Span::styled(
                    line["translation"].as_str().unwrap_or("").to_string(),
                    Style::default().fg(if i == current {
                        theme::current().lyrics[3]
                    } else {
                        theme::current().lyrics[4]
                    }),
                )],
                translation_size,
                area.width,
            )
        } else {
            vec![]
        };
        let height = original.len() as u32 * size.height() as u32
            + translated.len() as u32 * translation_size.height() as u32;
        entries.push(Entry {
            original,
            translated,
            start,
            height,
            size,
            translation_size,
        });
        // Original and translation are adjacent; one empty row separates units.
        start += height + u32::from(i + 1 < lines.len());
    }
    Layout {
        total: start,
        entries,
    }
}
#[derive(Default)]
pub struct ScrollState {
    key: String,
    position: f64,
    from: f64,
    target: f64,
    started: Option<std::time::Instant>,
    last: Option<std::time::Instant>,
    cache: Option<Layout>,
    cache_key: String,
    cache_lyrics: Value,
}
impl ScrollState {
    fn offset(&mut self, key: String, target: f64, height: u16, now: std::time::Instant) -> f64 {
        let elapsed = self
            .started
            .map_or(1.0, |start| {
                now.saturating_duration_since(start).as_secs_f64() / 0.36
            })
            .min(1.0);
        self.position = self.from + (self.target - self.from) * (1.0 - (1.0 - elapsed).powi(3));
        let stale = self
            .last
            .is_none_or(|last| now.saturating_duration_since(last).as_millis() > 500);
        if self.key != key || stale || (target - self.position).abs() > height.max(1) as f64 * 2.0 {
            self.key = key;
            self.position = target;
            self.from = target;
            self.target = target;
            self.started = None;
        } else if (self.target - target).abs() > 0.01 {
            self.from = self.position;
            self.target = target;
            self.started = Some(now);
        }
        self.last = Some(now);
        self.position
    }
}
fn target(layout: &Layout, media: &Value, seconds: f64, height: u16) -> f64 {
    let current = media["lyrics"]
        .as_array()
        .and_then(|lines| {
            lines
                .iter()
                .rposition(|l| l["start"].as_f64().unwrap_or(0.0) <= seconds * 1000.0)
        })
        .unwrap_or(0);
    let index = media["lyricFirst"]
        .as_u64()
        .map(|i| i as usize)
        .unwrap_or(current)
        .min(layout.entries.len().saturating_sub(1));
    let Some(entry) = layout.entries.get(index) else {
        return 0.0;
    };
    let desired = if media["lyricFirst"].is_number() {
        entry.start as f64
    } else {
        entry.start as f64 + entry.height as f64 / 2.0 - height as f64 / 2.0
    };
    desired.clamp(0.0, layout.total.saturating_sub(height as u32) as f64)
}
fn paint_row(
    frame: &mut Frame,
    area: Rect,
    row: &Row,
    size: TextSize,
    y: f64,
    align: Alignment,
    layers: &mut Vec<kitty::LargeLine>,
) {
    let scaled = !matches!(size, TextSize::Normal) && kitty::supported();
    let height = size.height();
    let screen_y = y.round() as i32;
    // Never draw half a multicell glyph over the surrounding frame.
    if screen_y < area.y as i32 || screen_y + height as i32 > area.bottom() as i32 {
        return;
    }
    // Repack whole words at their real font size after the conservative wrap.
    let mut chunks = Vec::new();
    for (text, style) in tokens(
        row.chunks
            .iter()
            .map(|chunk| Span::styled(chunk.text.clone(), chunk.style))
            .collect(),
    ) {
        chunks.extend(self::chunks(&text, style, size));
    }
    let width = chunks.iter().map(|c| c.width).sum::<u16>();
    let mut x = area.x
        + match align {
            Alignment::Center => area.width.saturating_sub(width) / 2,
            Alignment::Right => area.width.saturating_sub(width),
            _ => 0,
        };
    let edge = ((screen_y - area.y as i32).min(area.bottom() as i32 - screen_y - height as i32)
        as f64
        / 3.0)
        .clamp(0.25, 1.0);
    if scaled {
        for chunk in chunks {
            if chunk.width == 0 || x + chunk.width > area.right() {
                continue;
            }
            let fg = chunk.style.fg.unwrap_or(theme::current().foreground);
            layers.push(kitty::LargeLine {
                rect: Rect::new(x, screen_y as u16, chunk.width, height),
                text: chunk.text,
                color: theme::blend(theme::current().lyric_panel.background, fg, edge),
                fraction: size.fraction(),
                vertical: if y - (screen_y as f64) > 0.15 {
                    1
                } else if y - (screen_y as f64) < -0.15 {
                    0
                } else {
                    2
                },
            });
            x += chunk.width;
        }
    } else {
        let spans = chunks
            .into_iter()
            .map(|c| {
                Span::styled(
                    c.text,
                    c.style.fg(theme::blend(
                        theme::current().lyric_panel.background,
                        c.style.fg.unwrap_or(theme::current().foreground),
                        edge,
                    )),
                )
            })
            .collect::<Vec<_>>();
        frame.render_widget(
            Paragraph::new(Line::from(spans))
                .alignment(align)
                .style(Style::default().add_modifier(Modifier::BOLD)),
            Rect::new(area.x, screen_y as u16, area.width, height),
        );
    }
}
pub fn automatic_first(media: &Value, seconds: f64, area: Rect, translation: bool) -> usize {
    let layout = layout(media, seconds, area, translation, kitty::supported());
    let offset = target(&layout, media, seconds, area.height);
    layout
        .entries
        .iter()
        .position(|e| e.start as f64 + e.height as f64 > offset)
        .unwrap_or(0)
}
pub fn render(
    frame: &mut Frame,
    area: Rect,
    media: &Value,
    seconds: f64,
    translation: bool,
    layers: &mut Vec<kitty::LargeLine>,
    scroll: &mut ScrollState,
) {
    if area.width == 0 || area.height == 0 {
        return;
    }
    let Some(lines) = media["lyrics"].as_array().filter(|lines| !lines.is_empty()) else {
        frame.render_widget(
            Paragraph::new("暂无逐字歌词 / 正在加载").alignment(Alignment::Center),
            area,
        );
        return;
    };
    let current = lines
        .iter()
        .rposition(|l| l["start"].as_f64().unwrap_or(0.0) <= seconds * 1000.0)
        .unwrap_or(0);
    let key = format!(
        "{}:{}:{}:{}:{}:{}:{}",
        media["title"],
        text(&lines[0]),
        area.width,
        area.height,
        translation,
        media["scaleLyrics"],
        media["largeLyric"]
    );
    let cache_key = format!("{key}:{current}:{}", theme::current().id);
    if scroll.cache.is_none()
        || scroll.cache_key != cache_key
        || scroll.cache_lyrics != media["lyrics"]
    {
        scroll.cache = Some(layout(
            media,
            seconds,
            area,
            translation,
            kitty::supported(),
        ));
        scroll.cache_key = cache_key;
        scroll.cache_lyrics = media["lyrics"].clone();
    } else if let Some(entry) = scroll
        .cache
        .as_mut()
        .and_then(|layout| layout.entries.get_mut(current))
    {
        let wrap_size = entry.size;
        entry.original = wrap(
            karaoke(&lines[current], seconds * 1000.0, true),
            wrap_size,
            area.width,
        );
    }
    let desired = target(scroll.cache.as_ref().unwrap(), media, seconds, area.height);
    let offset = scroll.offset(key, desired, area.height, std::time::Instant::now());
    let layout = scroll.cache.as_ref().unwrap();
    let align = match media["lyricAlign"].as_u64().unwrap_or(1) {
        0 => Alignment::Left,
        2 => Alignment::Right,
        _ => Alignment::Center,
    };
    let pad = (area.height as u32).saturating_sub(layout.total) as f64 / 2.0;
    for entry in &layout.entries {
        let mut y = area.y as f64 + entry.start as f64 - offset + pad;
        if y + (entry.height as f64) < area.y as f64 || y > area.bottom() as f64 {
            continue;
        }
        for row in &entry.original {
            paint_row(frame, area, row, entry.size, y, align, layers);
            y += entry.size.height() as f64;
        }
        for row in &entry.translated {
            paint_row(frame, area, row, entry.translation_size, y, align, layers);
            y += entry.translation_size.height() as f64;
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn distinct_karaoke_states_and_compact_inactive_translation() {
        let line = serde_json::json!({"start":1000,"words":[{"text":"中文歌词","start":1000,"duration":1000}],"translation":"translation"});
        let spans = karaoke(&line, 1500.0, true);
        let colors = theme::current().lyrics;
        assert_eq!(
            spans
                .iter()
                .map(|s| s.style.fg.unwrap())
                .collect::<Vec<_>>(),
            vec![colors[0], colors[0], colors[6], colors[2]]
        );
        assert!(
            karaoke(&line, 2500.0, false)
                .iter()
                .all(|s| s.style.fg == Some(colors[5]))
        );
        assert!(
            karaoke(&line, 0.0, false)
                .iter()
                .all(|s| s.style.fg == Some(colors[1]))
        );
        let media = serde_json::json!({"scaleLyrics":true,"largeLyric":true,"lyrics":[line.clone(),{"start":3000,"text":"next","translation":"compact"}, {"start":5000,"text":"last"}]});
        let result = layout(&media, 1.5, Rect::new(0, 0, 60, 30), true, true);
        assert!(matches!(result.entries[1].size, TextSize::Normal));
        assert!(matches!(
            result.entries[1].translation_size,
            TextSize::Normal
        ));
        assert_eq!(
            result.entries[1].height, 2,
            "compact original and translation occupy consecutive rows"
        );
        assert_eq!(
            result.entries[2].start,
            result.entries[1].start + result.entries[1].height + 1,
            "units have exactly one blank row"
        );
    }
    #[test]
    fn lyric_units_have_no_internal_gap_and_exactly_one_between_units() {
        let media = serde_json::json!({"scaleLyrics":true,"largeLyric":true,"lyrics":[
            {"start":0,"text":"previous line","translation":"上一句译文"},
            {"start":1000,"text":"current line","translation":"当前译文"},
            {"start":2000,"text":"upcoming line","translation":"下一句译文"}
        ]});
        let layout = layout(&media, 1.2, Rect::new(0, 0, 80, 30), true, true);
        for i in [0, 2] {
            assert!(matches!(layout.entries[i].size, TextSize::Normal));
            assert_eq!(layout.entries[i].height, 2);
        }
        for pair in layout.entries.windows(2) {
            assert_eq!(pair[1].start, pair[0].start + pair[0].height + 1);
        }
        assert_eq!(
            layout.total,
            layout.entries.last().unwrap().start + layout.entries.last().unwrap().height
        );
    }
    #[test]
    fn lyric_content_stays_inside_the_frame_with_horizontal_padding() {
        for width in 1..100 {
            let panel = Rect::new(10, 4, width, 30);
            let area = content_area(panel);
            assert!(area.x >= panel.x && area.right() <= panel.right());
            if width >= 14 {
                assert_eq!(area.x - panel.x, 3);
                assert_eq!(panel.right() - area.right(), 3);
            }
        }
    }
    #[test]
    fn words_do_not_split_at_color_changes_and_long_text_wraps() {
        let spans = vec![
            Span::styled("f", Style::default().fg(theme::current().accent)),
            Span::styled(
                "all moonlight",
                Style::default().fg(theme::current().foreground),
            ),
        ];
        let rows = wrap(spans, TextSize::Medium, 18);
        assert_eq!(rows[0].chunks[0].text, "fall");
        assert_eq!(
            rows.iter()
                .flat_map(|r| &r.chunks)
                .map(|c| c.text.as_str())
                .collect::<String>(),
            "fallmoonlight"
        );
        assert_eq!(rows.len(), 2);
        for width in [4, 8, 16, 32] {
            let rows = wrap(
                vec![Span::raw(
                    "中文歌词很长需要完整换行 abcdefghijklmnopqrstuvwxyz",
                )],
                TextSize::Medium,
                width,
            );
            assert!(rows.iter().all(|r| r.width <= width));
            assert_eq!(
                rows.iter()
                    .flat_map(|r| &r.chunks)
                    .map(|c| c.text.as_str())
                    .collect::<String>()
                    .replace(' ', ""),
                "中文歌词很长需要完整换行abcdefghijklmnopqrstuvwxyz"
            );
        }
    }
    #[test]
    fn connected_punctuation_has_no_fractional_word_seams() {
        for text in ["a/b-c", "I'm/ok", "rock&roll", "moon/light", "end.word"] {
            let spans = text
                .chars()
                .enumerate()
                .map(|(i, ch)| {
                    Span::styled(
                        ch.to_string(),
                        Style::default()
                            .fg(theme::current().lyrics[if i % 2 == 0 { 0 } else { 2 }]),
                    )
                })
                .collect();
            let joined = tokens(spans);
            assert_eq!(joined.len(), 1, "punctuation must not split {text}");
            assert_eq!(joined[0].0, text);
            let rows = wrap(vec![Span::raw(text.to_string())], TextSize::Medium, 40);
            assert_eq!(rows.len(), 1);
            assert_eq!(rows[0].width, TextSize::Medium.cells(text.len()));
            assert_eq!(
                rows[0]
                    .chunks
                    .iter()
                    .map(|c| c.text.as_str())
                    .collect::<String>(),
                text
            );
        }
        assert_eq!(
            tokens(vec![Span::raw("a/b - c")])
                .iter()
                .map(|(text, _)| text.as_str())
                .collect::<Vec<_>>(),
            ["a/b", " ", "-", " ", "c"]
        );
    }
    #[test]
    fn scroll_eases_and_retargets_without_position_jumps() {
        let mut scroll = ScrollState::default();
        let now = std::time::Instant::now();
        assert_eq!(scroll.offset("song".into(), 0.0, 30, now), 0.0);
        assert_eq!(scroll.offset("song".into(), 6.0, 30, now), 0.0);
        let middle = scroll.offset(
            "song".into(),
            6.0,
            30,
            now + std::time::Duration::from_millis(100),
        );
        assert!(middle > 0.0 && middle < 6.0);
        let retarget = scroll.offset(
            "song".into(),
            9.0,
            30,
            now + std::time::Duration::from_millis(100),
        );
        assert_eq!(middle, retarget);
        assert!(
            (scroll.offset(
                "song".into(),
                9.0,
                30,
                now + std::time::Duration::from_millis(460)
            ) - 9.0)
                .abs()
                < 0.001
        );
        assert_eq!(
            scroll.offset(
                "new song".into(),
                0.0,
                30,
                now + std::time::Duration::from_millis(470)
            ),
            0.0
        );
    }
    #[test]
    fn scaling_can_be_disabled_without_disabling_wrap_or_translation() {
        let media = serde_json::json!({"scaleLyrics":false,"lyrics":[{"start":0,"text":"fall moonlight long words again","translation":"中文翻译也要完整显示"}]});
        let result = layout(&media, 1.0, Rect::new(0, 0, 12, 30), true, true);
        assert!(matches!(result.entries[0].size, TextSize::Normal));
        assert!(result.entries[0].original.len() > 1);
        assert!(!result.entries[0].translated.is_empty());
    }
}
