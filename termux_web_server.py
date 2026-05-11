#!/usr/bin/env python3
"""
Termux Web Remote Control Server
Run this on your Termux device to enable web-based remote control
"""

import flask
from flask_cors import CORS
import subprocess
import json
import os
import sys

app = flask.Flask(__name__)
CORS(app)

# Configuration
HOST = '0.0.0.0'
PORT = 5000

@app.route('/')
def index():
    """Serve the web interface"""
    return flask.send_file('index.html')

@app.route('/api/execute', methods=['POST'])
def execute_command():
    """Execute shell command on Termux"""
    try:
        data = flask.request.json
        command = data.get('command', '')
        
        if not command:
            return flask.jsonify({'error': 'No command provided'}), 400
        
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=30
        )
        
        return flask.jsonify({
            'status': 'success',
            'command': command,
            'output': result.stdout,
            'error': result.stderr,
            'returncode': result.returncode
        })
    except subprocess.TimeoutExpired:
        return flask.jsonify({
            'status': 'error',
            'error': 'Command timed out after 30 seconds'
        }), 408
    except Exception as e:
        return flask.jsonify({
            'status': 'error',
            'error': str(e)
        }), 500

@app.route('/api/file/read', methods=['POST'])
def read_file():
    """Read file contents"""
    try:
        data = flask.request.json
        filepath = data.get('path', '')
        
        if not filepath:
            return flask.jsonify({'error': 'No file path provided'}), 400
        
        if not os.path.exists(filepath):
            return flask.jsonify({'error': f'File not found: {filepath}'}), 404
        
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        
        return flask.jsonify({
            'status': 'success',
            'path': filepath,
            'content': content
        })
    except Exception as e:
        return flask.jsonify({
            'status': 'error',
            'error': str(e)
        }), 500

@app.route('/api/file/write', methods=['POST'])
def write_file():
    """Write content to file"""
    try:
        data = flask.request.json
        filepath = data.get('path', '')
        content = data.get('content', '')
        
        if not filepath:
            return flask.jsonify({'error': 'No file path provided'}), 400
        
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        
        return flask.jsonify({
            'status': 'success',
            'path': filepath,
            'message': 'File written successfully'
        })
    except Exception as e:
        return flask.jsonify({
            'status': 'error',
            'error': str(e)
        }), 500

@app.route('/api/file/list', methods=['POST'])
def list_files():
    """List files in directory"""
    try:
        data = flask.request.json
        dirpath = data.get('path', '/sdcard')
        
        if not os.path.isdir(dirpath):
            return flask.jsonify({'error': f'Directory not found: {dirpath}'}), 404
        
        files = []
        for item in os.listdir(dirpath):
            filepath = os.path.join(dirpath, item)
            is_dir = os.path.isdir(filepath)
            files.append({
                'name': item,
                'path': filepath,
                'is_dir': is_dir,
                'size': os.path.getsize(filepath) if os.path.isfile(filepath) else 0
            })
        
        return flask.jsonify({
            'status': 'success',
            'path': dirpath,
            'files': sorted(files, key=lambda x: (not x['is_dir'], x['name']))
        })
    except Exception as e:
        return flask.jsonify({
            'status': 'error',
            'error': str(e)
        }), 500

@app.route('/api/info', methods=['GET'])
def get_info():
    """Get system information"""
    try:
        result = subprocess.run('uname -a', shell=True, capture_output=True, text=True)
        pwd = subprocess.run('pwd', shell=True, capture_output=True, text=True)
        home = os.path.expanduser('~')
        
        return flask.jsonify({
            'status': 'success',
            'system': result.stdout.strip(),
            'home': home,
            'current_dir': pwd.stdout.strip(),
            'python_version': sys.version
        })
    except Exception as e:
        return flask.jsonify({
            'status': 'error',
            'error': str(e)
        }), 500

if __name__ == '__main__':
    print(f"🚀 Termux Web Remote Control Server")
    print(f"📱 Open in Chrome: http://YOUR_DEVICE_IP:{PORT}")
    print(f"🔧 To find your IP, run: ifconfig or ip addr show")
    print(f"⚠️  WARNING: This server is not encrypted. Use only on trusted networks!")
    print()
    app.run(host=HOST, port=PORT, debug=True)
