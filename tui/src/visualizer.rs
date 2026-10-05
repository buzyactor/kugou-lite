use ratatui::{
    Frame,
    layout::Rect,
    style::{Color, Style},
    widgets::{BorderType, Paragraph, Wrap},
};
use serde_json::Value;

#[derive(Default)]
pub struct Animation {
    target: Vec<f64>,
    levels: Vec<f64>,
    peaks: Vec<f64>,
}
impl Animation {
    pub fn set(&mut self, spectrum: &Value) {
        let values: Vec<f64> = spectrum["bars"]
            .as_array()
            .map(|bars| {
                bars.iter()
                    .take(512)
                    .map(|n| n.as_f64().unwrap_or(0.0).clamp(0.0, 255.0) / 255.0)
                    .collect()
            })
            .unwrap_or_default();
        if values.is_empty() {
            self.target.fill(0.0);
        } else {
            if self.levels.len() != values.len() {
                self.levels.resize(values.len(), 0.0);
                self.peaks.resize(values.len(), 0.0);
            }
            self.target = values;
        }
    }
    pub fn advance(&mut self, dt: f64) {
        if !dt.is_finite() || dt <= 0.0 {
            return;
        }
        // Time-based easing gives the same response at 30/60 FPS. No invented motion.
        for ((level, peak), target) in self
            .levels
            .iter_mut()
            .zip(&mut self.peaks)
            .zip(&self.target)
        {
            let tau = if target > level { 0.025 } else { 0.14 };
            *level += (target - *level) * (1.0 - (-dt / tau).exp());
            if *level < 0.0001 {
                *level = 0.0;
            }
            *peak = level.max((*peak - dt * 0.65).max(0.0));
        }
    }
    pub fn frame(&self, source: &Value) -> Value {
        let mut frame = source.clone();
        frame["bars"] =
            serde_json::json!(self.levels.iter().map(|v| v * 255.0).collect::<Vec<_>>());
        frame["peaks"] =
            serde_json::json!(self.peaks.iter().map(|v| v * 255.0).collect::<Vec<_>>());
        frame
    }
}
fn values(spectrum: &Value, key: &str) -> Vec<f64> {
    spectrum[key]
        .as_array()
        .map(|bars| {
            bars.iter()
                .take(512)
                .map(|v| v.as_f64().unwrap_or(0.0).clamp(0.0, 255.0) / 255.0)
                .collect()
        })
        .unwrap_or_default()
}
// Cubic interpolation removes staircase edges between frequency bins.
fn sample(values: &[f64], position: f64, cyclic: bool) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let p = position.clamp(0.0, 1.0)
        * if cyclic {
            values.len() as f64
        } else {
            values.len().saturating_sub(1) as f64
        };
    let i = p.floor() as isize;
    let t = p - i as f64;
    let get = |index: isize| {
        values[if cyclic {
            index.rem_euclid(values.len() as isize) as usize
        } else {
            index.clamp(0, values.len() as isize - 1) as usize
        }]
    };
    let (a, b, c, d) = (get(i - 1), get(i), get(i + 1), get(i + 2));
    (0.5 * ((2.0 * b)
        + (-a + c) * t
        + (2.0 * a - 5.0 * b + 4.0 * c - d) * t * t
        + (-a + 3.0 * b - 3.0 * c + d) * t * t * t))
        .clamp(b.min(c), b.max(c))
}
fn gradient(y: u16, height: u16, brightness: f64) -> Color {
    let t = crate::theme::current();
    let color = crate::theme::blend(
        t.visualizer[0],
        t.visualizer[1],
        y as f64 / height.saturating_sub(1).max(1) as f64,
    );
    crate::theme::blend(t.visualizer[3], color, brightness)
}
pub fn draw(frame: &mut Frame, area: Rect, spectrum: &Value, mode: u8) {
    if area.width == 0 || area.height == 0 {
        return;
    }
    let mode = mode.min(3);
    let label = ["极光柱状", "镜像频谱", "点阵丝带", "环形脉冲"][mode as usize];
    let block = crate::theme::panel()
        .style(Style::default().bg(crate::theme::current().visualizer[3]))
        .title(format!(" CAVA · {label} "))
        .title_style(Style::default().fg(crate::theme::current().visualizer[4]))
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(crate::theme::current().visualizer[2]));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    if let Some(error) = spectrum["error"].as_str() {
        frame.render_widget(Paragraph::new(error).wrap(Wrap { trim: false }), inner);
        return;
    }
    let bars = values(spectrum, "bars");
    let peaks = values(spectrum, "peaks");
    let peaks = if peaks.is_empty() { &bars } else { &peaks };
    if inner.width == 0 || inner.height == 0 {
        return;
    }
    let group = if inner.width >= 24 { 3 } else { 2 };
    let groups = inner.width.div_ceil(group);
    let pw = inner.width as f64 * 2.0;
    let ph = inner.height as f64 * 4.0;
    // Braille subpixels have approximately square physical dimensions in Kitty.
    let ring_scale = (pw.min(ph) * 0.49).max(1.0);
    let masks = [[1u32, 8], [2, 16], [4, 32], [64, 128]];
    for y in 0..inner.height {
        for x in 0..inner.width {
            let glyph = if mode == 0 {
                let p = (x / group) as f64 / groups.saturating_sub(1).max(1) as f64;
                let amplitude = sample(&bars, p, false);
                let height = amplitude * inner.height as f64 * 8.0;
                let base = (inner.height - 1 - y) as f64 * 8.0;
                let level = (height - base).clamp(0.0, 8.0).round() as usize;
                if x % group == group - 1 {
                    ' '
                } else if level > 0 {
                    [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'][level]
                } else {
                    ' '
                }
            } else {
                let mut bits = 0;
                for (dy, row) in masks.iter().enumerate() {
                    for (dx, mask) in row.iter().enumerate() {
                        let px = x as f64 * 2.0 + dx as f64 + 0.5;
                        let py = y as f64 * 4.0 + dy as f64 + 0.5;
                        let p = px / pw;
                        let distance = (py - ph / 2.0).abs();
                        let lit = match mode {
                            1 => {
                                let position =
                                    (px / 6.0).floor() / ((pw / 6.0).ceil().max(2.0) - 1.0);
                                let amplitude = sample(&bars, position, false);
                                amplitude > 0.001
                                    && px as u16 % 6 < 4
                                    && distance <= amplitude * (ph / 2.0 - 1.0)
                            }
                            2 => {
                                let amplitude = sample(&bars, p, false);
                                let edge = amplitude * (ph * 0.45);
                                amplitude > 0.001
                                    && ((distance - edge).abs() < 0.75
                                        || (distance < edge
                                            && ((x as usize + dy) % 3 == 0)
                                            && dx == 0))
                            }
                            _ => {
                                let nx = (px - pw / 2.0) / ring_scale;
                                let ny = (py - ph / 2.0) / ring_scale;
                                let position =
                                    (ny.atan2(nx) + std::f64::consts::PI) / std::f64::consts::TAU;
                                let amplitude = sample(&bars, position, true);
                                let peak = sample(peaks, position, true);
                                let radius = 0.43 + amplitude * 0.53;
                                let peak_radius = 0.43 + peak * 0.53;
                                let distance = nx.hypot(ny);
                                let stroke = 0.85 / ring_scale;
                                (distance - 0.30).abs() <= stroke
                                    || amplitude > 0.001 && (distance - radius).abs() <= stroke
                                    || peak > amplitude + 0.04
                                        && (distance - peak_radius).abs() <= stroke * 0.6
                            }
                        };
                        if lit {
                            bits |= *mask;
                        }
                    }
                }
                if bits == 0 {
                    ' '
                } else {
                    char::from_u32(0x2800 + bits).unwrap_or(' ')
                }
            };
            if let Some(cell) = frame.buffer_mut().cell_mut((inner.x + x, inner.y + y)) {
                cell.set_char(glyph).set_fg(gradient(y, inner.height, 1.0));
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::{Terminal, backend::TestBackend};
    #[test]
    fn styles_respond_to_real_amplitude_and_handle_small_windows() {
        for mode in 0..4 {
            for (width, height) in [(1, 1), (12, 6), (24, 20), (64, 30)] {
                let mut t = Terminal::new(TestBackend::new(width, height)).unwrap();
                t.draw(|f| draw(f, f.area(), &serde_json::json!({"bars":vec![0;48]}), mode))
                    .unwrap();
                let silent = t.backend().buffer().clone();
                t.draw(|f| draw(f, f.area(), &serde_json::json!({"bars":vec![180;48]}), mode))
                    .unwrap();
                if width > 1 {
                    assert_ne!(&silent, t.backend().buffer(), "mode {mode}");
                }
            }
        }
    }
    #[test]
    fn easing_is_frame_rate_independent_and_returns_to_silence() {
        let mut a = Animation::default();
        let mut b = Animation::default();
        a.set(&serde_json::json!({"bars":vec![255;48]}));
        b.set(&serde_json::json!({"bars":vec![255;48]}));
        a.advance(0.016);
        assert!(a.levels[0] > 0.0 && a.levels[0] < 1.0);
        for _ in 0..59 {
            a.advance(0.016);
        }
        for _ in 0..30 {
            b.advance(0.032);
        }
        assert!((a.levels[0] - b.levels[0]).abs() < 1e-8);
        a.set(&serde_json::json!({"bars":[]}));
        a.advance(0.016);
        assert!(a.levels[0] > 0.5 && a.peaks[0] >= a.levels[0]);
        a.advance(5.0);
        assert_eq!(a.levels[0], 0.0);
        assert_eq!(a.peaks[0], 0.0);
    }
    #[test]
    fn interpolation_handles_single_bands_and_closes_the_ring() {
        assert_eq!(sample(&[0.5], 0.5, false), 0.5);
        assert_eq!(
            sample(&[0.2, 0.7, 0.4], 0.0, true),
            sample(&[0.2, 0.7, 0.4], 1.0, true)
        );
        for i in 0..100 {
            assert!((0.0..=1.0).contains(&sample(&[0.0, 1.0, 0.0], i as f64 / 100.0, false)));
        }
    }
}
