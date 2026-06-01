const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');
const os = require('os'); // IP Address හොයාගන්න අවශ්‍ය මොඩියුලය

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

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

// --- නව වැඩිදියුණු කළ IP හොයන ෆන්ක්ෂන් එක (Mobile Data / WiFi දෙකටම වැඩ කරයි) ---
function getNetworkIp() {
    try {
        const nets = os.networkInterfaces();
        let mobileIp = null;
        let wifiIp = null;
        let otherIp = null;

        for (const name of Object.keys(nets)) {
            for (const net of nets[name]) {
                // IPv4 සහ Internal (127.0.0.1) නොවන IPs පමණක් ගනියි
                if (net.family === 'IPv4' && !net.internal) {
                    if (name.startsWith('rmnet') || name.startsWith('ccmni')) mobileIp = net.address; // Mobile Data
                    else if (name === 'wlan0') wifiIp = net.address; // WiFi
                    else if (!otherIp) otherIp = net.address;
                }
            }
        }
        // Mobile Data එක Active නම් එය පෙන්වයි, නැත්නම් WiFi එක පෙන්වයි
        return mobileIp || wifiIp || otherIp || '127.0.0.1';
    } catch(e) {}
    return '127.0.0.1';
}

function authMiddleware(req, res, next) {
    const token = req.headers['authorization'];
    if (!token || !SESSIONS[token] || (Date.now() - SESSIONS[token] > SESSION_TIMEOUT * 1000)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
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
    if (command === 'myip') return res.json({ status: 'success', stdout: execSync("curl -s ifconfig.me 2>/dev/null").toString().trim() || 'No Internet IP' });
    exec(command, { timeout: 30000 }, (err, stdout, stderr) => res.json({ status: 'success', stdout: (stdout||'').substring(0, MAX_OUTPUT), stderr: (stderr||'').substring(0, MAX_OUTPUT), code: err ? err.code : 0 }));
}

// --- WebSocket for Fast Live Screen ---
wss.on('connection', (ws, req) => {
    const params = new URLSearchParams(req.url.split('?')[1]);
    const token = params.get('token');
    if (!token || !SESSIONS[token]) { ws.close(); return; }
    
    let streaming = true;
    const streamScreen = async () => {
        if (!streaming || ws.readyState !== ws.OPEN) return;
        try {
            const buffer = execSync('adb exec-out screencap -p', { maxBuffer: 1024*1024*10 });
            ws.send(buffer);
        } catch (e) {}
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

// --- Main UI HTML ---
app.get('/', (req, res) => {
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
    res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Termux Remote</title>
    <style>body{background:#000;color:#0f0;font-family:monospace;padding:0;margin:0;height:100vh;display:flex;flex-direction:column;}
    #top-bar{padding:10px;background:#111;display:flex;gap:10px;flex-wrap:wrap;}.tab-btn{background:#222;color:#0f0;border:1px solid #0f0;padding:5px 10px;cursor:pointer;}.tab-btn.active{background:#0f0;color:#000;font-weight:bold;}
    #auth-container,#main-container{flex:1;display:flex;flex-direction:column;overflow:hidden;}#terminal-tab,#files-tab{flex:1;display:none;flex-direction:column;overflow:hidden;}#terminal-tab.active,#files-tab.active{display:flex;}
    #output{flex:1;overflow:auto;padding:10px;white-space:pre-wrap;}#bottom-bar{display:flex;padding:10px;gap:10px;background:#111;}
    input,select{flex:1;background:#222;color:#0f0;border:1px solid #0f0;padding:8px;}button{background:#0f0;color:#000;border:none;padding:8px 12px;font-weight:bold;cursor:pointer;}
    .line{margin-bottom:5px;}.err{color:#f55;}.sys{color:#0ff;}.file-item{padding:10px;border-bottom:1px solid #222;cursor:pointer;display:flex;justify-content:space-between;align-items:center;}.file-item:hover{background:#333;}
    .file-name{color:#0f0;flex:1;word-break:break-all;}.file-actions{display:flex;gap:5px;align-items:center;}.file-size{color:#888;font-size:0.8em;margin-right:8px;}.opt-btn{background:#555;color:#fff;border:none;padding:4px 8px;cursor:pointer;font-size:14px;}
    #path-bar{padding:10px;background:#111;border-bottom:1px solid #0f0;display:flex;align-items:center;gap:10px;}#current-path{flex:1;color:#0f0;word-break:break-all;}</style></head>
    <body><div id="top-bar"><button class="tab-btn active" onclick="switchTab('terminal',this)">Terminal</button><button class="tab-btn" onclick="switchTab('files',this)">Files</button></div>
    <div id="auth-container" style="display:flex;"><div id="setup-screen" style="display:none;padding:20px;flex:1;overflow:auto;"><h2>First Time Setup</h2><p>Create account:</p><input id="s-user" placeholder="Username"><br><br><input id="s-pass" type="password" placeholder="Password"><br><br><button onclick="createAccount()">Create Account</button></div>
    <div id="login-screen" style="display:none;padding:20px;flex:1;overflow:auto;"><h2>Login</h2><input id="l-user" placeholder="Username"><br><br><input id="l-pass" type="password" placeholder="Password"><br><br><button onclick="login()">Login</button></div></div>
    <div id="main-container" style="display:none;"><div id="terminal-tab" class="active"><div id="output"></div><div id="bottom-bar"><input id="command" placeholder="Enter command" onkeydown="if(event.key==='Enter')run()"><button onclick="run()">Run</button></div></div>
    <div id="files-tab"><div id="path-bar"><span id="current-path">/sdcard</span><button onclick="uploadFile()">Upload</button><input type="file" id="file-input" style="display:none" onchange="handleUpload()"><button onclick="newFolder()">+Folder</button></div><div id="file-list" style="flex:1;overflow:auto;"></div></div></div>
    <script>
    let TOKEN=''; let currentPath='/sdcard'; let appWindows={}; let screenWindow=null;
    window.onload=()=>{checkSetup();};
    async function checkSetup(){let r=await fetch('/api/check_setup');let d=await r.json();if(d.exists){document.getElementById('login-screen').style.display='block';document.getElementById('setup-screen').style.display='none';}else{document.getElementById('setup-screen').style.display='block';document.getElementById('login-screen').style.display='none';}}
    async function createAccount(){let u=document.getElementById('s-user').value,p=document.getElementById('s-pass').value;let r=await fetch('/api/create_account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});let d=await r.json();if(d.status==='success'){TOKEN=d.token;showMain();}else{alert(d.error);}}
    async function login(){let u=document.getElementById('l-user').value,p=document.getElementById('l-pass').value;let r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});let d=await r.json();if(d.status==='success'){TOKEN=d.token;showMain();}else{alert(d.error);}}
    function showMain(){document.getElementById('auth-container').style.display='none';document.getElementById('main-container').style.display='flex';add('Login success. Commands: open::pkg, close::pkg, screen::on, screen::off, myip','sys');listFiles(currentPath);}
    function switchTab(tab,btn){document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));document.querySelectorAll('#terminal-tab,#files-tab').forEach(t=>t.classList.remove('active'));btn.classList.add('active');document.getElementById(tab+'-tab').classList.add('active');if(tab==='files')listFiles(currentPath);}
    function add(text,cls=''){let div=document.createElement('div');div.className='line '+cls;div.textContent=text;document.getElementById('output').appendChild(div);document.getElementById('output').scrollTop=999999;}
    async function run(){if(!TOKEN)return;let command=document.getElementById('command').value;document.getElementById('command').value='';add('$ '+command);let r=await fetch('/api/execute',{method:'POST',headers:{'Content-Type':'application/json','Authorization':TOKEN},body:JSON.stringify({command})});let d=await r.json();if(d.status==='success'){
    if(d.action==='download'){window.open('/api/download?path='+encodeURIComponent(d.path),'_blank');}
    if(d.action==='open_tab'){if(!appWindows[d.app]||appWindows[d.app].closed){appWindows[d.app]=window.open('/app_view?name='+encodeURIComponent(d.app),'app_window_'+d.app);}else{appWindows[d.app].focus();}}
    if(d.action==='close_tab'){if(appWindows[d.app]&&!appWindows[d.app].closed){appWindows[d.app].close();delete appWindows[d.app];}}
    if(d.action==='open_screen'){if(!screenWindow||screenWindow.closed){screenWindow=window.open('/screen-ui','screen_mirror_window');}else{screenWindow.focus();}}
    if(d.action==='close_screen'){if(screenWindow&&!screenWindow.closed){screenWindow.close();screenWindow=null;}}
    if(d.stdout)add(d.stdout);if(d.stderr)add(d.stderr,'err');}else{add(d.error,'err');}}
    function b64E(str){return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g,function(m,p){return String.fromCharCode('0x'+p);}));}function b64D(str){return decodeURIComponent(Array.prototype.map.call(atob(str),function(c){return '%'+('00'+c.charCodeAt(0).toString(16)).slice(-2);}).join(''));}
    async function listFiles(path){currentPath=path;document.getElementById('current-path').textContent=path;let r=await fetch('/api/list',{method:'POST',headers:{'Content-Type':'application/json','Authorization':TOKEN},body:JSON.stringify({path})});let d=await r.json();let html='';if(path!=='/'){let pP=path.substring(0,path.lastIndexOf('/'))||'/';html+=\`<div class="file-item" data-path="\${b64E(pP)}" data-type="dir"><span class="file-name">📁 [..]</span></div>\`;}
    if(d.status==='success'){d.files.forEach(f=>{let size=f.size>0?(f.size/1024/1024).toFixed(2)+' MB':'';let eP=b64E(f.path);if(f.dir){html+=\`<div class="file-item" data-path="\${eP}" data-type="dir"><span class="file-name">📁 \${f.name}</span></div>\`;}else{html+=\`<div class="file-item" data-path="\${eP}" data-type="file"><span class="file-name">📄 \${f.name}</span><div class="file-actions"><span class="file-size">\${size}</span><button class="opt-btn" data-path="\${eP}">⚙</button></div></div>\`;}});}else{html=\`<div class="err" style="padding:10px;">\${d.error}</div>\`;}document.getElementById('file-list').innerHTML=html;}
    document.getElementById('file-list').addEventListener('click',function(e){if(e.target.classList.contains('opt-btn')){let p=b64D(e.target.getAttribute('data-path'));fileOptions(p);return;}let item=e.target.closest('.file-item');if(!item)return;let p=b64D(item.getAttribute('data-path'));let t=item.getAttribute('data-type');if(t==='dir')listFiles(p);else window.open('/api/download?path='+encodeURIComponent(p),'_blank');});
    function fileOptions(path){let action=prompt("Options for:\\n"+path+"\\n\\nType: delete, rename, edit");if(!action)return;action=action.toLowerCase().trim();if(action==='delete'){if(confirm('Are you sure?')){fetch('/api/delete',{method:'POST',headers:{'Content-Type':'application/json','Authorization':TOKEN},body:JSON.stringify({path})}).then(()=>listFiles(currentPath));}}else if(action==='rename'){let n=prompt("New full path:",path);if(n&&n!==path)fetch('/api/rename',{method:'POST',headers:{'Content-Type':'application/json','Authorization':TOKEN},body:JSON.stringify({oldPath:path,newPath:n})}).then(()=>listFiles(currentPath));}else if(action==='edit'){loadEditor(path);}}
    async function loadEditor(path){let r=await fetch('/api/read',{method:'POST',headers:{'Content-Type':'application/json','Authorization':TOKEN},body:JSON.stringify({path})});let d=await r.json();let content=d.status==='success'?d.content:'';let newContent=prompt("Edit file content:",content);if(newContent!==null){fetch('/api/write',{method:'POST',headers:{'Content-Type':'application/json','Authorization':TOKEN},body:JSON.stringify({path,content:newContent})});}}
    function uploadFile(){document.getElementById('file-input').click();}
    async function handleUpload(){let file=document.getElementById('file-input').files[0];if(!file)return;let reader=new FileReader();reader.onload=async function(e){let b64=e.target.result.split(',')[1];await fetch('/api/upload',{method:'POST',headers:{'Content-Type':'application/json','Authorization':TOKEN},body:JSON.stringify({path:currentPath+'/'+file.name,content:b64})});listFiles(currentPath);};reader.readAsDataURL(file);document.getElementById('file-input').value='';}
    function newFolder(){let name=prompt("New folder name:");if(!name)return;fetch('/api/mkdir',{method:'POST',headers:{'Content-Type':'application/json','Authorization':TOKEN},body:JSON.stringify({path:currentPath+'/'+name})}).then(()=>listFiles(currentPath));}
    </script></body></html>`);
});

// --- Live Screen UI HTML ---
app.get('/screen-ui', (req, res) => {
    let screenRes = '1080x2400';
    try { const r = execSync('adb shell wm size').toString(); if(r.includes('Physical size:')) screenRes = r.split('Physical size:')[1].trim(); } catch {}
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
    res.end(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Live Screen</title>
    <style>body{margin:0;background:#000;display:flex;justify-content:center;align-items:center;height:100vh;overflow:hidden;}
    img{max-width:100%;max-height:100%;cursor:pointer;user-select:none;-webkit-user-drag:none;}
    #info{position:absolute;top:10px;left:10px;color:#0f0;font-family:monospace;background:rgba(0,0,0,0.7);padding:5px;font-size:12px;pointer-events:none;}</style></head>
    <body><div id="info">Connecting...</div><img id="screen" src="" onclick="handleTap(event)">
    <script>
    let TOKEN = localStorage.getItem('remote_token') || prompt("Enter Auth Token (from main page terminal):");
    localStorage.setItem('remote_token', TOKEN);
    let resArr = "${screenRes}".split('x'); let sW = parseInt(resArr[0]); let sH = parseInt(resArr[1]);
    
    const ws = new WebSocket('ws://' + window.location.host + '?token=' + TOKEN);
    ws.onopen = () => { document.getElementById('info').innerText = 'Live - Tap to Control'; };
    ws.onmessage = (event) => {
        if (event.data instanceof Blob) {
            const img = document.getElementById('screen');
            img.src = URL.createObjectURL(event.data);
        }
    };
    ws.onclose = () => { document.getElementById('info').innerText = 'Disconnected'; };
    ws.onerror = () => { document.getElementById('info').innerText = 'Connection Error'; };

    function handleTap(e) {
        const img=e.target; const r=img.getBoundingClientRect();
        const cX=(e.clientX-r.left)/r.width; const cY=(e.clientY-r.top)/r.height;
        fetch('/tap?x='+Math.round(cX*sW)+'&y='+Math.round(cY*sH), {headers:{'Authorization':TOKEN}});
    }
    </script></body></html>`);
});

// --- Start ---
server.listen(PORT, '0.0.0.0', () => {
    const networkIp = getNetworkIp();
    let publicIp = '';
    try { publicIp = execSync('curl -s ifconfig.me 2>/dev/null', {timeout: 3000}).toString().trim(); } catch {}
    
    console.log('\n=================================');
    console.log('TERMUX REMOTE SERVER - NODE.JS PRO');
    console.log('=================================');
    console.log(`Local IP (Mobile/WiFi):\nhttp://${networkIp}:${PORT}`);
    if(publicIp) console.log(`\nPublic Internet IP:\nhttp://${publicIp}:${PORT} (Requires Port Forwarding)`);
    console.log(`\nLocalhost:\nhttp://127.0.0.1:${PORT}`);
    console.log('\nType "myip" in terminal to check Public IP');
    console.log('=================================');
});
