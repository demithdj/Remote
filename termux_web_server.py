#!/usr/bin/env python3
"""
Termux Web Remote Control Server
Built-in Python only - No external dependencies needed!
Run: python3 termux_web_server.py
"""

import http.server
import socketserver
import json
import subprocess
import os
import sys
import urllib.parse
from pathlib import Path

HOST = '0.0.0.0'
PORT = 5000

class RequestHandler(http.server.SimpleHTTPRequestHandler):
    """Handle HTTP requests"""
    
    def do_GET(self):
        """Handle GET requests"""
        if self.path == '/':
            self.serve_html()
        elif self.path == '/api/info':
            self.api_info()
        else:
            self.send_404()
    
    def do_POST(self):
        """Handle POST requests"""
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8')
        
        try:
            data = json.loads(body)
        except:
            self.send_error_json('Invalid JSON')
            return
        
        if self.path == '/api/execute':
            self.api_execute(data)
        elif self.path == '/api/file/read':
            self.api_read(data)
        elif self.path == '/api/file/write':
            self.api_write(data)
        elif self.path == '/api/file/list':
            self.api_list(data)
        else:
            self.send_404()
    
    def serve_html(self):
        """Serve the HTML file"""
        html = self.get_html_content()
        self.send_response(200)
        self.send_header('Content-type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', len(html.encode()))
        self.send_header('Cache-Control', 'public, max-age=3600')
        self.end_headers()
        self.wfile.write(html.encode())
    
    def api_execute(self, data):
        """Execute shell command"""
        command = data.get('command', '')
        
        if not command:
            self.send_error_json('No command provided')
            return
        
        try:
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                timeout=30
            )
            
            response = {
                'status': 'success',
                'command': command,
                'output': result.stdout,
                'error': result.stderr,
                'returncode': result.returncode
            }
            self.send_json(response)
        except subprocess.TimeoutExpired:
            self.send_error_json('Command timeout')
        except Exception as e:
            self.send_error_json(str(e))
    
    def api_read(self, data):
        """Read file"""
        filepath = data.get('path', '')
        
        if not filepath:
            self.send_error_json('No path provided')
            return
        
        try:
            if not os.path.exists(filepath):
                self.send_error_json(f'File not found: {filepath}')
                return
            
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
            
            response = {
                'status': 'success',
                'path': filepath,
                'content': content
            }
            self.send_json(response)
        except Exception as e:
            self.send_error_json(str(e))
    
    def api_write(self, data):
        """Write file"""
        filepath = data.get('path', '')
        content = data.get('content', '')
        
        if not filepath:
            self.send_error_json('No path provided')
            return
        
        try:
            os.makedirs(os.path.dirname(filepath) or '.', exist_ok=True)
            
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            
            response = {
                'status': 'success',
                'path': filepath,
                'message': 'File saved'
            }
            self.send_json(response)
        except Exception as e:
            self.send_error_json(str(e))
    
    def api_list(self, data):
        """List files in directory"""
        dirpath = data.get('path', '/sdcard')
        
        try:
            if not os.path.isdir(dirpath):
                self.send_error_json(f'Directory not found: {dirpath}')
                return
            
            files = []
            for item in os.listdir(dirpath):
                filepath = os.path.join(dirpath, item)
                is_dir = os.path.isdir(filepath)
                try:
                    size = os.path.getsize(filepath) if not is_dir else 0
                except:
                    size = 0
                
                files.append({
                    'name': item,
                    'path': filepath,
                    'is_dir': is_dir,
                    'size': size
                })
            
            files.sort(key=lambda x: (not x['is_dir'], x['name']))
            
            response = {
                'status': 'success',
                'path': dirpath,
                'files': files
            }
            self.send_json(response)
        except Exception as e:
            self.send_error_json(str(e))
    
    def api_info(self):
        """Get system info"""
        try:
            result = subprocess.run('uname -a', shell=True, capture_output=True, text=True)
            pwd = subprocess.run('pwd', shell=True, capture_output=True, text=True)
            home = os.path.expanduser('~')
            
            response = {
                'status': 'success',
                'system': result.stdout.strip(),
                'home': home,
                'current_dir': pwd.stdout.strip(),
                'python_version': sys.version
            }
            self.send_json(response)
        except Exception as e:
            self.send_error_json(str(e))
    
    def send_json(self, data):
        """Send JSON response"""
        response = json.dumps(data).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Content-Length', len(response))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(response)
    
    def send_error_json(self, message):
        """Send error JSON response"""
        response = json.dumps({
            'status': 'error',
            'error': message
        }).encode('utf-8')
        self.send_response(400)
        self.send_header('Content-type', 'application/json')
        self.send_header('Content-Length', len(response))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(response)
    
    def send_404(self):
        """Send 404 error"""
        self.send_response(404)
        self.send_header('Content-type', 'text/html')
        self.end_headers()
        self.wfile.write(b'404 Not Found')
    
    def get_html_content(self):
        """Return HTML content"""
        return '''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Termux - Terminal Emulator</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        @import url('https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500;700&display=swap');

        body {
            font-family: 'Roboto Mono', monospace;
            background: #000;
            color: #fff;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }

        .header {
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            padding: 12px 16px;
            border-bottom: 1px solid #0f3460;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
        }

        .header-left {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .app-icon {
            font-size: 1.5em;
        }

        .app-name {
            font-weight: 700;
            font-size: 1.1em;
            color: #00ff00;
            text-shadow: 0 0 10px rgba(0, 255, 0, 0.3);
        }

        .main {
            flex: 1;
            display: flex;
            flex-direction: column;
            background: #000;
            overflow: hidden;
        }

        .terminal-content {
            flex: 1;
            overflow-y: auto;
            padding: 12px 16px;
            font-size: 0.95em;
            line-height: 1.6;
            color: #00ff00;
        }

        .terminal-line {
            margin-bottom: 8px;
            white-space: pre-wrap;
            word-wrap: break-word;
        }

        .terminal-prompt {
            color: #00ffff;
            font-weight: 500;
            margin-right: 8px;
        }

        .terminal-command {
            color: #00ff00;
        }

        .terminal-output {
            color: #aaa;
        }

        .input-area {
            background: #0a0a0a;
            border-top: 1px solid #0f3460;
            padding: 12px 16px;
            display: flex;
            gap: 8px;
            align-items: center;
        }

        .prompt {
            color: #00ffff;
            font-weight: 500;
            flex-shrink: 0;
        }

        .input-wrapper {
            flex: 1;
            display: flex;
            align-items: center;
            background: #1a1a2e;
            border: 1px solid #0f3460;
            border-radius: 4px;
            padding: 8px 12px;
        }

        .input-wrapper:focus-within {
            border-color: #00ff00;
            box-shadow: 0 0 10px rgba(0, 255, 0, 0.2);
        }

        .input-wrapper input {
            flex: 1;
            background: transparent;
            border: none;
            color: #00ff00;
            font-family: 'Roboto Mono', monospace;
            font-size: 0.95em;
            outline: none;
            caret-color: #00ff00;
        }

        .send-btn {
            background: linear-gradient(135deg, #00ff00 0%, #00aa00 100%);
            border: none;
            color: #000;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.2s ease;
            flex-shrink: 0;
        }

        .send-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 255, 0, 0.3);
        }

        .status-bar {
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            padding: 8px 16px;
            border-top: 1px solid #0f3460;
            display: flex;
            justify-content: space-between;
            font-size: 0.85em;
            color: #888;
        }

        .spinner {
            display: inline-block;
            width: 12px;
            height: 12px;
            border: 2px solid rgba(0, 255, 0, 0.3);
            border-top-color: #00ff00;
            border-radius: 50%;
            animation: spin 0.6s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        ::-webkit-scrollbar {
            width: 10px;
        }

        ::-webkit-scrollbar-track {
            background: #0a0a0a;
        }

        ::-webkit-scrollbar-thumb {
            background: #0f3460;
            border-radius: 5px;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-left">
            <span class="app-icon">█</span>
            <span class="app-name">TERMUX</span>
        </div>
    </div>

    <div class="main">
        <div class="terminal-content" id="output">
            <div class="terminal-line">
                <span style="color: #ffaa00;">Welcome to Termux Remote Terminal</span>
            </div>
            <div class="terminal-line">
                <span style="color: #ffaa00;">Type 'help' for available commands</span>
            </div>
        </div>

        <div class="input-area">
            <span class="prompt">root@termux:~#</span>
            <div class="input-wrapper">
                <input 
                    type="text" 
                    id="input" 
                    placeholder="Type command..."
                    onkeydown="handleKeyDown(event)"
                    autocomplete="off"
                />
            </div>
            <button class="send-btn" onclick="executeCommand()">Send</button>
        </div>
    </div>

    <div class="status-bar">
        <div>Connected | ~</div>
        <div id="time">00:00</div>
    </div>

    <script>
        const API_BASE = location.protocol + '//' + location.host + '/api';
        let history = [];
        let historyIndex = 0;

        window.addEventListener('load', () => {
            updateTime();
            setInterval(updateTime, 1000);
            document.getElementById('input').focus();
        });

        function updateTime() {
            const now = new Date();
            document.getElementById('time').textContent = now.toLocaleTimeString('en-US', { hour12: false }).slice(0, 5);
        }

        function handleKeyDown(event) {
            if (event.key === 'Enter') {
                event.preventDefault();
                executeCommand();
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                if (historyIndex < history.length) {
                    historyIndex++;
                    document.getElementById('input').value = history[history.length - historyIndex];
                }
            } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                if (historyIndex > 0) {
                    historyIndex--;
                    if (historyIndex === 0) {
                        document.getElementById('input').value = '';
                    } else {
                        document.getElementById('input').value = history[history.length - historyIndex];
                    }
                }
            }
        }

        async function executeCommand() {
            const input = document.getElementById('input');
            const command = input.value.trim();
            const output = document.getElementById('output');

            if (!command) return;

            if (command === 'clear') {
                output.innerHTML = '';
                input.value = '';
                historyIndex = 0;
                return;
            }

            if (command === 'help') {
                addOutput('', 'Available commands: ls, cd, pwd, mkdir, cat, echo, rm, cp, mv, find, grep, ps, df, du, free, whoami, date, python, pip, git, curl, tar, zip, chmod, chown, clear, help, history');
                input.value = '';
                historyIndex = 0;
                history.push(command);
                return;
            }

            addOutput('root@termux:~#', command, 'terminal-command');
            input.value = '';
            historyIndex = 0;
            history.push(command);

            const loadingId = 'loading-' + Date.now();
            addOutput('', '<span class="spinner"></span> Executing...', '', loadingId);

            try {
                const response = await fetch(API_BASE + '/execute', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ command })
                });

                const data = await response.json();
                const loadingEl = document.getElementById(loadingId);
                if (loadingEl) loadingEl.remove();

                if (data.status === 'success') {
                    if (data.output) {
                        addOutput('', data.output, 'terminal-output');
                    }
                    if (data.error) {
                        addOutput('', data.error, 'terminal-output');
                    }
                } else {
                    addOutput('', 'Error: ' + data.error, 'terminal-output');
                }
            } catch (err) {
                const loadingEl = document.getElementById(loadingId);
                if (loadingEl) loadingEl.remove();
                addOutput('', 'Network error: ' + err.message, 'terminal-output');
            }
        }

        function addOutput(prompt, text, className = '', id = '') {
            const output = document.getElementById('output');
            const line = document.createElement('div');
            line.className = 'terminal-line';
            if (id) line.id = id;

            if (prompt) {
                const promptSpan = document.createElement('span');
                promptSpan.className = 'terminal-prompt';
                promptSpan.textContent = prompt + ' ';
                line.appendChild(promptSpan);
            }

            const textSpan = document.createElement('span');
            textSpan.className = className;
            textSpan.innerHTML = text;
            line.appendChild(textSpan);

            output.appendChild(line);
            output.scrollTop = output.scrollHeight;
        }
    </script>
</body>
</html>'''

if __name__ == '__main__':
    print("=" * 60)
    print("🚀 Termux Web Remote Control Server")
    print("=" * 60)
    print()
    print("✅ Setup complete!")
    print()
    print("📱 Open in Chrome:")
    print("   http://YOUR_DEVICE_IP:5000")
    print()
    print("🔧 To find your IP, run:")
    print("   ifconfig | grep 'inet '")
    print()
    print("⚠️  WARNING: This server is not encrypted.")
    print("   Use only on trusted networks!")
    print()
    print("=" * 60)
    print()
    
    Handler = RequestHandler
    with socketserver.TCPServer((HOST, PORT), Handler) as httpd:
        print(f"✅ Server running on {HOST}:{PORT}")
        print("Press Ctrl+C to stop")
        print()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n❌ Server stopped")
            sys.exit(0)
