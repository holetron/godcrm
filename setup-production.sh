#!/bin/bash

set -e

echo "🚀 Setting up Business CRM on crm.hltrn.cc"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}❌ Please run as root${NC}"
    exit 1
fi

# Build frontend
echo -e "${YELLOW}📦 Building frontend...${NC}"
cd /root/business-crm
npm run build

if [ ! -d "dist" ]; then
    echo -e "${RED}❌ Build failed - dist directory not found${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Frontend built successfully${NC}"
echo ""

# Setup Nginx
echo -e "${YELLOW}🔧 Setting up Nginx...${NC}"

# Copy nginx config
cp nginx-crm.conf /etc/nginx/sites-available/crm.hltrn.cc

# Create symlink
if [ -L "/etc/nginx/sites-enabled/crm.hltrn.cc" ]; then
    rm /etc/nginx/sites-enabled/crm.hltrn.cc
fi
ln -s /etc/nginx/sites-available/crm.hltrn.cc /etc/nginx/sites-enabled/

# Test nginx config
nginx -t

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Nginx configuration is valid${NC}"
else
    echo -e "${RED}❌ Nginx configuration has errors${NC}"
    exit 1
fi

# Reload nginx
systemctl reload nginx
echo -e "${GREEN}✅ Nginx reloaded${NC}"
echo ""

# Setup systemd service
echo -e "${YELLOW}⚙️  Setting up systemd service...${NC}"

# Copy service file
cp business-crm.service /etc/systemd/system/

# Reload systemd
systemctl daemon-reload

# Enable and start service
systemctl enable business-crm
systemctl restart business-crm

# Check service status
sleep 2
if systemctl is-active --quiet business-crm; then
    echo -e "${GREEN}✅ Backend service is running${NC}"
else
    echo -e "${RED}❌ Backend service failed to start${NC}"
    journalctl -u business-crm -n 20 --no-pager
    exit 1
fi

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ Business CRM Setup Complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "🌐 Frontend: ${YELLOW}https://crm.hltrn.cc${NC}"
echo -e "🔧 Backend:  ${YELLOW}https://crm.hltrn.cc/api${NC}"
echo ""
echo -e "📋 Useful commands:"
echo -e "  View logs:     ${YELLOW}journalctl -u business-crm -f${NC}"
echo -e "  Restart:       ${YELLOW}systemctl restart business-crm${NC}"
echo -e "  Stop:          ${YELLOW}systemctl stop business-crm${NC}"
echo -e "  Status:        ${YELLOW}systemctl status business-crm${NC}"
echo ""
echo -e "🔐 Login credentials:"
echo -e "  ${YELLOW}Register the first (owner) account at the URL above on first launch.${NC}"
echo ""
