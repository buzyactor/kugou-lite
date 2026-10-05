use crate::{controls::Regions, settings::Settings, theme};
use ratatui::{
    Frame,
    layout::Rect,
    style::{Modifier, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, Clear, Paragraph, Wrap},
};
use serde_json::Value;
use std::{
    collections::VecDeque,
    process::{Command, Stdio},
    sync::mpsc::{self, Receiver, SyncSender},
    thread,
    time::{Duration, Instant},
};
#[derive(Clone, Copy, Debug, PartialEq)]
enum Level {
    Info,
    Success,
    Warning,
    Error,
}
impl Level {
    fn name(self) -> &'static str {
        match self {
            Self::Info => "信息",
            Self::Success => "成功",
            Self::Warning => "警告",
            Self::Error => "错误",
        }
    }
    fn color(self) -> usize {
        match self {
            Self::Info => 2,
            Self::Success => 3,
            Self::Warning => 4,
            Self::Error => 5,
        }
    }
}
#[derive(Clone)]
struct Notice {
    id: u64,
    title: String,
    body: String,
    level: Level,
    created: Instant,
    track: bool,
}
struct Delivery {
    notice: Notice,
    timeout: u64,
}
pub struct Center {
    items: VecDeque<Notice>,
    recent: VecDeque<Notice>,
    serial: u64,
    sender: SyncSender<Delivery>,
    results: Receiver<String>,
    backend_warning: bool,
}
impl Center {
    pub fn new() -> Self {
        let (sender, rx) = mpsc::sync_channel::<Delivery>(8);
        let (feedback, results) = mpsc::channel();
        thread::spawn(move || {
            let mut replace_id = String::new();
            while let Ok(job) = rx.recv() {
                if job.notice.created.elapsed() > Duration::from_secs(job.timeout) {
                    continue;
                }
                match desktop(&job, &replace_id) {
                    Ok(id) => {
                        if job.notice.track {
                            replace_id = id;
                        }
                    }
                    Err(error) => {
                        let _ = feedback.send(error);
                    }
                }
            }
        });
        Self {
            items: VecDeque::new(),
            recent: VecDeque::new(),
            serial: 0,
            sender,
            results,
            backend_warning: false,
        }
    }
    fn push(
        &mut self,
        title: &str,
        body: &str,
        level: Level,
        track: bool,
        s: &Settings,
        desktop: bool,
    ) {
        self.recent
            .retain(|n| n.created.elapsed() < Duration::from_secs(10));
        if self
            .recent
            .iter()
            .any(|n| n.title == title && n.body == body)
        {
            return;
        }
        self.serial += 1;
        let n = Notice {
            id: self.serial,
            title: clean(title),
            body: clean(body),
            level,
            track,
            created: Instant::now(),
        };
        self.recent.push_back(n.clone());
        while self.recent.len() > 32 {
            self.recent.pop_front();
        }
        if s.in_app_notifications {
            if track {
                self.items.retain(|n| !n.track);
            }
            self.items.push_back(n.clone());
            while self.items.len() > 3 {
                self.items.pop_front();
            }
        }
        if desktop && s.desktop_notifications {
            let _ = self.sender.try_send(Delivery {
                notice: n,
                timeout: s.notification_timeout,
            });
        }
    }
    pub fn event(&mut self, v: &Value, s: &Settings) {
        let body = v["message"].as_str().unwrap_or("");
        match v["kind"].as_str().unwrap_or("") {
            "media"
                if v["fresh"] == true
                    && s.track_notifications
                    && v["song"].as_str().is_some_and(|s| !s.is_empty()) =>
            {
                self.push(
                    "正在播放",
                    &format!(
                        "{} · {}",
                        v["song"].as_str().unwrap_or(""),
                        v["artist"].as_str().unwrap_or("")
                    ),
                    Level::Info,
                    true,
                    s,
                    true,
                );
            }
            "error" => self.push("操作失败", body, Level::Error, false, s, true),
            "auth_required" => self.push("登录需要恢复", body, Level::Warning, false, s, true),
            "status"
                if ["成功", "已收藏", "已删除", "已切换"]
                    .iter()
                    .any(|w| body.contains(w)) =>
            {
                self.push("操作完成", body, Level::Success, false, s, true)
            }
            "status" if body.starts_with("收藏请求已接受") => {
                self.push("收藏请求已提交", body, Level::Info, false, s, true)
            }
            "status" if body.contains("已过期") => {
                self.push("二维码已过期", body, Level::Warning, false, s, false)
            }
            "result" => {
                let r = &v["result"];
                let (body, level) = match r["verdict"].as_str().unwrap_or("") {
                    "not_tested" => ("会员权益已读取，尚未执行领取", Level::Info),
                    "already_claimed" => ("今天已领取", Level::Info),
                    "daily_limit" => ("今日领取次数已用尽", Level::Warning),
                    "changed_needs_app_confirmation" => {
                        ("权益发生变化，请在官方 APP 核对到期时间", Level::Success)
                    }
                    "accepted_but_unverified" => ("接口接受，尚未观察到权益变化", Level::Warning),
                    _ => ("领取被拒绝，请检查活动资格", Level::Error),
                };
                self.push("概念版 VIP", body, level, false, s, true);
            }
            _ => {}
        }
    }
    pub fn poll(&mut self, s: &Settings) {
        self.items
            .retain(|n| n.created.elapsed() < Duration::from_secs(s.notification_timeout));
        if !s.in_app_notifications {
            self.items.clear();
        }
        while let Ok(error) = self.results.try_recv() {
            if !self.backend_warning {
                self.backend_warning = true;
                self.push("桌面通知不可用", &error, Level::Warning, false, s, false);
            }
        }
    }
    pub fn dismiss(&mut self, id: u64) {
        self.items.retain(|n| n.id != id);
    }
    pub fn render(
        &self,
        f: &mut Frame,
        area: Rect,
        s: &Settings,
        regions: &mut Regions,
    ) -> Vec<Rect> {
        let mut out = Vec::new();
        if !s.in_app_notifications || area.width < 24 || area.height < 5 {
            return out;
        }
        let width = area.width.min(48);
        let mut y = area.y;
        let p = theme::current();
        for n in self.items.iter().rev() {
            if y + 5 > area.bottom() {
                break;
            }
            let rect = Rect::new(area.right() - width, y, width, 5);
            let color = p.notifications[n.level.color()];
            let block = Block::default()
                .borders(Borders::ALL)
                .border_type(BorderType::Rounded)
                .title(format!(" {} · {} ", n.level.name(), n.title))
                .title_bottom(" 点击关闭 ")
                .border_style(Style::default().fg(color))
                .style(Style::default().bg(p.notifications[0]));
            f.render_widget(Clear, rect);
            f.render_widget(
                Paragraph::new(Line::from(Span::styled(
                    &n.body,
                    Style::default()
                        .fg(p.notifications[1])
                        .add_modifier(Modifier::BOLD),
                )))
                .wrap(Wrap { trim: true })
                .block(block),
                rect,
            );
            regions.add(rect, format!("notification-dismiss:{}", n.id));
            out.push(rect);
            y += 5;
        }
        out
    }
}
fn clean(text: &str) -> String {
    text.chars().filter(|c| !c.is_control()).take(400).collect()
}
fn markup(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}
fn desktop(job: &Delivery, replace_id: &str) -> Result<String, String> {
    let mut cmd = Command::new("notify-send");
    cmd.args([
        "--app-name=Kugou Lite",
        "--icon=audio-x-generic",
        "--print-id",
        "--expire-time",
        &(job.timeout * 1000).to_string(),
        "--urgency",
        if job.notice.level == Level::Error {
            "critical"
        } else {
            "normal"
        },
    ]);
    if job.notice.track && !replace_id.is_empty() {
        cmd.args(["--replace-id", replace_id]);
    }
    cmd.arg("--")
        .arg(&job.notice.title)
        .arg(markup(&job.notice.body))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if std::env::var_os("DBUS_SESSION_BUS_ADDRESS").is_none() {
        if let Some(runtime) = std::env::var_os("XDG_RUNTIME_DIR") {
            let bus = std::path::Path::new(&runtime).join("bus");
            if bus.exists() {
                cmd.env(
                    "DBUS_SESSION_BUS_ADDRESS",
                    format!("unix:path={}", bus.display()),
                );
            }
        }
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("notify-send: {e}；请检查 libnotify 和桌面通知服务"))?;
    let start = Instant::now();
    loop {
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            break;
        }
        if start.elapsed() > Duration::from_secs(3) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("通知服务 3 秒内未响应".into());
        }
        thread::sleep(Duration::from_millis(20));
    }
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(format!(
            "notify-send: {}",
            clean(&String::from_utf8_lossy(&output.stderr))
        ))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn deduplicate_replace_expire_and_dismiss() {
        let s = Settings {
            desktop_notifications: false,
            ..Settings::default()
        };
        let mut c = Center::new();
        c.event(&serde_json::json!({"kind":"error","message":"失败"}), &s);
        c.event(&serde_json::json!({"kind":"error","message":"失败"}), &s);
        assert_eq!(c.items.len(), 1);
        for song in ["A", "B"] {
            c.event(
                &serde_json::json!({"kind":"media","fresh":true,"song":song,"artist":"测试"}),
                &s,
            );
        }
        assert_eq!(c.items.len(), 2);
        let id = c.items.back().unwrap().id;
        c.dismiss(id);
        assert_eq!(c.items.len(), 1);
        c.items[0].created = Instant::now() - Duration::from_secs(31);
        c.poll(&s);
        assert!(c.items.is_empty());
    }
    #[test]
    fn dismiss_hit_and_no_progress_spam() {
        let s = Settings {
            desktop_notifications: false,
            ..Settings::default()
        };
        let mut c = Center::new();
        c.event(&serde_json::json!({"kind":"time","seconds":2}), &s);
        assert!(c.items.is_empty());
        c.event(&serde_json::json!({"kind":"error","message":"失败"}), &s);
        let mut terminal =
            ratatui::Terminal::new(ratatui::backend::TestBackend::new(80, 24)).unwrap();
        let mut regions = Regions::default();
        terminal
            .draw(|f| {
                c.render(f, f.area(), &s, &mut regions);
            })
            .unwrap();
        assert_eq!(regions.hit(79, 1), Some("notification-dismiss:1".into()));
    }
    #[test]
    fn safe_text() {
        assert_eq!(markup("<song>&"), "&lt;song&gt;&amp;");
        assert_eq!(clean("a\x1bb\nb"), "abb");
    }
}
