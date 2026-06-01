# !/bin/bash

# Termux Web Remote Control Setup Script
echo "🚀 Termux Web Remote Control Setup"
echo "==================================="
echo ""

# Update packages
echo "📦 Updating packages..."
pkg update -y && pkg upgrade -y

# Install required Python packages
echo "📚 Installing python server system..."
pkg install nodejs -y && pkg install nodejs-lts -y && pkg install android-tools -y 
# Setup the server
echo " ⚙️⚙️ Setup the server system..."
npm init -y && npm install

echo ""
echo "✅ Setup complete!"
echo ""
echo "   adb connect localhost:5555"
echo ""
echo "📱 To run the server"
echo "   node Termux_Remote_Server.js"
echo ""
echo "💻 Then open in Chrome (The ip address will be show in running server)"
echo "   http://YOUR_IP:5000"
echo ""
echo "⚠️  WARNING: This server is not encrypted."
echo "   Use only on trusted networks!"
echo ""
