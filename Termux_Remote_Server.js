const express = require('express');
const compression = require('compression');
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

// Gzip Compression සක්‍රීය කිරීම (Website එක වේගයෙන් Load වීමට)
app.use(compression({ filter: (req, res) => { if (req.headers['x-no-compression']) return false; return compression.filter(req, res); } }));
app.use(express.json());

const PORT = 8080;
const MAX_OUTPUT = 50000;
const SESSION_TIMEOUT = 86400;
const USERS_FILE = 'users.txt';
const SESSIONS = {};
const BASE_DIR = '/sdcard';

// --- Helper Functions ---
function hashPassword(pw) { 
    return crypto.createHash('sha256').update(pw).digest('hex'); 
}

function verifyUser(username, password) {
    if (!fs.existsSync(USERS_FILE)) return false;
    const hashedPassword = hashPassword(password);
    return fs.readFileSync(USERS_FILE, 'utf-8').split('\n').some(line => { 
        if(!line.trim()) return false; 
        const [u, p] = line.split(':'); 
        return u === username && p === hashedPassword; 
    });
}

function userExists(username) {
    if (!fs.existsSync(USERS_FILE)) return false;
    return fs.readFileSync(USERS_FILE, 'utf-8').split('\n').some(line => { 
        if(!line.trim()) return false; 
        const [u] = line.split(':'); 
        return u === username; 
    });
}

function createUser(username, password) { 
    const hashedPassword = hashPassword(password);
    fs.appendFileSync(USERS_FILE, `${username}:${hashedPassword}\n`); 
}

function validatePath(inputPath) {
    try {
        const realPath = path.resolve(inputPath);
        const baseDir = path.resolve(BASE_DIR);
        return realPath.startsWith(baseDir) ? realPath : null;
    } catch (e) {
        return null;
    }
}

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
    const token = crypto.randomBytes(32).toString('hex'); 
    SESSIONS[token] = Date.now();
    res.json({ status: 'success', token });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (verifyUser(username, password)) {
        const token = crypto.randomBytes(32).toString('hex'); 
        SESSIONS[token] = Date.now();
        res.json({ status: 'success', token });
    } else { 
        res.status(401).json({ error: 'Wrong credentials' }); 
    }
});

app.use(authMiddleware); // Auth required for APIs below

app.get('/api/info', (req, res) => {
    try {
        const system = execSync('uname -a').toString().trim();
        res.json({ status: 'success', system: system });
    } catch (e) {
        res.json({ error: e.message });
    }
});

