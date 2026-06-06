const express = require('express');
const compression = require('compression'); // වේගවත් ලෝඩ් වීමට
const http = require('http');
const { WebSocketServer } = require('ws');
const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');
const os = require('os');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Gzip Compression එක සක්‍රීය කිරීම (Website එක වේගයෙන් Load වීමට)
app.use(compression({ filter: (req, res) => { if (req.headers['x-no-compression']) return false; return compression.filter(req, res); } }));
app.use(express.json());

const PORT = 8080;
const MAX_OUTPUT = 50000;
const SESSION_TIMEOUT = 86400;
const USERS_FILE = 'users.txt';
const SESSIONS = {};

// --- Helper Functions ---
function hashPassword(pw) { return crypto.createHash('sha256').update(pw).digest('hex'); }
function verifyUser(username, password) {
    if (!fs.existsSync(USERS_FILE)) return false;
    return fs.readFileSync(USERS_FILE, 'utf-8').split('\n').some(line => { if(!line.trim()) return false; const [u, p] = line.split(':'); return u === username && p === password; });
}
function userExists(username) {
    if (!fs.existsSync(USERS_FILE)) return false;
    return fs.readFileSync(USERS_FILE, 'utf-8').split('\n').some(line => { if(!line.trim()) return false; const [u] = line.split(':'); return u === username; });
}
function createUser(username, password) { fs.appendFileSync(USERS_FILE, `${username}:${password}\n`); }

function getNetworkIp() {
    try {
        const nets = os.networkInterfaces();
        let mobileIp = null, wifiIp = null, otherIp = null;
        for (const name of Object.keys(nets)) {
            for (const net of nets[name]) {
                if (net.family === 'IPv4' && !net.internal) {
                    if (name.startsWith('rmnet') || name.startsWith('ccmni')) mobileIp = net.address;
                    else if (name === 'wlan0') wifiIp = net.address;
                    else if (!otherIp) otherIp = net.address;
                }
            }
        }
        return mobileIp || wifiIp || otherIp || '127.0.0.1';
    } catch(e) {}
    return '127.0.0.1';
}

function authMiddleware(req, res, next) {
    const token = req.headers['authorization'];
    if (!token || !SESSIONS[token] || (Date.now() - SESSIONS[token] > SESSION_TIMEOUT * 1000)) return res.status(401).json({ error: 'Unauthorized' });
    next();
}

// --- API Routes ---
app.get('/api/check_setup', (req, res) => res.json({ exists: fs.existsSync(USERS_FILE) }));
app.post('/api/create_account', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ error: 'Empty fields' });
    if (userExists(username)) return res.json({ error: 'User exists' });
    createUser(username, password);
    const token = crypto.randomBytes(32).toString('hex'); SESSIONS[token] = Date.now();
    res.json({ status: 'success', token });
});
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (verifyUser(username, password)) {
        const token = crypto.randomBytes(32).toString('hex'); SESSIONS[token] = Date.now();
        res.json({ status: 'success', token });
    } else { res.status(401).json({ error: 'Wrong credentials' }); }
});

app.use(authMiddleware); // Auth required for APIs below

app.get('/api/info', (req, res) => res.json({ status: 'success', system: execSync('uname -a').toString().trim() }));
app.get('/api/download', (req, res) => {
    const filePath = req.query.path;
    if (fs.existsSync(filePath)) res.download(filePath);
    else res.status(404).json({ error: 'Not found' });
});
app.post('/api/execute', (req, res) => { handleExecute(req, res); });
app.post('/api/list', (req, res) => {
    const dirPath = req.body.path || '/sdcard';
    try {
        const items = fs.readdirSync(dirPath).map(name => {
            const full = path.join(dirPath, name); const isDir = fs.statSync(full).isDirectory();
            return { name, path: full, dir: isDir, size: isDir ? 0 : fs.statSync(full).size };
        }).sort((a,b) => (a.dir === b.dir) ? a.name.localeCompare(b.name) : (a.dir ? -1 : 1));
        res.json({ status: 'success', files: items });
    } catch(e) { res.json({ error: e.message }); }
});
app.post('/api/read', (req, res) => { try { res.json({ status: 'success', content: fs.readFileSync(req.body.path, 'utf-8') }); } catch(e) { res.json({ error: e.message }); } });
app.post('/api/write', (req, res) => { try { fs.mkdirSync(path.dirname(req.body.path), {recursive:true}); fs.writeFileSync(req.body.path, req.body.content); res.json({ status: 'success' }); } catch(e) { res.json({ error: e.message }); } });
app.post('/api/upload', (req, res) => { try { fs.mkdirSync(path.dirname(req.body.path), {recursive:true}); fs.writeFileSync(req.body.path, Buffer.from(req.body.content, 'base64')); res.json({ status: 'success' }); } catch(e) { res.json({ error: e.message }); } });
app.post('/api/delete', (req, res) => { try { if(fs.statSync(req.body.path).isDirectory()) fs.rmSync(req.body.path, {recursive:true}); else fs.unlinkSync(req.body.path); res.json({ status: 'success' }); } catch(e) { res.json({ error: e.message }); } });
app.post('/api/rename', (req, res) => { try { fs.renameSync(req.body.oldPath, req.body.newPath); res.json({ status: 'success' }); } catch(e) { res.json({ error: e.message }); } });
app.post('/api/mkdir', (req, res) => { try { fs.mkdirSync(req.body.path, {recursive:true}); res.json({ status: 'success' }); } catch(e) { res.json({ error: e.message }); } });

