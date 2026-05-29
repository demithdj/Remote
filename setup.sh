#!/bin/bash

# Termux Web Remote Control Setup Script
echo "🚀 Termux Web Remote Control Setup"
echo "==================================="
echo ""

# Update packages
echo "📦 Updating packages..."
pkg update -y

# Install Python
echo "🐍 Installing Python..."
pkg install python -y

# Install required Python packages
echo "📚 Installing python server..."
pkg install nodejs -y && pkg install nodejs-lts 

echo ""
echo "✅ Setup complete!"
echo ""
echo "📱 To run the server:"
echo "   python3 termux_web_server.py"
echo ""
echo "🌐 To find your IP address:"
echo "   ifconfig | grep 'inet '"
echo ""
echo "💻 Then open in Chrome:"
echo "   http://YOUR_IP:5000"
echo ""
echo "⚠️  WARNING: This server is not encrypted."
echo "   Use only on trusted networks!"
echo ""
