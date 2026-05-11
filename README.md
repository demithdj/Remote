# 🔧 Termux Web Remote Control for Chrome

A powerful web-based remote control interface for Termux that runs directly in Google Chrome. Execute commands, manage files, and control your Termux device from any browser.

## ✨ Features

- 🌐 **Web Interface** - Control Termux directly from Chrome browser
- ⚙️ **Shell Commands** - Execute any terminal command remotely
- 📁 **File Manager** - Browse, read, and write files
- ⚡ **Quick Commands** - Pre-configured commands for quick access
- 📊 **System Info** - View system information
- 🎨 **Beautiful UI** - Modern, responsive design
- 📱 **Mobile Friendly** - Works on tablets and phones

## 🚀 Quick Start

### Step 1: Install Dependencies

```bash
cd /sdcard/Download  # Or any directory you prefer
git clone https://github.com/demithdj/Remote-.git
cd Remote-
bash setup.sh
```

Or install manually:

```bash
pkg install python
pip install flask flask-cors
```

### Step 2: Start the Server

```bash
python3 termux_web_server.py
```

You should see:
```
🚀 Termux Web Remote Control Server
📱 Open in Chrome: http://YOUR_DEVICE_IP:5000
```

### Step 3: Find Your Device IP

```bash
ifconfig | grep 'inet '
```

Or:

```bash
ip addr show
```

Look for something like: `192.168.x.x` or `10.0.x.x`

### Step 4: Open in Chrome

1. Open Google Chrome on another device
2. Go to: `http://YOUR_DEVICE_IP:5000`
3. Start controlling!

## 💻 Interface Sections

### ⚙️ Shell Commands
- Execute any terminal command
- See output and errors
- Perfect for: `ls`, `pwd`, `rm`, `mkdir`, etc.

### 📁 File Manager
- Browse directories
- Click to navigate
- View file sizes
- Supports: `/sdcard`, `/data`, `/cache`, etc.

### 📖 Read File
- View file contents
- Click files in File Manager to auto-populate path
- Supports text and code files

### ✏️ Write File
- Create new files
- Edit existing files
- Perfect for configs and scripts

### ⚡ Quick Commands
One-click execution:
- `ls -la` - List files
- `pwd` - Current directory
- `df -h` - Disk usage
- `free -h` - Memory info
- `whoami` - Current user

### ℹ️ System Information
- View OS details
- Check Python version
- See home directory

## 📋 Usage Examples

### Execute Python Script
```
Command: python3 /sdcard/script.py
```

### Install Package
```
Command: pip install requests
```

### Check Device Storage
```
Command: df -h
```

### View File Contents
```
Path: /sdcard/config.txt
→ Read File
```

### Create New Script
```
Path: /sdcard/myscript.sh
Content: #!/bin/bash
echo "Hello from Termux!"
→ Write File
```

## 🔒 Security Considerations

⚠️ **IMPORTANT**: This server is **not encrypted** and should only be used on:
- Local/home networks
- Trusted devices
- Private networks

**DO NOT** use on public WiFi or untrusted networks.

### For Production Use:

Add HTTPS support by installing Flask-TLS:

```bash
pip install pyopenssl
```

Then modify `termux_web_server.py` to use SSL certificates.

## 🛠️ Advanced Configuration

### Change Port

Edit `termux_web_server.py`:

```python
PORT = 8080  # Change to your preferred port
```

### Run on Startup

Create a script in `/data/data/com.termux/files/home/.bashrc`:

```bash
# Start web server
python3 ~/remote_control/termux_web_server.py &
```

### Run as Service (Advanced)

Use `termux-services` for background execution.

## 📱 Using on Mobile

1. On your Termux device: `python3 termux_web_server.py`
2. On your Android phone's Chrome: `http://DEVICE_IP:5000`
3. You can now control Termux from your phone!

## 🐛 Troubleshooting

### "Connection refused"
- Ensure server is running
- Check IP address is correct
- Both devices must be on same network

### "Port already in use"
- Change PORT in `termux_web_server.py`
- Or kill existing process: `pkill -f termux_web_server`

### "Command timeout"
- Long-running commands may timeout after 30 seconds
- Modify timeout in `termux_web_server.py`:

```python
timeout=60  # Increase to 60 seconds
```

### Server won't start
- Check Python is installed: `python3 --version`
- Check Flask: `pip install flask flask-cors`
- Check for error messages in terminal

## 📁 File Structure

```
Remote-/
├── termux_web_server.py    # Main Flask server
├── index.html              # Web interface
├── setup.sh               # Setup script
└── README.md              # This file
```

## 🎯 Use Cases

- 🤖 Remote automation
- 📊 Server management
- ��� Development & debugging
- 📁 File operations
- 🧪 Testing scripts
- 📝 Editing configs
- 🚀 Running services

## 🔗 Related Resources

- [Termux Documentation](https://wiki.termux.com/)
- [Flask Documentation](https://flask.palletsprojects.com/)
- [Python Subprocess](https://docs.python.org/3/library/subprocess.html)

## 📄 License

Free to use and modify.

## 🤝 Contributing

Feel free to fork and improve!

---

**Made with ❤️ for Termux users**
