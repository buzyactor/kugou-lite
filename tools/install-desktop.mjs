import {mkdir,copyFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {resolve,join} from 'node:path';

const args=process.argv.slice(2);
if(args.length>1||args.some(arg=>!arg.startsWith('--data-home=')))throw Error('用法：node tools/install-desktop.mjs [--data-home=/path]');
const data=resolve(args[0]?.slice(12)||process.env.XDG_DATA_HOME||join(homedir(),'.local/share'));
const root=fileURLToPath(new URL('../',import.meta.url));
const icon=join(data,'kugou-lite','icon.png'),entry=join(data,'applications','kugou-lite.desktop');
const quoted=value=>'"'+value.replaceAll('%','%%').replace(/[\\"`$]/g,'\\$&')+'"';
await mkdir(join(data,'kugou-lite'),{recursive:true});
await mkdir(join(data,'applications'),{recursive:true});
await copyFile(join(root,'复古终端像素狼头音乐图标.png'),icon);
await writeFile(entry,`[Desktop Entry]
Type=Application
Name=Kugou Lite
Comment=酷狗终端音乐播放器
Exec=kitty --class=kugou-lite --title="Kugou Lite" ${quoted(join(root,'tui/target/debug/kugou-lite'))}
Icon=${icon}
Terminal=false
Categories=AudioVideo;Audio;Player;
StartupWMClass=kugou-lite
StartupNotify=false
`,{mode:0o644});
console.log('已安装应用入口：'+entry+'\n应用图标：'+icon);
