#!/usr/bin/env python3
"""
Termux Web Remote Control Server - Optimized Version
Built-in Python only - No external dependencies needed!
Run: python3 termux_web_server.py
"""

import http.server
import socketserver
import json
import subprocess
import os
import sys
import threading
from http import HTTPStatus

HOST = '0.0.0.0'
PORT = '8080'

# Cache for static HTML
CACHED_HTML = None

class OptimizedRequestHandler(http.server.BaseHTTPRequestHandler):
    """Optimized HTTP request handler"""
    
    def log_message(self, format, *args):
        """Suppress logging for cleaner output"""
        pass
    
    def do_GET(self):
        """Handle GET requests"""
        path = self.path.split('?')[0]  # Remove query string
        
        if path == '/':
            self.serve_html()
        elif path == '/api/info':
            self.api_info()
        else:
            self.send_response(404)
            self.end_headers()
    
    def do_POST(self):
        """Handle POST requests"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length > 1000000:  # 1MB limit
                self.send_error_json('Payload too large')
                return
            
            body = self.rfile.read(content_length).decode('utf-8')
            data = json.loads(body)
        except:
            self.send_error_json('Invalid request')
            return
        
        path = self.path.split('?')[0]
        
        if path == '/api/execute':
            self.api_execute(data)
        elif path == '/api/file/read':
            self.api_read(data)
        elif path == '/api/file/write':
            self.api_write(data)
        elif path == '/api/file/list':
            self.api_list(data)
        else:
            self.send_response(404)
            self.end_headers()
    
    def serve_html(self):
        """Serve cached HTML file"""
        global CACHED_HTML
        if CACHED_HTML is None:
            CACHED_HTML = self.get_html_content()
        
        html = CACHED_HTML.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', len(html))
        self.send_header('Cache-Control', 'max-age=86400')
        self.send_header('Connection', 'keep-alive')
        self.end_headers()
        self.wfile.write(html)
    
    def api_execute(self, data):
        """Execute shell command"""
        command = data.get('command', '')
        
        if not command or len(command) > 1000:
            self.send_error_json('Invalid command')
            return
        
        try:
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                timeout=10
            )
            
            response = {
                'status': 'success',
                'output': result.stdout[:50000],  # Limit output
                'error': result.stderr[:10000]
            }
            self.send_json(response)
        except subprocess.TimeoutExpired:
            self.send_error_json('Command timeout')
        except Exception as e:
            self.send_error_json('Command error')
    
    def api_read(self, data):
        """Read file"""
        filepath = data.get('path', '')
        
        if not filepath or len(filepath) > 500:
            self.send_error_json('Invalid path')
            return
        
        try:
            if not os.path.exists(filepath):
                self.send_error_json('File not found')
                return
            
            if os.path.getsize(filepath) > 1000000:  # 1MB limit
                self.send_error_json('File too large')
                return
            
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
            
            response = {
                'status': 'success',
                'content': content
            }
            self.send_json(response)
        except Exception:
            self.send_error_json('Read error')
    
    def api_write(self, data):
        """Write file"""
        filepath = data.get('path', '')
        content = data.get('content', '')
        
        if not filepath or len(filepath) > 500:
            self.send_error_json('Invalid path')
            return
        
        try:
            dirname = os.path.dirname(filepath)
            if dirname:
                os.makedirs(dirname, exist_ok=True)
            
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            
            self.send_json({'status': 'success'})
        except Exception:
            self.send_error_json('Write error')
    
    def api_list(self, data):
        """List files in directory"""
        dirpath = data.get('path', '/sdcard')
        
        if not dirpath or len(dirpath) > 500:
            self.send_error_json('Invalid path')
            return
        
        try:
            if not os.path.isdir(dirpath):
                self.send_error_json('Directory not found')
                return
            
            files = []
            items = os.listdir(dirpath)[:200]  # Limit to 200 items
            
            for item in items:
                filepath = os.path.join(dirpath, item)
                is_dir = os.path.isdir(filepath)
                files.append({
                    'name': item,
                    'path': filepath,
                    'is_dir': is_dir
                })
            
            files.sort(key=lambda x: (not x['is_dir'], x['name']))
            
            response = {
                'status': 'success',
                'files': files
            }
            self.send_json(response)
        except Exception:
            self.send_error_json('List error')
    
    def api_info(self):
        """Get system info"""
        try:
            result = subprocess.run('uname -a', shell=True, capture_output=True, text=True, timeout=5)
            
            response = {
                'status': 'success',
                'system': result.stdout.strip()
            }
            self.send_json(response)
        except Exception:
            self.send_error_json('Info error')
    
    def send_json(self, data):
        """Send JSON response"""
        response = json.dumps(data, separators=(',', ':')).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Content-Length', len(response))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Connection', 'keep-alive')
        self.end_headers()
        self.wfile.write(response)
    
    def send_error_json(self, message):
        """Send error JSON response"""
        response = json.dumps({'status': 'error', 'error': message}, separators=(',', ':')).encode('utf-8')
        self.send_response(400)
        self.send_header('Content-type', 'application/json')
        self.send_header('Content-Length', len(response))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Connection', 'keep-alive')
        self.end_headers()
        self.wfile.write(response)
    
    def get_html_content(self):
        """Return minimal HTML - removed unnecessary features"""
        return '''<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Termux</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:monospace;background:#000;color:#0f0;min-height:100vh;display:flex;flex-direction:column;overflow:hidden}
.h{background:#1a1a2e;padding:8px 16px;border-bottom:1px solid #0f3460;display:flex;gap:12px}
.h span{color:#0f0;font-weight:bold}
.m{flex:1;overflow-y:auto;padding:12px;font-size:14px;line-height:1.4}
.l{margin:6px 0;white-space:pre-wrap;word-wrap:break-word}
.p{color:#0ff}
.c{color:#0f0}
.o{color:#999}
.e{color:#f44}
.i{background:#0a0a0a;border-top:1px solid #0f3460;padding:8px 16px;display:flex;gap:8px}
.i span{color:#0ff;flex-shrink:0}
.iw{flex:1;background:#1a1a2e;border:1px solid #0f3460;border-radius:3px;padding:6px 10px;display:flex}
.iw input{flex:1;background:transparent;border:none;color:#0f0;font-family:monospace;outline:none;caret-color:#0f0}
.sb{background:linear-gradient(135deg,#1a1a2e,#16213e);padding:6px 16px;border-top:1px solid #0f3460;font-size:12px;color:#888;display:flex;justify-content:space-between}
button{background:#0a0;border:none;color:#000;padding:6px 12px;border-radius:3px;cursor:pointer;font-weight:bold;font-family:monospace}
button:hover{background:#0f0}
::-webkit-scrollbar{width:8px}
::-webkit-scrollbar-track{background:#0a0a0a}
::-webkit-scrollbar-thumb{background:#0f3460}
</style>
</head>
<body>
<div class="h"><span>█ TERMUX</span></div>
<div class="m" id="o"></div>
<div class="i">
<span>root@termux:~#</span>
<div class="iw"><input type="text" id="i" placeholder="command..." autocomplete="off" onkeydown="k(event)"></div>
<button onclick="e()">Send</button>
</div>
<div class="sb"><div>Connected</div><div id="t">00:00</div></div>
<script>
const API='/api';
let h=[];
let x=0;
setInterval(()=>{let d=new Date();document.getElementById('t').textContent=d.toLocaleTimeString('en-US',{hour12:false}).slice(0,5)},1000);
function k(e){if(e.key==='Enter'){e.preventDefault();E()}else if(e.key==='ArrowUp'){e.preventDefault();if(x<h.length){x++;document.getElementById('i').value=h[h.length-x]}}else if(e.key==='ArrowDown'){e.preventDefault();if(x>0){x--;document.getElementById('i').value=x===0?'':h[h.length-x]}}}
function E(){let c=document.getElementById('i').value.trim();if(!c)return;if(c==='clear'){document.getElementById('o').innerHTML='';document.getElementById('i').value='';x=0;return}
a('root@termux:~# ',c,'c');document.getElementById('i').value='';x=0;h.push(c);fetch(API+'/execute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:c})}).then(r=>r.json()).then(d=>{if(d.status==='success'){if(d.output)a('',d.output,'o');if(d.error)a('',d.error,'e')}else a('','Error: '+d.error,'e')}).catch(r=>a('','Network error','e'))}
function a(p,t,c=''){let o=document.getElementById('o');let l=document.createElement('div');l.className='l';if(p){let ps=document.createElement('span');ps.className='p';ps.textContent=p+' ';l.appendChild(ps)}let ts=document.createElement('span');ts.className=c;ts.textContent=t;l.appendChild(ts);o.appendChild(l);o.scrollTop=o.scrollHeight}
document.getElementById('i').focus();
a('','Welcome to Termux Remote Terminal','i');
a('','Type your command above...','i');
</script>
</body>
</html>'''

if __name__ == '__main__':
    print("\n" + "="*50)
    print("🚀 Termux Web Remote - Optimized")
    print("="*50)
    print("\n📱 Open in Chrome:")
    print("   http://YOUR_DEVICE_IP:5000")
    print("\n🔧 Find your IP:")
    print("   ifconfig | grep 'inet'")
    print("\n" + "="*50 + "\n")
    
    Handler = OptimizedRequestHandler
    httpd = socketserver.TCPServer((HOST, PORT), Handler)
    httpd.allow_reuse_address = True
    
    print(f"✅ Server running on {HOST}:{PORT}")
    print("Press Ctrl+C to stop\n")
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n❌ Server stopped")
        sys.exit(0)
