use ratatui::{
    style::{Color, Style},
    widgets::{Block, BorderType},
};
use std::sync::atomic::{AtomicUsize, Ordering};
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SectionColors {
    pub background: Color,
    pub border: Color,
    pub title: Color,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Palette {
    pub id: &'static str,
    pub name: &'static str,
    pub background: Color,
    pub foreground: Color,
    pub muted: Color,
    pub border: Color,
    pub surface: Color,
    pub accent: Color,
    pub secondary: Color,
    pub warning: Color,
    pub navigation: [Color; 9],
    pub nav_selected: [Color; 9],
    pub nav_background: Color,
    pub status: [Color; 13],
    pub progress: [Color; 3],
    pub footer: [Color; 5],
    pub sections: [SectionColors; 9],
    pub header: [Color; 4],
    pub nav_border: Color,
    pub cover: SectionColors,
    pub lyric_panel: SectionColors,
    pub lyrics: [Color; 7],
    pub visualizer: [Color; 5],
    pub notifications: [Color; 6],
}
const fn rgb(hex: u32) -> Color {
    Color::Rgb((hex >> 16) as u8, (hex >> 8) as u8, hex as u8)
}
pub const SECTIONS: [&str; 9] = [
    "home",
    "search",
    "playlists",
    "accounts",
    "playing",
    "queue",
    "recommend",
    "discover",
    "settings",
];
pub const STATUS_KEYS: [&str; 13] = [
    "background",
    "controls",
    "song",
    "quality",
    "bitrate",
    "volume",
    "mode",
    "queue",
    "time",
    "lyrics",
    "separator",
    "translation",
    "more",
];
const fn mix(a: u32, b: u32, n: u32) -> u32 {
    let r = (((a >> 16) & 255) * (100 - n) + ((b >> 16) & 255) * n) / 100;
    let g = (((a >> 8) & 255) * (100 - n) + ((b >> 8) & 255) * n) / 100;
    let blue = ((a & 255) * (100 - n) + (b & 255) * n) / 100;
    (r << 16) | (g << 8) | blue
}
const fn palette(id: &'static str, name: &'static str, c: [u32; 8]) -> Palette {
    let hues = [
        mix(c[5], c[1], 35),
        c[5],
        mix(c[5], c[7], 45),
        mix(c[6], c[7], 40),
        c[7],
        mix(c[5], c[6], 25),
        c[6],
        mix(c[5], c[6], 50),
        mix(c[6], c[1], 30),
    ];
    let mut navigation = [rgb(0); 9];
    let mut nav_selected = [rgb(0); 9];
    let mut sections = [SectionColors {
        background: rgb(c[0]),
        border: rgb(c[3]),
        title: rgb(c[5]),
    }; 9];
    let mut i = 0;
    while i < 9 {
        navigation[i] = rgb(hues[i]);
        nav_selected[i] = rgb(mix(c[0], hues[i], 13));
        sections[i] = SectionColors {
            background: rgb(mix(c[0], hues[i], 2)),
            border: rgb(mix(c[3], hues[i], 30)),
            title: rgb(hues[i]),
        };
        i += 1;
    }
    Palette {
        id,
        name,
        background: rgb(c[0]),
        foreground: rgb(c[1]),
        muted: rgb(c[2]),
        border: rgb(c[3]),
        surface: rgb(c[4]),
        accent: rgb(c[5]),
        secondary: rgb(c[6]),
        warning: rgb(c[7]),
        navigation,
        nav_selected,
        nav_background: rgb(c[0]),
        sections,
        status: [
            rgb(c[4]),
            rgb(c[5]),
            rgb(c[1]),
            rgb(c[5]),
            rgb(c[6]),
            rgb(c[1]),
            rgb(c[7]),
            rgb(c[6]),
            rgb(c[2]),
            rgb(c[5]),
            rgb(c[3]),
            rgb(c[6]),
            rgb(c[7]),
        ],
        progress: [rgb(c[3]), rgb(c[5]), rgb(c[6])],
        footer: [rgb(c[0]), rgb(c[5]), rgb(c[6]), rgb(c[5]), rgb(c[2])],
        header: [rgb(c[0]), rgb(c[2]), rgb(c[5]), rgb(c[3])],
        nav_border: rgb(c[3]),
        cover: SectionColors {
            background: rgb(c[0]),
            border: rgb(c[3]),
            title: rgb(c[6]),
        },
        lyric_panel: SectionColors {
            background: rgb(c[0]),
            border: rgb(c[3]),
            title: rgb(c[5]),
        },
        lyrics: [
            rgb(c[5]),
            rgb(c[2]),
            rgb(c[1]),
            rgb(c[6]),
            rgb(c[2]),
            rgb(mix(c[2], c[5], 25)),
            rgb(c[7]),
        ],
        notifications: [
            rgb(c[4]),
            rgb(c[1]),
            rgb(c[6]),
            rgb(c[5]),
            rgb(c[7]),
            rgb(0xff6b81),
        ],
        visualizer: [rgb(c[5]), rgb(c[6]), rgb(c[3]), rgb(c[0]), rgb(c[6])],
    }
}
// Sources and role mappings are documented in README.md. Image/QR colors are independent.
pub const PRESETS: [Palette; 23] = [
    palette(
        "jade",
        "Kugou Jade · 翡翠",
        [
            0x0e131b, 0xd7e0eb, 0x8b9cb5, 0x2d4050, 0x193036, 0x5eead4, 0xc4a7e7, 0xe1c179,
        ],
    ),
    palette(
        "catppuccin-mocha",
        "Catppuccin Mocha",
        [
            0x1e1e2e, 0xcdd6f4, 0xa6adc8, 0x45475a, 0x313244, 0x94e2d5, 0xcba6f7, 0xf9e2af,
        ],
    ),
    palette(
        "catppuccin-macchiato",
        "Catppuccin Macchiato",
        [
            0x24273a, 0xcad3f5, 0xa5adcb, 0x494d64, 0x363a4f, 0x8bd5ca, 0xc6a0f6, 0xeed49f,
        ],
    ),
    palette(
        "catppuccin-frappe",
        "Catppuccin Frappé",
        [
            0x303446, 0xc6d0f5, 0xa5adce, 0x51576d, 0x414559, 0x81c8be, 0xca9ee6, 0xe5c890,
        ],
    ),
    palette(
        "catppuccin-latte",
        "Catppuccin Latte · 浅色",
        [
            0xeff1f5, 0x4c4f69, 0x6c6f85, 0xbcc0cc, 0xccd0da, 0x1e66f5, 0x8839ef, 0x966700,
        ],
    ),
    palette(
        "rose-pine",
        "Rosé Pine",
        [
            0x191724, 0xe0def4, 0x908caa, 0x403d52, 0x26233a, 0x9ccfd8, 0xc4a7e7, 0xf6c177,
        ],
    ),
    palette(
        "rose-pine-moon",
        "Rosé Pine Moon",
        [
            0x232136, 0xe0def4, 0x908caa, 0x44415a, 0x393552, 0x9ccfd8, 0xea9a97, 0xf6c177,
        ],
    ),
    palette(
        "rose-pine-dawn",
        "Rosé Pine Dawn · 浅色",
        [
            0xfaf4ed, 0x464261, 0x797593, 0xcecacd, 0xf2e9e1, 0x286983, 0x907aa9, 0x946515,
        ],
    ),
    palette(
        "tokyo-night",
        "Tokyo Night",
        [
            0x1a1b26, 0xc0caf5, 0xa9b1d6, 0x3b4261, 0x292e42, 0x7aa2f7, 0xbb9af7, 0xe0af68,
        ],
    ),
    palette(
        "tokyo-storm",
        "Tokyo Night Storm",
        [
            0x24283b, 0xc0caf5, 0xa9b1d6, 0x3b4261, 0x292e42, 0x7dcfff, 0xbb9af7, 0xe0af68,
        ],
    ),
    palette(
        "tokyo-moon",
        "Tokyo Night Moon",
        [
            0x222436, 0xc8d3f5, 0x828bb8, 0x444a73, 0x2f334d, 0x82aaff, 0xc099ff, 0xffc777,
        ],
    ),
    palette(
        "nord",
        "Nord · 极地",
        [
            0x2e3440, 0xeceff4, 0xd8dee9, 0x4c566a, 0x3b4252, 0x88c0d0, 0xb48ead, 0xebcb8b,
        ],
    ),
    palette(
        "dracula",
        "Dracula",
        [
            0x282a36, 0xf8f8f2, 0xbdc4dc, 0x6272a4, 0x44475a, 0x8be9fd, 0xbd93f9, 0xf1fa8c,
        ],
    ),
    palette(
        "gruvbox-dark",
        "Gruvbox Dark",
        [
            0x282828, 0xebdbb2, 0xbdae93, 0x665c54, 0x3c3836, 0x8ec07c, 0xd3869b, 0xfabd2f,
        ],
    ),
    palette(
        "gruvbox-light",
        "Gruvbox Light · 浅色",
        [
            0xfbf1c7, 0x3c3836, 0x665c54, 0xbdae93, 0xebdbb2, 0x076678, 0x8f3f71, 0x8f5900,
        ],
    ),
    palette(
        "ocean-abyss",
        "Ocean Abyss · 深海",
        [
            0x071a29, 0xd5eef9, 0x92b6c9, 0x294858, 0x122c3e, 0x38c9e8, 0x8dafe8, 0xffcd7a,
        ],
    ),
    palette(
        "sakura-night",
        "Sakura Night · 夜樱",
        [
            0x211823, 0xf5e3ef, 0xb9a0b4, 0x4c354a, 0x352337, 0xf3a6c8, 0xc4b2ff, 0xf4ca8d,
        ],
    ),
    palette(
        "amber-paper",
        "Amber Paper · 暖纸",
        [
            0xf6f0df, 0x40392d, 0x75654e, 0xc5b999, 0xebe1c8, 0x805421, 0x476b5a, 0x80510d,
        ],
    ),
    palette(
        "mint-daylight",
        "Mint Daylight · 薄荷",
        [
            0xf0f7f2, 0x294438, 0x587166, 0xb1c9bc, 0xdfede3, 0x17694f, 0x405d9c, 0x865b19,
        ],
    ),
    palette(
        "graphite",
        "Graphite · 石墨",
        [
            0x17191c, 0xe6e9ed, 0x9ca6b3, 0x39404a, 0x252a31, 0x8fc8e8, 0xc2b8de, 0xe6be81,
        ],
    ),
    palette(
        "solar-violet",
        "Solar Violet · 紫霞",
        [
            0x1a1430, 0xeee7ff, 0xb4a1cf, 0x473363, 0x2b2147, 0xbda1ff, 0x74dfd8, 0xf6c17d,
        ],
    ),
    palette(
        "forest-moss",
        "Forest Moss · 苔林",
        [
            0x15201b, 0xe3ecda, 0xa6b6a0, 0x3c5140, 0x24382b, 0xa6cf89, 0x80beb0, 0xe4bd76,
        ],
    ),
    palette(
        "monochrome",
        "Monochrome · 素墨",
        [
            0x151515, 0xeaeaea, 0xaaaaaa, 0x484848, 0x292929, 0xdadada, 0xb8c9d9, 0xdfc190,
        ],
    ),
];
static CATALOG: std::sync::OnceLock<Vec<Palette>> = std::sync::OnceLock::new();
pub fn palettes() -> &'static [Palette] {
    CATALOG.get().map(Vec::as_slice).unwrap_or(&PRESETS)
}
pub fn selected() -> usize {
    ACTIVE.load(Ordering::Relaxed)
}
static ACTIVE: AtomicUsize = AtomicUsize::new(0);
pub fn set(index: usize) {
    ACTIVE.store(index.min(palettes().len() - 1), Ordering::Relaxed);
}
pub fn current() -> Palette {
    palettes()[selected()]
}
pub fn serialize(p: Palette) -> serde_json::Value {
    let hex = |c| {
        let Color::Rgb(r, g, b) = c else {
            unreachable!()
        };
        format!("#{r:02x}{g:02x}{b:02x}")
    };
    let mut value = serde_json::json!({"schema_version":2,"id":p.id,"name":p.name,"colors":{
        "background":hex(p.background),"foreground":hex(p.foreground),"muted":hex(p.muted),"border":hex(p.border),"surface":hex(p.surface),"accent":hex(p.accent),"secondary":hex(p.secondary),"warning":hex(p.warning)
    },"navigation":{"background":hex(p.nav_background),"border":hex(p.nav_border)},"status":{},"panels":{}});
    for (i, id) in SECTIONS.iter().enumerate() {
        value["navigation"][*id] = serde_json::json!({"color":hex(p.navigation[i]),"selected_background":hex(p.nav_selected[i])});
        value["panels"][*id] = serde_json::json!({"background":hex(p.sections[i].background),"border":hex(p.sections[i].border),"title":hex(p.sections[i].title)});
    }
    for (i, id) in STATUS_KEYS.iter().enumerate() {
        value["status"][*id] = hex(p.status[i]).into();
    }
    value["footer"] = serde_json::json!({"background":hex(p.footer[0]),"lyrics":hex(p.footer[1]),"translation":hex(p.footer[2]),"elapsed":hex(p.footer[3]),"duration":hex(p.footer[4])});
    value["progress"] = serde_json::json!({"track":hex(p.progress[0]),"played":hex(p.progress[1]),"thumb":hex(p.progress[2])});
    value["header"] = serde_json::json!({"background":hex(p.header[0]),"text":hex(p.header[1]),"accent":hex(p.header[2]),"border":hex(p.header[3])});
    value["lyrics"] = serde_json::json!({"completed":hex(p.lyrics[0]),"upcoming":hex(p.lyrics[1]),"pending":hex(p.lyrics[2]),"translation":hex(p.lyrics[3]),"inactive_translation":hex(p.lyrics[4]),"past":hex(p.lyrics[5]),"word":hex(p.lyrics[6])});
    for (name, colors) in [("cover", p.cover), ("lyric_panel", p.lyric_panel)] {
        value[name] = serde_json::json!({"background":hex(colors.background),"border":hex(colors.border),"title":hex(colors.title)});
    }
    value["notifications"] = serde_json::json!({"background":hex(p.notifications[0]),"text":hex(p.notifications[1]),"info":hex(p.notifications[2]),"success":hex(p.notifications[3]),"warning":hex(p.notifications[4]),"error":hex(p.notifications[5])});
    value["visualizer"] = serde_json::json!({"low":hex(p.visualizer[0]),"high":hex(p.visualizer[1]),"border":hex(p.visualizer[2]),"background":hex(p.visualizer[3]),"title":hex(p.visualizer[4])});
    value
}
pub fn parse(text: &str) -> std::io::Result<Palette> {
    use crate::settings::invalid;
    let v: serde_json::Value = serde_json::from_str(text).map_err(invalid)?;
    let id = v["id"]
        .as_str()
        .filter(|s| {
            !s.is_empty()
                && s.len() <= 80
                && s.chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        })
        .ok_or_else(|| invalid("主题 id 必须是字母、数字、- 或 _"))?;
    let name = v["name"]
        .as_str()
        .filter(|s| {
            !s.trim().is_empty()
                && s.len() <= 160
                && !s.chars().any(|c| c.is_control() || c == '/' || c == '\\')
        })
        .ok_or_else(|| invalid("无效的主题名称"))?;
    let color = |key| -> std::io::Result<Color> {
        let h = v["colors"][key]
            .as_str()
            .ok_or_else(|| invalid(format!("缺少颜色 {key}")))?;
        if h.len() != 7 || !h.starts_with('#') || !h[1..].bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(invalid(format!("{key} 必须是 #RRGGBB")));
        }
        Ok(rgb(u32::from_str_radix(&h[1..], 16).map_err(invalid)?))
    };
    let colors = [
        color("background")?,
        color("foreground")?,
        color("muted")?,
        color("border")?,
        color("surface")?,
        color("accent")?,
        color("secondary")?,
        color("warning")?,
    ];
    // Names live for the bounded catalogue's lifetime, like the built-in static names.
    let hex = |c| {
        let Color::Rgb(r, g, b) = c else {
            unreachable!()
        };
        ((r as u32) << 16) | ((g as u32) << 8) | b as u32
    };
    let mut p = palette(
        Box::leak(id.to_string().into_boxed_str()),
        Box::leak(name.to_string().into_boxed_str()),
        colors.map(hex),
    );
    let read = |group: &serde_json::Value, key: &str, fallback: Color| -> std::io::Result<Color> {
        let Some(value) = group.get(key) else {
            return Ok(fallback);
        };
        let h = value
            .as_str()
            .filter(|h| {
                h.len() == 7 && h.starts_with('#') && h[1..].bytes().all(|b| b.is_ascii_hexdigit())
            })
            .ok_or_else(|| invalid(format!("{key} 必须是 #RRGGBB")))?;
        Ok(rgb(u32::from_str_radix(&h[1..], 16).map_err(invalid)?))
    };
    for group in [
        "navigation",
        "status",
        "progress",
        "footer",
        "panels",
        "header",
        "lyrics",
        "visualizer",
        "notifications",
        "cover",
        "lyric_panel",
    ] {
        if v.get(group).is_some_and(|g| !g.is_object()) {
            return Err(invalid(format!("{group} 必须是对象")));
        }
    }
    for (i, id) in ["background", "text", "info", "success", "warning", "error"]
        .iter()
        .enumerate()
    {
        p.notifications[i] = read(&v["notifications"], id, p.notifications[i])?;
    }
    for (i, id) in ["background", "lyrics", "translation", "elapsed", "duration"]
        .iter()
        .enumerate()
    {
        p.footer[i] = read(&v["footer"], id, p.footer[i])?;
    }
    p.nav_background = read(&v["navigation"], "background", p.nav_background)?;
    p.nav_border = read(&v["navigation"], "border", p.nav_border)?;
    for (i, id) in SECTIONS.iter().enumerate() {
        for group in ["navigation", "panels"] {
            if v[group].get(*id).is_some_and(|g| !g.is_object()) {
                return Err(invalid(format!("{group}.{id} 必须是对象")));
            }
        }
        p.navigation[i] = read(&v["navigation"][*id], "color", p.navigation[i])?;
        p.nav_selected[i] = read(
            &v["navigation"][*id],
            "selected_background",
            p.nav_selected[i],
        )?;
        p.sections[i] = SectionColors {
            background: read(&v["panels"][*id], "background", p.sections[i].background)?,
            border: read(&v["panels"][*id], "border", p.sections[i].border)?,
            title: read(&v["panels"][*id], "title", p.sections[i].title)?,
        };
    }
    for (i, id) in STATUS_KEYS.iter().enumerate() {
        p.status[i] = read(&v["status"], id, p.status[i])?;
    }
    for (i, id) in ["track", "played", "thumb"].iter().enumerate() {
        p.progress[i] = read(&v["progress"], id, p.progress[i])?;
    }
    for (i, id) in ["background", "text", "accent", "border"]
        .iter()
        .enumerate()
    {
        p.header[i] = read(&v["header"], id, p.header[i])?;
    }
    p.lyrics[0] = read(&v["lyrics"], "active", p.lyrics[0])?;
    p.lyrics[1] = read(&v["lyrics"], "inactive", p.lyrics[1])?;
    for (i, id) in [
        "completed",
        "upcoming",
        "pending",
        "translation",
        "inactive_translation",
        "past",
        "word",
    ]
    .iter()
    .enumerate()
    {
        p.lyrics[i] = read(&v["lyrics"], id, p.lyrics[i])?;
    }
    for (i, id) in ["low", "high", "border", "background", "title"]
        .iter()
        .enumerate()
    {
        p.visualizer[i] = read(&v["visualizer"], id, p.visualizer[i])?;
    }
    for (name, colors) in [("cover", &mut p.cover), ("lyric_panel", &mut p.lyric_panel)] {
        *colors = SectionColors {
            background: read(&v[name], "background", colors.background)?,
            border: read(&v[name], "border", colors.border)?,
            title: read(&v[name], "title", colors.title)?,
        };
    }
    Ok(p)
}
fn upgrade_file(path: &std::path::Path, p: Palette) -> std::io::Result<()> {
    let original: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path)?).map_err(crate::settings::invalid)?;
    fn fill(target: &mut serde_json::Value, defaults: &serde_json::Value) {
        if let (Some(target), Some(defaults)) = (target.as_object_mut(), defaults.as_object()) {
            for (key, value) in defaults {
                if let Some(existing) = target.get_mut(key) {
                    fill(existing, value);
                } else {
                    target.insert(key.clone(), value.clone());
                }
            }
        }
    }
    let mut next = original.clone();
    fill(&mut next, &serialize(p));
    next["schema_version"] = 2.into();
    if original != next {
        crate::settings::atomic_write(path, &next)?;
    }
    Ok(())
}
pub fn initialize() -> std::io::Result<()> {
    let dir = crate::settings::directory();
    let themes = dir.join("themes");
    std::fs::create_dir_all(&themes)?;
    for p in PRESETS {
        let path = themes.join(format!("{}.json", p.name));
        if !path.exists() {
            crate::settings::atomic_write(&path, &serialize(p))?;
        }
    }
    let mut paths = std::fs::read_dir(&themes)?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|s| s == "json"))
        .collect::<Vec<_>>();
    paths.sort();
    let mut list = PRESETS.to_vec();
    for path in paths.into_iter().take(128) {
        match std::fs::read_to_string(&path).and_then(|text| parse(&text)) {
            Ok(p) => {
                upgrade_file(&path, p)?;
                if let Some(i) = list.iter().position(|a| a.id == p.id) {
                    list[i] = p;
                } else {
                    list.push(p);
                }
            }
            Err(e) => eprintln!("主题 {} 未加载：{e}", path.display()),
        }
    }
    let active_path = dir.join("theme.json");
    let active = if active_path.exists() {
        let p = parse(&std::fs::read_to_string(&active_path)?)?;
        upgrade_file(&active_path, p)?;
        if let Some(i) = list.iter().position(|a| a.id == p.id) {
            list[i] = p;
            i
        } else {
            list.push(p);
            list.len() - 1
        }
    } else {
        crate::settings::atomic_write(&active_path, &serialize(list[0]))?;
        0
    };
    CATALOG
        .set(list)
        .map_err(|_| crate::settings::invalid("主题已初始化"))?;
    set(active);
    Ok(())
}
pub fn save(index: usize) -> std::io::Result<()> {
    crate::settings::atomic_write(
        &crate::settings::directory().join("theme.json"),
        &serialize(palettes()[index]),
    )
}
pub fn import(path: &std::path::Path) -> std::io::Result<()> {
    let p = parse(&std::fs::read_to_string(path)?)?;
    let dir = crate::settings::directory();
    crate::settings::atomic_write(
        &dir.join("themes").join(format!("{}.json", p.name)),
        &serialize(p),
    )?;
    crate::settings::atomic_write(&dir.join("theme.json"), &serialize(p))
}
/// Derive navigation hues from the imported palette, so custom themes need no
/// extra hardcoded color fields. The same roles apply to sidebar and top tabs.
pub fn section_index(id: &str) -> usize {
    SECTIONS
        .iter()
        .position(|key| *key == if id == "tracks" { "search" } else { id })
        .unwrap_or(0)
}
pub fn navigation_color(p: Palette, section: &str) -> Color {
    p.navigation[section_index(section)]
}
static SECTION: AtomicUsize = AtomicUsize::new(0);
pub fn set_section(id: &str) {
    SECTION.store(section_index(id), Ordering::Relaxed);
}
pub fn section() -> SectionColors {
    current().sections[SECTION.load(Ordering::Relaxed)]
}
pub fn panel<'a>() -> Block<'a> {
    block(section())
}
pub fn block<'a>(s: SectionColors) -> Block<'a> {
    Block::bordered()
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(s.border))
        .title_style(Style::default().fg(s.title))
}
pub fn blend(a: Color, b: Color, t: f64) -> Color {
    if let (Color::Rgb(ar, ag, ab), Color::Rgb(br, bg, bb)) = (a, b) {
        let t = t.clamp(0.0, 1.0);
        let mix = |x: u8, y: u8| (x as f64 + (y as f64 - x as f64) * t).round() as u8;
        Color::Rgb(mix(ar, br), mix(ag, bg), mix(ab, bb))
    } else {
        a
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn theme_roundtrip_rejects_bad_colors_and_path_names() {
        for p in PRESETS {
            assert_eq!(parse(&serialize(p).to_string()).unwrap(), p);
        }
        let mut v = serialize(PRESETS[0]);
        v["colors"]["accent"] = serde_json::json!("#xyzxyz");
        assert!(parse(&v.to_string()).is_err());
        v = serialize(PRESETS[0]);
        v["name"] = serde_json::json!("../unsafe");
        assert!(parse(&v.to_string()).is_err());
        v = serialize(PRESETS[0]);
        v["colors"].as_object_mut().unwrap().remove("border");
        assert!(parse(&v.to_string()).is_err());
    }
    #[test]
    fn named_presets_have_readable_text() {
        let luminance = |c: Color| {
            let Color::Rgb(r, g, b) = c else {
                panic!("expected RGB")
            };
            let v = |n: u8| {
                let x = n as f64 / 255.0;
                if x <= 0.04045 {
                    x / 12.92
                } else {
                    ((x + 0.055) / 1.055).powf(2.4)
                }
            };
            0.2126 * v(r) + 0.7152 * v(g) + 0.0722 * v(b)
        };
        let mut ids = std::collections::HashSet::new();
        for p in PRESETS {
            assert!(ids.insert(p.id));
            let a = luminance(p.foreground);
            let b = luminance(p.background);
            assert!((a.max(b) + 0.05) / (a.min(b) + 0.05) >= 4.5, "{}", p.name);
        }
        assert!(PRESETS.len() >= 15);
    }
}
