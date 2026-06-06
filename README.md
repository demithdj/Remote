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
git clone https://github.com/demithdj/Remote.git
cd Remote
bash setup.sh
```

Or install manually:

```bash
pkg install nodejs
npm install express ws compression
```

### Step 2: Start the Server

```bash
node Termux_Remote_Server.js
```

You should see:
```
=================================
TERMUX REMOTE SERVER - PRO VERSION
=================================
Local Network IP (Mobile/WiFi):
http://YOUR_DEVICE_IP:8080
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
2. Go to: `http://YOUR_DEVICE_IP:8080`
3. Create an account and start controlling!

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

### 🔌 Special Commands
One-click execution:
- `download::PATH` - Download a file
- `screen::on` - Open screen stream
- `screen::off` - Close screen stream
- `battery` - Battery status
- `storage` - Storage info
- `ps` - List processes
- `myip` - Check public IP

### ℹ️ System Information
- View OS details
- Check Node.js version
- See device information

## 📋 Usage Examples

### Execute Shell Command
```
Command: ls -la /sdcard
```

### Check Device Storage
```
Command: storage
```

### View Battery Status
```
Command: battery
```

### Create New Script
```
Path: /sdcard/myscript.sh
Content: #!/bin/bash
echo "Hello from Termux!"
→ Write File
```

### Download a File
```
Command: download::/sdcard/myfile.txt
```

## 🔒 Security Considerations

⚠️ **IMPORTANT**: This server is **not encrypted** and should only be used on:
- Local/home networks
- Trusted devices
- Private networks

**DO NOT** use on public WiFi or untrusted networks.

### For Production Use:

Add HTTPS support by installing SSL certificates and modifying the server code to use `https` instead of `http`.

## 🛠️ Advanced Configuration

### Change Port

Edit `Termux_Remote_Server.js`:

```javascript
const PORT = 8080;  // Change to your preferred port
```

### Run on Startup

Add to `/data/data/com.termux/files/home/.bashrc`:

```bash
# Start web server
node ~/remote_control/Termux_Remote_Server.js &
```

### Run as Service (Advanced)

Use `termux-services` for background execution.

## 📱 Using on Mobile

1. On your Termux device: `node Termux_Remote_Server.js`
2. On your Android phone's Chrome: `http://DEVICE_IP:8080`
3. You can now control Termux from your phone!

## 🐛 Troubleshooting

### "Connection refused"
- Ensure server is running
- Check IP address is correct
- Both devices must be on same network

### "Port already in use"
- Change PORT in `Termux_Remote_Server.js`
- Or kill existing process: `pkill -f Termux_Remote_Server`

### "Cannot GET /"
- Make sure you're using port 8080: `http://YOUR_IP:8080`
- Check server is still running

### Server won't start
- Check Node.js is installed: `node --version`
- Check npm packages: `npm install express ws compression`
- Check for error messages in terminal

## 📁 File Structure

```
Remote/
├── Termux_Remote_Server.js    # Main Express server
├── setup.sh                   # Setup script
└── README.md                  # This file
```

## 🎯 Use Cases

- 🤖 Remote automation
- 📊 Server management
- 🔧 Development & debugging
- 📁 File operations
- 🧪 Testing scripts
- 📝 Editing configs
- 🚀 Running services

## 🔗 Related Resources

- [Termux Documentation](https://wiki.termux.com/)
- [Express.js Documentation](https://expressjs.com/)
- [Node.js Child Process](https://nodejs.org/api/child_process.html)

## 📄 License

Free to use and modify.

## 🤝 Contributing

Feel free to fork and improve!

---

**Made with ❤️ for Termux users**