function handleExecute(req, res) {
    let command = (req.body.command || '').trim();
    if (!command) return res.json({ error: 'No command' });
    if (command.startsWith('download::')) return res.json({ status: 'success', stdout: '[Download initiated]', action: 'download', path: command.split('::')[1] });
    if (command === 'screen::on') return res.json({ status: 'success', stdout: '[Screen Stream Opening...]', action: 'open_screen' });
    if (command === 'screen::off') return res.json({ status: 'success', stdout: '[Screen Stream Closed]', action: 'close_screen' });
    if (command.startsWith('open::')) { exec(`monkey -p ${command.split('::')[1]} -c android.intent.category.LAUNCHER 1`); return res.json({ status: 'success', stdout: '[App Opened]', action: 'open_tab', app: command.split('::')[1] }); }
    if (command.startsWith('close::')) { execSync(`am force-stop ${command.split('::')[1]}`); return res.json({ status: 'success', stdout: '[App Closed]', action: 'close_tab', app: command.split('::')[1] }); }
    if (command.startsWith('bg::')) { exec(command.split('::')[1]); return res.json({ status: 'success', stdout: '[Background Started]' }); }
    if (command.startsWith('kill::')) { execSync(`kill -9 ${command.split('::')[1]}`); return res.json({ status: 'success', stdout: '[Killed]' }); }
    if (command.startsWith('installapk::')) { exec(`termux-open ${command.split('::')[1]}`); return res.json({ status: 'success', stdout: '[APK Installer Triggered]' }); }
    if (command === 'battery') return res.json({ status: 'success', stdout: execSync("dumpsys battery | grep -E 'level|status|temperature'").toString() });
    if (command === 'storage') return res.json({ status: 'success', stdout: execSync("df -h /sdcard").toString() });
    if (command === 'ps') return res.json({ status: 'success', stdout: execSync("ps -ef").toString().substring(0, MAX_OUTPUT) });
    if (command === 'myip') { try { return res.json({ status: 'success', stdout: execSync("curl -s ifconfig.me 2>/dev/null").toString().trim() }); } catch(e) { return res.json({ status: 'success', stdout: 'No Internet Access' }); } }
    exec(command, { timeout: 30000 }, (err, stdout, stderr) => res.json({ status: 'success', stdout: (stdout||'').substring(0, MAX_OUTPUT), stderr: (stderr||'').substring(0, MAX_OUTPUT), code: err ? err.code : 0 }));
}

// --- WebSocket for Fast Live Screen Stream ---
wss.on('connection', (ws, req) => {
    const params = new URLSearchParams(req.url.split('?')[1]);
    const token = params.get('token');
    if (!token || !SESSIONS[token]) { ws.close(); return; }
    let streaming = true;
    const streamScreen = async () => {
        if (!streaming || ws.readyState !== ws.OPEN) return;
        try { const buffer = execSync('adb exec-out screencap -p', { maxBuffer: 1024*1024*10 }); ws.send(buffer); } catch (e) {}
        setTimeout(streamScreen, 500); 
    };
    streamScreen();
    ws.on('close', () => { streaming = false; });
});

// --- Tap Control API ---
app.get('/tap', (req, res) => {
    const { x, y } = req.query;
    if(x && y) exec(`adb shell input tap ${x} ${y}`);
    res.send('ok');
});

