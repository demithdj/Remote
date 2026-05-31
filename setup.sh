# !/bin/bash

# Termux Web Remote Control Setup Script
echo "🚀 Termux Web Remote Control Setup"
echo "==================================="
echo ""

# Update packages
echo "📦 Updating packages..."
pkg update -y && pkg upgrade -y

# Install Python
echo "🐍 Installing Python..."
pkg install python -y

# Install required Python packages
echo "📚 Installing python server system..."
pkg install nodejs -y && pkg install nodejs-lts -y && pkg install android-tools -y 
# Setup the server
echo " ⚙️⚙️ Setup the server system..."
git clone https://github.com/NetrisTV/ws-scrcpy.git && cd ws-scrcpy && npm install && cd ~/Remote

echo ""
echo "✅ Setup complete!"
echo ""
echo "⚙️ To connect ADB"
echo "   adb start-server"
echo "   adb connect localhost:5555"
echo ""
echo "📱 To run the server"
echo "   python Termux_Remote_Server.py"
echo ""
echo "💻 Then open in Chrome (The ip address will be show in running server)"
echo "   http://YOUR_IP:5000"
echo ""
echo "⚠️  WARNING: This server is not encrypted."
echo "   Use only on trusted networks!"
echo ""
