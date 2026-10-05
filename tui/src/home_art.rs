use ratatui::layout::Rect;
use std::sync::OnceLock;

// Embed the original PNG byte for byte; Kitty handles full-resolution rendering.
const PNG: &[u8] = include_bytes!("../../复古终端像素狼头音乐图标.png");
static ENCODED: OnceLock<String> = OnceLock::new();

pub fn png() -> &'static str {
    ENCODED.get_or_init(|| {
        const ALPHABET: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut encoded = String::with_capacity(PNG.len().div_ceil(3) * 4);
        for chunk in PNG.chunks(3) {
            let bits = (chunk[0] as u32) << 16
                | (chunk.get(1).copied().unwrap_or(0) as u32) << 8
                | chunk.get(2).copied().unwrap_or(0) as u32;
            encoded.push(ALPHABET[((bits >> 18) & 63) as usize] as char);
            encoded.push(ALPHABET[((bits >> 12) & 63) as usize] as char);
            encoded.push(if chunk.len() > 1 {
                ALPHABET[((bits >> 6) & 63) as usize] as char
            } else {
                '='
            });
            encoded.push(if chunk.len() > 2 {
                ALPHABET[(bits & 63) as usize] as char
            } else {
                '='
            });
        }
        encoded
    })
}

pub fn placement(bounds: Rect) -> Option<Rect> {
    if !crate::kitty::supported() || bounds.width < 12 || bounds.height < 6 {
        return None;
    }
    let mut rect = crate::kitty::fit_image(png(), bounds);
    rect.x = bounds.right() - rect.width;
    rect.y = bounds.bottom() - rect.height;
    Some(rect)
}