// --- Main UI HTML (Minified & Compressed) ---
app.get('/', (req, res) => {
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
    res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Termux Remote</title><style>body{background:#000;color:#0f0;font-family:monospace;padding:0;margin:0;height:100vh;display:flex;flex-direction:column}#top-bar{padding:10px;background:#111;display:flex;gap:10px;flex-wrap:wrap}.tab-btn{background:#222;color:#0f0;border:1px solid #0f0;padding:5px 10px;cursor:pointer}.tab-btn.active{background:#0f0;color:#000;font-weight:bold}#auth-container,#main-container{flex:1;display:flex;flex-direction:column;overflow:hidden}#terminal-tab,#files-tab{flex:1;display:none;flex-direction:column;overflow:hidden}#terminal-tab.active,#files-tab.active{display:flex}#output{flex:1;overflow:auto;padding:10px;white-space:pre-wrap}#bottom-bar{display:flex;padding:10px;gap:10px;background:#111}input,select{flex:1;background:#222;color:#0f0;border:1px solid #0f0;padding:8px}button{background:#0f0;color:#000;border:none;padding:8px 12px;font-weight:bold;cursor:pointer}.line{margin-bottom:5px}.err{color:#f55}.sys{color:#0ff}.file-item{padding:10px;border-bottom:1px solid #222;cursor:pointer;display:flex;justify-content:space-between;align-items:center}.file-item:hover{background:#333}.file-name{color:#0f0;flex:1;word-break:break-all}.file-actions{display:flex;gap:5px;align-items:center}.file-size{color:#888;font-size:0.8em;margin-right:8px}.opt-btn{background:#555;color:#fff;border:none;padding:4px 8px;cursor:pointer;font-size:14px}#path-bar{padding:10px;background:#111;border-bottom:1px solid #0f0;display:flex;align-items:center;gap:10px}#current-path{flex:1;color:#0f0;word-break:break-all}</style></head><body><div id="top-bar"><button class="tab-btn active" onclick="switchTab('terminal',this)">Terminal</button><button class="tab-btn" onclick="switchTab('files',this)">Files</button></div><div id="auth-container" style="display:flex"><div id="setup-screen" style="display:none;padding:20px;flex:1;overflow:auto"><h2>First Time Setup</h2><p>Create account:</p><input id="s-user" placeholder="Username"><br><br><input id="s-pass" type="password" placeholder="Password"><br><br><button onclick="createAccount()">Create Account</button></div><div id="login-screen" style="display:none;padding:20px;flex:1;overflow:auto"><h2>Login</h2><input id="l-user" placeholder="Username"><br><br><input id="l-pass" type="password" placeholder="Password"><br><br><button onclick="login()">Login</button></div></div><div id="main-container" style="display:none"><div id="terminal-tab" class="active"><div id="output"></div><div id="bottom-bar"><input id="command" placeholder="Enter command" onkeydown="if(event.key==='Enter')run()"><button onclick="run()">Run</button></div></div><div id="files-tab"><div id="path-bar"><span id="current-path">/sdcard</span><button onclick="uploadFile()">Upload</button><input type="file" id="file-input" style="display:none" onchange="handleUpload()"><button onclick="newFolder()">+Folder</button></div><div id="file-list" style="flex:1;overflow:auto"></div></div></div><script>let TOKEN='',currentPath='/sdcard',appWindows={},screenWindow=null;window.onload=()=>{checkSetup()};async function checkSetup(){let r=await fetch('/api/check_setup'),d=await r.json();d.exists?(document.getElementById('login-screen').style.display='block',document.getElementById('setup-screen').style.display='none'):(document.getElementById('setup-screen').style.display='block',document.getElementById('login-screen').style.display='none')}async function createAccount(){let u=document.getElementById('s-user').value,p=document.getElementById('s-pass').value,r=await fetch('/api/create_account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})}),d=await r.json();d.status==='success'?(TOKEN=d.token,showMain()):alert(d.error)}async function login(){let u=document.getElementById('l-user').value,p=document.getElementById('l-pass').value,r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})}),d=await r.json();d.status==='success'?(TOKEN=d.token,showMain()):alert(d.error)}function showMain(){document.getElementById('auth-container').style.display='none',document.getElementById('main-container').style.display='flex',add('Login success. Commands: open::pkg, close::pkg, screen::on, screen::off, myip','sys'),listFiles(currentPath)}function switchTab(t,b){document.querySelectorAll('.tab-btn').forEach(e=>e.classList.remove('active')),document.querySelectorAll('#terminal-tab,#files-tab').forEach(e=>e.classList.remove('active')),b.classList.add('active'),document.getElementById(t+'-tab').classList.add('active'),t==='files'&&listFiles(currentPath)}function add(t,c=''){let d=document.createElement('div');d.className='line '+c,d.textContent=t,document.getElementById('output').appendChild(d),document.getElementById('output').scrollTop=999999}async function run(){if(!TOKEN)return;let c=document.getElementById('command').value;document.getElementById('command').value='',add('$ '+c);let r=await fetch('/api/execute',{method:'POST',headers:{'Content-Type':'application/json','Authorization':TOKEN},body:JSON.stringify({command:c})}),d=await r.json();if(d.status==='success'){d.action==='download'&&window.open('/api/download?path='+encodeURIComponent(d.path),'_blank');d.action==='open_tab'&&((!appWindows[d.app]||appWindows[d.app].closed)?appWindows[d.app]=window.open('/app_view?name='+encodeURIComponent(d.app),'app_window_'+d.app):appWindows[d.app].focus());d.action==='close_tab'&&(appWindows[d.app]&&!appWindows[d.app].closed)&&(appWindows[d.app].close(),delete appWindows[d.app]);d.action==='open_screen'&&((!screenWindow||screenWindow.closed)?screenWindow=window.open('/screen-ui','screen_mirror_window'):screenWindow.focus());d.action==='close_screen'&&screenWindow&&!screenWindow.closed&&(screenWindow.close(),screenWindow=null);d.stdout&&add(d.stdout),d.stderr&&add(d.stderr,'err')}else add(d.error,'err')}function b64E(s){return btoa(encodeURIComponent(s).replace(/%([0-9A-F]{2})/g,(m,p)=>String.fromCharCode('0x'+p)))}function b64D(s){return decodeURIComponent(Array.from(atob(s),c=>'%'+('00'+c.charCodeAt(0).toString(16)).slice(-2)).join(''))}async function listFiles(p){currentPath=p,document.getElementById('current-path').textContent=p;let r=await fetch('/api/list',{method:'POST',headers:{'Content-Type':'application/json','Authorization':TOKEN},body:JSON.stringify({path:p})}),d=await r.json(),h='';if(p!=='/'){let pp=p.substring(0,p.lastIndexOf('/'))||'/';h+=\`<div class="file-item" data-path="\${b64E(pp)}" data-type="dir"><span class="file-name">📁 [..]</span></div>\`}d.status==='success'?d.files.forEach(f=>{let s=f.size>0?(f.size/1024/1024).toFixed(2)+' MB':'',eP=b64E(f.path);f.dir?h+=\`<div class="file-item" data-path="\${eP}" data-type="dir"><span class="file-name">📁 \${f.name}</span></div>\`:h+=\`<div class="file-item" data-path="\${eP}" data-type="file"><span class="file-name">📄 \${f.name}</span><div class="file-actions"><span class="file-size">\${s}</span><button class="opt-btn" data-path="\${eP}">⚙</button></div></div>\`}):h=\`<div class="err" style="padding:10px">\${d.error}</div>\`,document.getElementById('file-list').innerHTML=h}document.getElementById('file-list').addEventListener('click',function(e){if(e.target.classList.contains('opt-btn'))return fileOptions(b64D(e.target.getAttribute('data-path')));let i=e.target.closest('.file-item');if(!i)return;let p=b64D(i.getAttribute('data-path')),t=i.getAttribute('data-type');t==='dir'?listFiles(p):window.open('/api/download?path='+encodeURIComponent(p),'_blank')});function fileOptions(p){let a=prompt("Options for:\\n"+p+"\\n\\nType: delete, rename, edit");if(!a)return;a=a.toLowerCase().trim(),a==='delete'?confirm('Are you sure?')&&fetch('/api/delete',{method:'POST',headers:{'Content-Type':'application/json','Authorization':TOKEN},body:JSON.stringify({path:p})}).then(()=>listFiles(currentPath)):a==='rename'?(n=prompt("New full path:",p),n&&n!==p&&fetch('/api/rename',{method:'POST',headers:{'Content-Type':'application/json','Authorization':TOKEN},body:JSON.stringify({oldPath:p,newPath:n})}).then(()=>listFiles(currentPath))):a==='edit'&&loadEditor(p)}async function loadEditor(p){let r=await fetch('/api/read',{method:'POST',headers:{'Content-Type':'application/json','Authorization':TOKEN},body:JSON.stringify({path:p})}),d=await r.json(),c=d.status==='success'?d.content:'',n=prompt("Edit file content:",c);n!==null&&fetch('/api/write',{method:'POST',headers:{'Content-Type':'application/json','Authorization':TOKEN},body:JSON.stringify({path:p,content:n})})}function uploadFile(){document.getElementById('file-input').click()}async function handleUpload(){let f=document.getElementById('file-input').files[0];if(!f)return;let r=new FileReader();r.onload=async e=>{let b=e.target.result.split(',')[1];await fetch('/api/upload',{method:'POST',headers:{'Content-Type':'application/json','Authorization':TOKEN},body:JSON.stringify({path:currentPath+'/'+f.name,content:b})}),listFiles(currentPath)},r.readAsDataURL(f),document.getElementById('file-input').value=''}function newFolder(){let n=prompt("New folder name:");n&&fetch('/api/mkdir',{method:'POST',headers:{'Content-Type':'application/json','Authorization':TOKEN},body:JSON.stringify({path:currentPath+'/'+n})}).then(()=>listFiles(currentPath))}</script></body></html>`);
});

// --- Live Screen UI HTML ---
app.get('/screen-ui', (req, res) => {
    let screenRes = '1080x2400';
    try { const r = execSync('adb shell wm size').toString(); if(r.includes('Physical size:')) screenRes = r.split('Physical size:')[1].trim(); } catch {}
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
    res.end(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Live Screen</title><style>body{margin:0;background:#000;display:flex;justify-content:center;align-items:center;height:100vh;overflow:hidden}img{max-width:100%;max-height:100%;cursor:pointer;user-select:none;-webkit-user-drag:none}#info{position:absolute;top:10px;left:10px;color:#0f0;font-family:monospace;background:rgba(0,0,0,0.7);padding:5px;font-size:12px;pointer-events:none}</style></head><body><div id="info">Connecting...</div><img id="screen" src="" onclick="handleTap(event)"><script>let TOKEN=localStorage.getItem('remote_token')||prompt("Enter Auth Token:");localStorage.setItem('remote_token',TOKEN);let resArr="${screenRes}".split('x'),sW=parseInt(resArr[0]),sH=parseInt(resArr[1]);const ws=new WebSocket('ws://'+window.location.host+'?token='+TOKEN);ws.onopen=()=>{document.getElementById('info').innerText='Live - Tap to Control'},ws.onmessage=e=>{if(e.data instanceof Blob){let i=document.getElementById('screen');i.src=URL.createObjectURL(e.data)}},ws.onclose=()=>{document.getElementById('info').innerText='Disconnected'},ws.onerror=()=>{document.getElementById('info').innerText='Connection Error'};function handleTap(e){const i=e.target,r=i.getBoundingClientRect(),cX=(e.clientX-r.left)/r.width,cY=(e.clientY-r.top)/r.height;fetch('/tap?x='+Math.round(cX*sW)+'&y='+Math.round(cY*sH),{headers:{'Authorization':TOKEN}})}</script></body></html>`);
});

// --- App View HTML ---
app.get('/app_view', (req, res) => {
    const appName = req.query.name || 'App';
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
    res.end(`<!DOCTYPE html><html><head><title>${appName}</title><style>body{background:#000;color:#0f0;font-family:monospace;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;flex-direction:column}h1{font-size:24px}p{color:#888}</style></head><body><h1>🚀 ${appName}</h1><p>App is running. Use 'close::${appName}' to close.</p></body></html>`);
});

// --- Start Server ---
server.listen(PORT, '0.0.0.0', () => {
    const networkIp = getNetworkIp();
    let publicIp = '';
    try { publicIp = execSync('curl -s ifconfig.me 2>/dev/null', {timeout: 3000}).toString().trim(); } catch {}
    console.log('\n=================================');
    console.log('TERMUX REMOTE SERVER - PRO VERSION');
    console.log('=================================');
    console.log(`Local Network IP (Mobile/WiFi):\nhttp://${networkIp}:${PORT}`);
    if(publicIp) console.log(`\nPublic Internet IP:\nhttp://${publicIp}:${PORT} (Requires Port Forwarding)`);
    console.log(`\nLocalhost:\nhttp://127.0.0.1:${PORT}`);
    console.log('\nType "myip" in terminal to check Public IP');
    console.log('=================================');
});