app.get('/api/download', (req, res) => {
    const filePath = validatePath(req.query.path);
    if (!filePath) return res.status(400).json({ error: 'Invalid path' });
    if (fs.existsSync(filePath)) {
        res.download(filePath);
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

app.post('/api/execute', (req, res) => { handleExecute(req, res); });

app.post('/api/list', (req, res) => {
    const dirPath = validatePath(req.body.path || BASE_DIR);
    if (!dirPath) return res.json({ error: 'Invalid path' });
    try {
        const items = fs.readdirSync(dirPath).map(name => {
            const full = path.join(dirPath, name); 
            const isDir = fs.statSync(full).isDirectory();
            return { name, path: full, dir: isDir, size: isDir ? 0 : fs.statSync(full).size };
        }).sort((a,b) => (a.dir === b.dir) ? a.name.localeCompare(b.name) : (a.dir ? -1 : 1));
        res.json({ status: 'success', files: items });
    } catch(e) { 
        res.json({ error: e.message }); 
    }
});

app.post('/api/read', (req, res) => { 
    const filePath = validatePath(req.body.path);
    if (!filePath) return res.json({ error: 'Invalid path' });
    try { 
        res.json({ status: 'success', content: fs.readFileSync(filePath, 'utf-8') }); 
    } catch(e) { 
        res.json({ error: e.message }); 
    } 
});

app.post('/api/write', (req, res) => { 
    const filePath = validatePath(req.body.path);
    if (!filePath) return res.json({ error: 'Invalid path' });
    try { 
        fs.mkdirSync(path.dirname(filePath), {recursive:true}); 
        fs.writeFileSync(filePath, req.body.content); 
        res.json({ status: 'success' }); 
    } catch(e) { 
        res.json({ error: e.message }); 
    } 
});

app.post('/api/upload', (req, res) => { 
    const filePath = validatePath(req.body.path);
    if (!filePath) return res.json({ error: 'Invalid path' });
    try { 
        fs.mkdirSync(path.dirname(filePath), {recursive:true}); 
        fs.writeFileSync(filePath, Buffer.from(req.body.content, 'base64')); 
        res.json({ status: 'success' }); 
    } catch(e) { 
        res.json({ error: e.message }); 
    } 
});

app.post('/api/delete', (req, res) => { 
    const filePath = validatePath(req.body.path);
    if (!filePath) return res.json({ error: 'Invalid path' });
    try { 
        if(fs.statSync(filePath).isDirectory()) {
            fs.rmSync(filePath, {recursive:true}); 
        } else {
            fs.unlinkSync(filePath); 
        }
        res.json({ status: 'success' }); 
    } catch(e) { 
        res.json({ error: e.message }); 
    } 
});

app.post('/api/rename', (req, res) => { 
    const oldPath = validatePath(req.body.oldPath);
    const newPath = validatePath(req.body.newPath);
    if (!oldPath || !newPath) return res.json({ error: 'Invalid path' });
    try { 
        fs.renameSync(oldPath, newPath); 
        res.json({ status: 'success' }); 
    } catch(e) { 
        res.json({ error: e.message }); 
    } 
});

app.post('/api/mkdir', (req, res) => { 
    const dirPath = validatePath(req.body.path);
    if (!dirPath) return res.json({ error: 'Invalid path' });
    try { 
        fs.mkdirSync(dirPath, {recursive:true}); 
        res.json({ status: 'success' }); 
    } catch(e) { 
        res.json({ error: e.message }); 
    } 
});

function handleExecute(req, res) {
    let command = (req.body.command || '').trim();
    if (!command) return res.json({ error: 'No command' });
    
    // Special commands
    if (command.startsWith('download::')) {
        const filePath = validatePath(command.split('::')[1]);
        if (!filePath) return res.json({ error: 'Invalid path' });
        return res.json({ status: 'success', stdout: '[Download initiated]', action: 'download', path: filePath });
    }
    
    if (command === 'screen::on') {
        return res.json({ status: 'success', stdout: '[Screen Stream Opening...]', action: 'open_screen' });
    }
    
    if (command === 'screen::off') {
        return res.json({ status: 'success', stdout: '[Screen Stream Closed]', action: 'close_screen' });
    }
    
    if (command.startsWith('open::')) { 
        const appName = command.split('::')[1];
        exec(`monkey -p ${appName} -c android.intent.category.LAUNCHER 1`); 
        return res.json({ status: 'success', stdout: '[App Opened]', action: 'open_app', app: appName });
    }
    
    if (command.startsWith('close::')) { 
        const appName = command.split('::')[1];
        execSync(`am force-stop ${appName}`); 
        return res.json({ status: 'success', stdout: '[App Closed]', action: 'close_tab', app: appName });
    }
    
    if (command.startsWith('bg::')) { 
        const bgCmd = command.split('::')[1];
        exec(bgCmd); 
        return res.json({ status: 'success', stdout: '[Background Started]' }); 
    }
    
    if (command.startsWith('kill::')) { 
        const pid = command.split('::')[1];
        execSync(`kill -9 ${pid}`); 
        return res.json({ status: 'success', stdout: '[Killed]' }); 
    }
    
    if (command.startsWith('installapk::')) { 
        const apkPath = command.split('::')[1];
        exec(`termux-open ${apkPath}`); 
        return res.json({ status: 'success', stdout: '[APK Installer Triggered]' }); 
    }
    
    if (command === 'battery') {
        try {
            const battery = execSync("dumpsys battery | grep -E 'level|status|temperature'").toString();
            return res.json({ status: 'success', stdout: battery });
        } catch (e) {
            return res.json({ status: 'success', stdout: 'Battery info unavailable' });
        }
    }
    
    if (command === 'storage') {
        try {
            const storage = execSync("df -h /sdcard").toString();
            return res.json({ status: 'success', stdout: storage });
        } catch (e) {
            return res.json({ status: 'success', stdout: 'Storage info unavailable' });
        }
    }
    
    if (command === 'ps') {
        try {
            const processes = execSync("ps -ef").toString().substring(0, MAX_OUTPUT);
            return res.json({ status: 'success', stdout: processes });
        } catch (e) {
            return res.json({ status: 'success', stdout: 'Process list unavailable' });
        }
    }
    
    if (command === 'myip') { 
        try { 
            const ip = execSync("curl -s ifconfig.me 2>/dev/null", {timeout: 5000}).toString().trim();
            return res.json({ status: 'success', stdout: ip });
        } catch(e) { 
            return res.json({ status: 'error', stdout: 'Could not fetch public IP' });
        } 
    }
    
    // Execute arbitrary command
    exec(command, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        res.json({ 
            status: 'success', 
            stdout: (stdout||'').substring(0, MAX_OUTPUT), 
            stderr: (stderr||'').substring(0, MAX_OUTPUT), 
            code: err ? err.code : 0 
        });
    });
}

// --- WebSocket for Fast Live Screen Stream ---
wss.on('connection', (ws, req) => {
    const params = new URLSearchParams(req.url.split('?')[1]);
    const token = params.get('token');
    if (!token || !SESSIONS[token]) { 
        ws.close(); 
        return; 
    }
    
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
    if(x && y) {
        exec(`adb shell input tap ${x} ${y}`);
    }
    res.send('ok');
});

// --- Main UI HTML (Minified & Compressed) ---
app.get('/', (req, res) => {
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
    res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Termux Remote</title><style>body{background:#000;color:#0f0;font-family:monospace;margin:0;padding:20px}.container{max-width:1200px;margin:0 auto}.header{text-align:center;padding:20px 0;border-bottom:2px solid #0f0}.header h1{margin:0;color:#0f0}.login-form,.main-ui{display:none}.login-form.active,.main-ui.active{display:block}.form-group{margin:10px 0}input,textarea,select{background:#111;color:#0f0;border:1px solid #0f0;padding:8px;width:100%;box-sizing:border-box}button{background:#0f0;color:#000;border:none;padding:10px 20px;cursor:pointer;font-weight:bold;margin:5px 5px 5px 0}button:hover{background:#0a0}.section{margin:20px 0;padding:15px;border:1px solid #0f0}.output{background:#111;padding:10px;margin:10px 0;max-height:400px;overflow-y:auto;white-space:pre-wrap;word-wrap:break-word;border:1px solid #0f0}.file-list{list-style:none;padding:0}.file-item{padding:5px;cursor:pointer}.file-item:hover{background:#222}.error{color:#f00}.success{color:#0f0}</style></head><body><div class="container"><div class="header"><h1>🔧 Termux Remote Control</h1></div><div class="login-form active" id="loginForm"><div class="section"><h2>Authentication</h2><div class="form-group"><label>Username:</label><input type="text" id="username" placeholder="Enter username"></div><div class="form-group"><label>Password:</label><input type="password" id="password" placeholder="Enter password"></div><button onclick="login()">Login</button><button onclick="createAccount()">Create Account</button><div id="authMessage" style="margin-top:10px;"></div></div></div><div class="main-ui" id="mainUI"><button onclick="logout()">Logout</button><div class="section"><h2>⚙️ Execute Command</h2><input type="text" id="command" placeholder="Enter command (e.g., ls -la /sdcard)"><button onclick="executeCommand()">Execute</button><div id="cmdOutput" class="output"></div></div><div class="section"><h2>📁 File Manager</h2><input type="text" id="dirPath" value="/sdcard" placeholder="Directory path"><button onclick="listFiles()">List Files</button><div id="fileList" class="output"></div></div><div class="section"><h2>📖 Read File</h2><input type="text" id="readPath" placeholder="File path"><button onclick="readFile()">Read</button><div id="readOutput" class="output"></div></div><div class="section"><h2>✏️ Write File</h2><input type="text" id="writePath" placeholder="File path"><textarea id="writeContent" placeholder="File content" rows="5"></textarea><button onclick="writeFile()">Write</button><div id="writeMessage" style="margin-top:10px;"></div></div><div class="section"><h2>ℹ️ System Info</h2><button onclick="getSystemInfo()">Get Info</button><div id="sysInfo" class="output"></div></div></div></div><script>let token=localStorage.getItem('token');function showAuth(show){document.getElementById('loginForm').className=show?'login-form active':'login-form';document.getElementById('mainUI').className=show?'main-ui':'main-ui active'}function login(){const username=document.getElementById('username').value;const password=document.getElementById('password').value;fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})}).then(r=>r.json()).then(data=>{if(data.status==='success'){token=data.token;localStorage.setItem('token',token);showAuth(false);document.getElementById('authMessage').innerHTML=''}else{document.getElementById('authMessage').innerHTML='<span class="error">'+data.error+'</span>'}})}function createAccount(){const username=document.getElementById('username').value;const password=document.getElementById('password').value;fetch('/api/create_account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})}).then(r=>r.json()).then(data=>{if(data.status==='success'){token=data.token;localStorage.setItem('token',token);showAuth(false);document.getElementById('authMessage').innerHTML=''}else{document.getElementById('authMessage').innerHTML='<span class="error">'+data.error+'</span>'}})}function logout(){localStorage.removeItem('token');token=null;showAuth(true);document.getElementById('username').value='';document.getElementById('password').value=''}function executeCommand(){const command=document.getElementById('command').value;fetch('/api/execute',{method:'POST',headers:{'Content-Type':'application/json','Authorization':token},body:JSON.stringify({command})}).then(r=>r.json()).then(data=>{let output=data.stdout+(data.stderr?'\\nERROR: '+data.stderr:'');document.getElementById('cmdOutput').innerHTML=output||'No output'})}function listFiles(){const path=document.getElementById('dirPath').value;fetch('/api/list',{method:'POST',headers:{'Content-Type':'application/json','Authorization':token},body:JSON.stringify({path})}).then(r=>r.json()).then(data=>{if(data.files){let html='<ul class="file-list">';data.files.forEach(f=>{html+='<li class="file-item" onclick="selectFile(\''+f.path+'\')">'+（f.dir?'📁':'📄')+' '+f.name+' ('+f.size+'B)</li>'});html+='</ul>';document.getElementById('fileList').innerHTML=html}})}function readFile(){const path=document.getElementById('readPath').value;fetch('/api/read',{method:'POST',headers:{'Content-Type':'application/json','Authorization':token},body:JSON.stringify({path})}).then(r=>r.json()).then(data=>{document.getElementById('readOutput').innerHTML=data.content||data.error||'No content'})}function writeFile(){const path=document.getElementById('writePath').value;const content=document.getElementById('writeContent').value;fetch('/api/write',{method:'POST',headers:{'Content-Type':'application/json','Authorization':token},body:JSON.stringify({path,content})}).then(r=>r.json()).then(data=>{document.getElementById('writeMessage').innerHTML=data.status==='success'?'<span class="success">✓ File written successfully</span>':'<span class="error">'+data.error+'</span>'})}function getSystemInfo(){fetch('/api/info',{headers:{'Authorization':token}}).then(r=>r.json()).then(data=>{document.getElementById('sysInfo').innerHTML=data.system||'Unable to fetch info'})}function selectFile(path){document.getElementById('readPath').value=path}if(!token){showAuth(true)}else{showAuth(false)}</script></body></html>`);
});

// --- Live Screen UI HTML ---
app.get('/screen-ui', (req, res) => {
    let screenRes = '1080x2400';
    try { const r = execSync('adb shell wm size').toString(); if(r.includes('Physical size:')) screenRes = r.split('Physical size:')[1].trim(); } catch {}
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
    res.end(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Live Screen</title><style>body{margin:0;background:#000;display:flex;justify-content:center;align-items:center;height:100vh}canvas{max-width:100%;max-height:100%;border:2px solid #0f0}</style></head><body><canvas id="screen"></canvas><script>const canvas=document.getElementById('screen');const ctx=canvas.getContext('2d');const token=new URLSearchParams(window.location.search).get('token');const ws=new WebSocket('ws://'+window.location.host+'?token='+token);ws.binaryType='arraybuffer';ws.onmessage=e=>{const img=new Image();img.onload=()=>{canvas.width=img.width;canvas.height=img.height;ctx.drawImage(img,0,0)};img.src='data:image/png;base64,'+btoa(String.fromCharCode.apply(null,new Uint8Array(e.data)))}}</script></body></html>`);
});

// --- App View HTML ---
app.get('/app_view', (req, res) => {
    const appName = req.query.name || 'App';
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
    res.end(`<!DOCTYPE html><html><head><title>${appName}</title><style>body{background:#000;color:#0f0;font-family:monospace;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}</style></head><body><div>${appName} is running</div></body></html>`);
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
    console.log('=================================\n');
});