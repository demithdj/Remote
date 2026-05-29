#!/usr/bin/env python3
import http.server
import socketserver
import json
import subprocess
import os
import sys
import secrets
import hashlib
import time
import re
import base64
import shutil
from urllib.parse import parse_qs

HOST = '0.0.0.0'
PORT = 8080
MAX_OUTPUT = 50000
SESSION_TIMEOUT = 86400
USERS_FILE = 'users.txt'

SESSIONS = {}

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

def get_wifi_ip():
    try:
        result = subprocess.check_output('ip addr show wlan0', shell=True).decode()
        match = re.search(r'inet (\d+\.\d+\.\d+\.\d+)', result)
        if match: return match.group(1)
    except: pass
    return '127.0.0.1'

def verify_user(username, password):
    if not os.path.exists(USERS_FILE): return False
    with open(USERS_FILE, 'r') as f:
        for line in f:
            if line.strip():
                u, p = line.strip().split(':', 1)
                if u == username and p == password: return True
    return False

def user_exists(username):
    if not os.path.exists(USERS_FILE): return False
    with open(USERS_FILE, 'r') as f:
        for line in f:
            if line.strip():
                u, _ = line.strip().split(':', 1)
                if u == username: return True
    return False

def create_user(username, password):
    with open(USERS_FILE, 'a') as f:
        f.write(f'{username}:{password}\n')

class ThreadedServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args): pass

    def send_json(self, data, status=200):
        response = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(response)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', '*')
        self.end_headers()
        self.wfile.write(response)

    def get_json(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8')
            return json.loads(body)
        except: return {}

    def create_session(self):
        token = secrets.token_hex(32)
        SESSIONS[token] = time.time()
        return token

    def authenticated(self):
        token = self.headers.get('Authorization', '')
        if token not in SESSIONS: return False
        if time.time() - SESSIONS[token] > SESSION_TIMEOUT:
            del SESSIONS[token]
            return False
        return True

    def require_auth(self):
        if not self.authenticated():
            self.send_json({'status': 'error', 'error': 'Unauthorized'}, 401)
            return False
        return True

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', '*')
        self.end_headers()

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/': self.serve_html(); return
        
        # Bug Fix: App View Tab එකට HTML ලබා දීම
        if path == '/app_view':
            params = parse_qs(self.path.split('?')[1] if '?' in self.path else '')
            app_name = params.get('name', ['App'])[0]
            self.serve_app_view(app_name)
            return
            
        if path == '/api/download':
            if not self.require_auth(): return
            params = parse_qs(self.path.split('?')[1] if '?' in self.path else '')
            filepath = params.get('path', [''])[0]
            if os.path.exists(filepath) and os.path.isfile(filepath):
                self.send_response(200)
                self.send_header('Content-Type', 'application/octet-stream')
                self.send_header('Content-Disposition', f'attachment; filename="{os.path.basename(filepath)}"')
                self.send_header('Content-Length', str(os.path.getsize(filepath)))
                self.end_headers()
                with open(filepath, 'rb') as f: self.wfile.write(f.read())
            else:
                self.send_json({'status': 'error', 'error': 'File not found'}, 404)
            return
            
        if not self.require_auth(): return
        if path == '/api/info': self.system_info(); return
        self.send_json({'status': 'error', 'error': 'Not found'}, 404)

    def do_POST(self):
        path = self.path.split('?')[0]
        data = self.get_json()

        if path == '/api/check_setup':
            self.send_json({'exists': os.path.exists(USERS_FILE)}); return

        if path == '/api/create_account':
            username, password = data.get('username', ''), data.get('password', '')
            if not username or not password:
                self.send_json({'status': 'error', 'error': 'Empty fields'}); return
            if user_exists(username):
                self.send_json({'status': 'error', 'error': 'User exists'}); return
            create_user(username, password)
            token = self.create_session()
            self.send_json({'status': 'success', 'token': token}); return

        if path == '/api/login':
            username, password = data.get('username', ''), data.get('password', '')
            if verify_user(username, password):
                token = self.create_session()
                self.send_json({'status': 'success', 'token': token})
            else:
                self.send_json({'status': 'error', 'error': 'Wrong username or password'}, 401)
            return

        if not self.require_auth(): return

        if path == '/api/execute': self.execute_command(data); return
        if path == '/api/read': self.read_file(data); return
        if path == '/api/write': self.write_file(data); return
        if path == '/api/list': self.list_files(data); return
        if path == '/api/upload': self.upload_file(data); return
        if path == '/api/delete': self.delete_file(data); return
        if path == '/api/rename': self.rename_file(data); return
        if path == '/api/mkdir': self.make_dir(data); return
        self.send_json({'status': 'error', 'error': 'Not found'}, 404)

    def execute_command(self, data):
        command = data.get('command', '').strip()
        if not command:
            self.send_json({'status': 'error', 'error': 'No command'}); return

        if command.startswith('download::'):
            path = command.replace('download::', '').strip()
            self.send_json({'status': 'success', 'stdout': f'[Download initiated] {path}', 'action': 'download', 'path': path}); return

        # Screen Mirroring Control
        if command == 'screen::on':
            try:
                ws_path = os.path.expanduser('~/ws-scrcpy')
                check = subprocess.run('pgrep -f "node.*ws-scrcpy"', shell=True, capture_output=True)
                if check.returncode != 0:
                    subprocess.Popen('npm start', cwd=ws_path, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                self.send_json({'status': 'success', 'stdout': '[Screen Stream Starting...]', 'action': 'open_url', 'url': 'http://localhost:8000'}); return
            except Exception as e:
                self.send_json({'status': 'error', 'error': str(e)}); return

        if command == 'screen::off':
            try:
                subprocess.run('pkill -f "node.*ws-scrcpy"', shell=True)
                self.send_json({'status': 'success', 'stdout': '[Screen Stream Stopped]', 'action': 'close_url'}); return
            except Exception as e:
                self.send_json({'status': 'error', 'error': str(e)}); return

        if command.startswith('open::'):
            pkg = command.replace('open::', '').strip()
            try:
                subprocess.Popen(f'monkey -p {pkg} -c android.intent.category.LAUNCHER 1', shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                self.send_json({'status': 'success', 'stdout': f'[App Opened] {pkg}', 'action': 'open_tab', 'app': pkg}); return
            except Exception as e:
                self.send_json({'status': 'error', 'error': str(e)}); return
                
        if command.startswith('close::'):
            pkg = command.replace('close::', '').strip()
            try:
                subprocess.run(['am', 'force-stop', pkg], check=True)
                self.send_json({'status': 'success', 'stdout': f'[App Closed] {pkg}', 'action': 'close_tab', 'app': pkg}); return
            except Exception as e:
                self.send_json({'status': 'error', 'error': str(e)}); return
                
        if command.startswith('bg::'):
            cmd = command.replace('bg::', '').strip()
            try:
                subprocess.Popen(cmd, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                self.send_json({'status': 'success', 'stdout': f'[Background] Started: {cmd}'}); return
            except Exception as e:
                self.send_json({'status': 'error', 'error': str(e)}); return
                
        if command.startswith('kill::'):
            pid = command.replace('kill::', '').strip()
            try:
                subprocess.run(['kill', '-9', pid], check=True)
                self.send_json({'status': 'success', 'stdout': f'[Killed] PID {pid}'}); return
            except Exception as e:
                self.send_json({'status': 'error', 'error': str(e)}); return
                
        if command.startswith('installapk::'):
            path = command.replace('installapk::', '').strip()
            try:
                subprocess.Popen(f'termux-open {path}', shell=True)
                self.send_json({'status': 'success', 'stdout': '[APK Installer Triggered]'}); return
            except Exception as e:
                self.send_json({'status': 'error', 'error': str(e)}); return
                
        if command == 'battery':
            try:
                res = subprocess.check_output("dumpsys battery | grep -E 'level|status|temperature'", shell=True).decode()
                self.send_json({'status': 'success', 'stdout': res}); return
            except Exception as e:
                self.send_json({'status': 'error', 'error': str(e)}); return
                
        if command == 'storage':
            try:
                res = subprocess.check_output("df -h /sdcard", shell=True).decode()
                self.send_json({'status': 'success', 'stdout': res}); return
            except Exception as e:
                self.send_json({'status': 'error', 'error': str(e)}); return
                
        if command == 'ps':
            try:
                res = subprocess.check_output("ps -ef", shell=True).decode()
                self.send_json({'status': 'success', 'stdout': res[:MAX_OUTPUT]}); return
            except Exception as e:
                self.send_json({'status': 'error', 'error': str(e)}); return

        try:
            result = subprocess.run(command, shell=True, capture_output=True, text=True, timeout=30)
            self.send_json({'status': 'success', 'stdout': result.stdout[:MAX_OUTPUT], 'stderr': result.stderr[:MAX_OUTPUT], 'code': result.returncode})
        except subprocess.TimeoutExpired:
            self.send_json({'status': 'error', 'error': 'Command timeout (30s)'})
        except Exception as e:
            self.send_json({'status': 'error', 'error': str(e)})

    # File Manager APIs
    def list_files(self, data):
        path = data.get('path', '/sdcard')
        try:
            items = []
            for name in os.listdir(path):
                full = os.path.join(path, name)
                is_dir = os.path.isdir(full)
                size = 0
                if not is_dir:
                    try: size = os.path.getsize(full)
                    except: pass
                items.append({'name': name, 'path': full, 'dir': is_dir, 'size': size})
            items.sort(key=lambda x: (not x['dir'], x['name'].lower()))
            self.send_json({'status': 'success', 'files': items})
        except Exception as e:
            self.send_json({'status': 'error', 'error': str(e)})

    def read_file(self, data):
        path = data.get('path', '')
        try:
            with open(path, 'r', encoding='utf-8', errors='ignore') as f: content = f.read()
            self.send_json({'status': 'success', 'content': content})
        except Exception as e:
            self.send_json({'status': 'error', 'error': str(e)})

    def write_file(self, data):
        path, content = data.get('path', ''), data.get('content', '')
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, 'w', encoding='utf-8') as f: f.write(content)
            self.send_json({'status': 'success'})
        except Exception as e:
            self.send_json({'status': 'error', 'error': str(e)})

    def upload_file(self, data):
        path, b64content = data.get('path', ''), data.get('content', '')
        try:
            content = base64.b64decode(b64content)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, 'wb') as f: f.write(content)
            self.send_json({'status': 'success'})
        except Exception as e:
            self.send_json({'status': 'error', 'error': str(e)})

    def delete_file(self, data):
        path = data.get('path', '')
        try:
            if os.path.isdir(path): shutil.rmtree(path)
            else: os.remove(path)
            self.send_json({'status': 'success'})
        except Exception as e:
            self.send_json({'status': 'error', 'error': str(e)})

    def rename_file(self, data):
        old, new = data.get('oldPath', ''), data.get('newPath', '')
        try:
            os.rename(old, new)
            self.send_json({'status': 'success'})
        except Exception as e:
            self.send_json({'status': 'error', 'error': str(e)})

    def make_dir(self, data):
        path = data.get('path', '')
        try:
            os.makedirs(path, exist_ok=True)
            self.send_json({'status': 'success'})
        except Exception as e:
            self.send_json({'status': 'error', 'error': str(e)})

    def system_info(self):
        try:
            res = subprocess.run('uname -a', shell=True, capture_output=True, text=True)
            self.send_json({'status': 'success', 'system': res.stdout.strip()})
        except Exception as e:
            self.send_json({'status': 'error', 'error': str(e)})

    # Bug Fix: App View HTML Renderer
    def serve_app_view(self, app_name):
        html = f'''
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>{app_name}</title>
<style>
body{{background:#000;color:#0f0;font-family:monospace;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;flex-direction:column;}}
h1{{font-size:24px; margin-bottom:10px;}}
p{{color:#888; text-align:center; padding:0 20px;}}
</style>
</head>
<body>
<h1>🚀 {app_name}</h1>
<p>This application is currently running on your phone.</p>
<p><small style="color:#555;">Use 'close::{app_name}' command to close this app and this tab.</small></p>
</body>
</html>
'''
        html_bytes = html.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/html')
        self.send_header('Content-Length', str(len(html_bytes)))
        self.end_headers()
        self.wfile.write(html_bytes)

    # Main UI HTML
    def serve_html(self):
        html = '''
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Termux Remote</title>
<style>
body{background:#000;color:#0f0;font-family:monospace;padding:0;margin:0;height:100vh;display:flex;flex-direction:column;}
#top-bar{padding:10px;background:#111;display:flex;gap:10px;flex-wrap:wrap;}
.tab-btn{background:#222;color:#0f0;border:1px solid #0f0;padding:5px 10px;cursor:pointer;}
.tab-btn.active{background:#0f0;color:#000;font-weight:bold;}
#auth-container, #main-container{flex:1;display:flex;flex-direction:column;overflow:hidden;}
#terminal-tab, #files-tab{flex:1;display:none;flex-direction:column;overflow:hidden;}
#terminal-tab.active, #files-tab.active{display:flex;}
#output{flex:1;overflow:auto;padding:10px;white-space:pre-wrap;}
#bottom-bar{display:flex;padding:10px;gap:10px;background:#111;}
input, select{flex:1;background:#222;color:#0f0;border:1px solid #0f0;padding:8px;}
button{background:#0f0;color:#000;border:none;padding:8px 12px;font-weight:bold;cursor:pointer;}
.line{margin-bottom:5px;}.err{color:#f55;}.sys{color:#0ff;}
.file-item{padding:10px;border-bottom:1px solid #222;cursor:pointer;display:flex;justify-content:space-between;align-items:center;}
.file-item:hover{background:#333;}
.file-name{color:#0f0;flex:1;word-break:break-all;}
.file-actions{display:flex;gap:5px;align-items:center;}
.file-size{color:#888;font-size:0.8em;margin-right:8px;}
.opt-btn{background:#555;color:#fff;border:none;padding:4px 8px;cursor:pointer;font-size:14px;}
#path-bar{padding:10px;background:#111;border-bottom:1px solid #0f0;display:flex;align-items:center;gap:10px;}
#current-path{flex:1;color:#0f0;word-break:break-all;}
</style>
</head>
<body>
<div id="top-bar">
  <button class="tab-btn active" onclick="switchTab('terminal', this)">Terminal</button>
  <button class="tab-btn" onclick="switchTab('files', this)">Files</button>
</div>

<div id="auth-container" style="display:flex;">
  <div id="setup-screen" style="display:none;padding:20px;flex:1;overflow:auto;">
    <h2>First Time Setup</h2><p>Create admin account:</p>
    <input id="s-user" placeholder="Username"><br><br>
    <input id="s-pass" type="password" placeholder="Password"><br><br>
    <button onclick="createAccount()">Create Account</button>
  </div>
  <div id="login-screen" style="display:none;padding:20px;flex:1;overflow:auto;">
    <h2>Login</h2>
    <input id="l-user" placeholder="Username"><br><br>
    <input id="l-pass" type="password" placeholder="Password"><br><br>
    <button onclick="login()">Login</button>
  </div>
</div>

<div id="main-container" style="display:none;">
  <div id="terminal-tab" class="active">
    <div id="output"></div>
    <div id="bottom-bar">
      <input id="command" placeholder="Enter command" onkeydown="if(event.key==='Enter')run()">
      <button onclick="run()">Run</button>
    </div>
  </div>
  <div id="files-tab">
    <div id="path-bar">
      <span id="current-path">/sdcard</span>
      <button onclick="uploadFile()">Upload</button>
      <input type="file" id="file-input" style="display:none" onchange="handleUpload()">
      <button onclick="newFolder()">+Folder</button>
    </div>
    <div id="file-list" style="flex:1;overflow:auto;"></div>
  </div>
</div>

<script>
let TOKEN=''; let currentPath='/sdcard'; let appWindows={}; let screenWindow=null;
window.onload=()=>{ checkSetup(); };

async function checkSetup(){
  let r=await fetch('/api/check_setup'); let d=await r.json();
  if(d.exists){ document.getElementById('login-screen').style.display='block'; document.getElementById('setup-screen').style.display='none'; }
  else { document.getElementById('setup-screen').style.display='block'; document.getElementById('login-screen').style.display='none'; }
}

async function createAccount(){
  let u=document.getElementById('s-user').value, p=document.getElementById('s-pass').value;
  let r=await fetch('/api/create_account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});
  let d=await r.json();
  if(d.status==='success'){ TOKEN=d.token; showMain(); } else { alert(d.error); }
}

async function login(){
  let u=document.getElementById('l-user').value, p=document.getElementById('l-pass').value;
  let r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});
  let d=await r.json();
  if(d.status==='success'){ TOKEN=d.token; showMain(); } else { alert(d.error); }
}

function showMain(){
  document.getElementById('auth-container').style.display='none';
  document.getElementById('main-container').style.display='flex';
  add('Login success. Special commands: open::pkg, close::pkg, screen::on, screen::off','sys');
  listFiles(currentPath);
}

function switchTab(tab, btnElement){
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('#terminal-tab, #files-tab').forEach(t=>t.classList.remove('active'));
  btnElement.classList.add('active');
  document.getElementById(tab+'-tab').classList.add('active');
  if(tab==='files') listFiles(currentPath);
}

function add(text, cls=''){
  let div=document.createElement('div'); div.className='line '+cls; div.textContent=text;
  document.getElementById('output').appendChild(div); document.getElementById('output').scrollTop=999999;
}

async function run(){
  if(!TOKEN) return;
  let command=document.getElementById('command').value; document.getElementById('command').value='';
  add('$ '+command);
  let r=await fetch('/api/execute',{method:'POST',headers:{'Content-Type':'application/json','Authorization':TOKEN},body:JSON.stringify({command})});
  let d=await r.json();
  if(d.status==='success'){
    if(d.action==='download'){ window.open('/api/download?path='+encodeURIComponent(d.path), '_blank'); }
    if(d.action==='open_tab'){ 
        if(!appWindows[d.app] || appWindows[d.app].closed) {
            appWindows[d.app] = window.open('/app_view?name='+encodeURIComponent(d.app), 'app_window_'+d.app);
        } else { appWindows[d.app].focus(); }
    }
    if(d.action==='close_tab'){
        if(appWindows[d.app] && !appWindows[d.app].closed){ appWindows[d.app].close(); delete appWindows[d.app]; }
    }
    if(d.action==='open_url'){
        if(!screenWindow || screenWindow.closed){ screenWindow = window.open(d.url, 'screen_mirror_window'); }
        else { screenWindow.focus(); }
    }
    if(d.action==='close_url'){
        if(screenWindow && !screenWindow.closed){ screenWindow.close(); screenWindow=null; }
    }
    if(d.stdout) add(d.stdout); if(d.stderr) add(d.stderr,'err');
  } else { add(d.error,'err'); }
}

function b64EncodeUnicode(str) { return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function(match, p1) { return String.fromCharCode('0x' + p1); })); }
function b64DecodeUnicode(str) { return decodeURIComponent(Array.prototype.map.call(atob(str), function(c) { return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2); }).join('')); }

async function listFiles(path){
  currentPath=path; document.getElementById('current-path').textContent=path;
  let r=await fetch('/api/list',{method:'POST',headers:{'Content-Type':'application/json','Authorization':TOKEN},body:JSON.stringify({path})});
  let d=await r.json(); let html='';
  if(path!=='/'){ let parentPath = path.substring(0, path.lastIndexOf('/')) || '/'; html+=`<div class="file-item" data-path="${b64EncodeUnicode(parentPath)}" data-type="dir"><span class="file-name">📁 [..]</span></div>`; }
  if(d.status==='success'){
    d.files.forEach(f=>{
      let size=f.size>0?(f.size/1024/1024).toFixed(2)+' MB':''; let encPath = b64EncodeUnicode(f.path);
      if(f.dir){ html+=`<div class="file-item" data-path="${encPath}" data-type="dir"><span class="file-name">📁 ${f.name}</span></div>`; }
      else { html+=`<div class="file-item" data-path="${encPath}" data-type="file"><span class="file-name">📄 ${f.name}</span><div class="file-actions"><span class="file-size">${size}</span><button class="opt-btn" data-path="${encPath}">⚙</button></div></div>`; }
    });
  } else { html=`<div class="err" style="padding:10px;">${d.error}</div>`; }
  document.getElementById('file-list').innerHTML=html;
}

document.getElementById('file-list').addEventListener('click', function(e) {
  if (e.target.classList.contains('opt-btn')) { let path = b64DecodeUnicode(e.target.getAttribute('data-path')); fileOptions(path); return; }
  let item = e.target.closest('.file-item'); if (!item) return;
  let path = b64DecodeUnicode(item.getAttribute('data-path')); let type = item.getAttribute('data-type');
  if (type === 'dir') listFiles(path); else downloadFile(path);
});

async function downloadFile(path){ window.open('/api/download?path='+encodeURIComponent(path), '_blank'); }
function fileOptions(path){
  let action=prompt("Options for:\\n"+path+"\\n\\nType: delete, rename, edit"); if(!action) return; action=action.toLowerCase().trim();
  if(action==='delete'){ if(confirm('Are you sure?')){ fetch('/api/delete',{method:'POST',headers:{'Content-Type':'application/json','Authorization':TOKEN},body:JSON.stringify({path})}).then(()=>listFiles(currentPath)); } }
  else if(action==='rename'){ let n=prompt("New full path:", path); if(n && n!==path) fetch('/api/rename',{method:'POST',headers:{'Content-Type':'application/json','Authorization':TOKEN},body:JSON.stringify({oldPath:path,newPath:n})}).then(()=>listFiles(currentPath)); }
  else if(action==='edit'){ loadEditor(path); }
}
async function loadEditor(path){
  let r=await fetch('/api/read',{method:'POST',headers:{'Content-Type':'application/json','Authorization':TOKEN},body:JSON.stringify({path})});
  let d=await r.json(); let content=d.status==='success'?d.content:'';
  let newContent=prompt("Edit file content:", content);
  if(newContent!==null){ fetch('/api/write',{method:'POST',headers:{'Content-Type':'application/json','Authorization':TOKEN},body:JSON.stringify({path,content:newContent})}); }
}
function uploadFile(){ document.getElementById('file-input').click(); }
async function handleUpload(){
  let file=document.getElementById('file-input').files[0]; if(!file) return; let reader=new FileReader();
  reader.onload=async function(e){ let b64=e.target.result.split(',')[1]; await fetch('/api/upload',{method:'POST',headers:{'Content-Type':'application/json','Authorization':TOKEN},body:JSON.stringify({path:currentPath+'/'+file.name,content:b64})}); listFiles(currentPath); };
  reader.readAsDataURL(file); document.getElementById('file-input').value='';
}
function newFolder(){ let name=prompt("New folder name:"); if(!name) return; fetch('/api/mkdir',{method:'POST',headers:{'Content-Type':'application/json','Authorization':TOKEN},body:JSON.stringify({path:currentPath+'/'+name})}).then(()=>listFiles(currentPath)); }
</script>
</body>
</html>
'''
        html = html.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/html')
        self.send_header('Content-Length', str(len(html)))
        self.end_headers()
        self.wfile.write(html)

if __name__ == '__main__':
    wifi_ip = get_wifi_ip()
    print('\n================================')
    print('TERMUX REMOTE SERVER - ADVANCED')
    print('================================')
    print(f'Localhost:\\nhttp://127.0.0.1:{PORT}')
    print(f'\\nYour WiFi IP:\\nhttp://{wifi_ip}:{PORT}')
    print('\\nOpen this in Chrome browser')
    print('================================')
    server = ThreadedServer((HOST, PORT), Handler)
    try: server.serve_forever()
    except KeyboardInterrupt: print('\\nServer stopped'); sys.exit(0)
