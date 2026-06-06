#!/bin/bash

# Script to finalize CRM setup after DNS propagation
# Run this after you've added the DNS A record and it has propagated

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}🔐 Business CRM - SSL Setup${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}❌ Please run as root (use sudo)${NC}"
    exit 1
fi

# Check DNS resolution
echo -e "${YELLOW}🔍 Checking DNS resolution for crm.hltrn.cc...${NC}"
DNS_IP=$(dig +short crm.hltrn.cc | head -n1)

if [ -z "$DNS_IP" ]; then
    echo -e "${RED}❌ DNS not resolving yet!${NC}"
    echo -e "${YELLOW}Please add the DNS A record first:${NC}"
    echo ""
    echo "  Type: A"
    echo "  Name: crm"
    echo "  Value: <DEV_IP>"
    echo ""
    echo "Then wait 5-30 minutes and run this script again."
    exit 1
fi

echo -e "${GREEN}✅ DNS resolved to: $DNS_IP${NC}"

if [ "$DNS_IP" != "<DEV_IP>" ]; then
    echo -e "${YELLOW}⚠️  Warning: DNS points to $DNS_IP instead of <DEV_IP>${NC}"
    echo -e "${YELLOW}Please update your DNS record if this is not correct.${NC}"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo ""

# Get SSL certificate
echo -e "${YELLOW}🔐 Obtaining SSL certificate for crm.hltrn.cc...${NC}"
certbot certonly --nginx -d "${CRM_DOMAIN:-crm.hltrn.cc}" --non-interactive --agree-tos --email "${CERTBOT_EMAIL:?Set CERTBOT_EMAIL to your Let's Encrypt contact email}"

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to obtain SSL certificate${NC}"
    echo -e "${YELLOW}This usually means DNS hasn't propagated yet.${NC}"
    echo -e "${YELLOW}Wait a bit longer and try again.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ SSL certificate obtained successfully${NC}"
echo ""

# Update Nginx configuration
echo -e "${YELLOW}🔧 Updating Nginx configuration...${NC}"

# Backup current config
cp /etc/nginx/sites-available/crm.hltrn.cc /etc/nginx/sites-available/crm.hltrn.cc.backup

# Update SSL certificate paths
sed -i 's|/etc/letsencrypt/live/hltrn.cc/|/etc/letsencrypt/live/crm.hltrn.cc/|g' /etc/nginx/sites-available/crm.hltrn.cc

# Test configuration
nginx -t

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Nginx configuration error${NC}"
    echo -e "${YELLOW}Restoring backup...${NC}"
    cp /etc/nginx/sites-available/crm.hltrn.cc.backup /etc/nginx/sites-available/crm.hltrn.cc
    exit 1
fi

echo -e "${GREEN}✅ Nginx configuration updated${NC}"

# Reload Nginx
systemctl reload nginx
echo -e "${GREEN}✅ Nginx reloaded${NC}"

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ Setup Complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "🌐 Your Business CRM is now available at:"
echo -e "   ${BLUE}https://crm.hltrn.cc${NC}"
echo ""
echo -e "🔐 Login credentials:"
echo -e "   Email:    ${YELLOW}${CERTBOT_EMAIL:-<your-email>}${NC}"
echo -e "   Password: ${YELLOW}0a1667e672378534${NC}"
echo ""
echo -e "📊 Service status:"
echo -e "   Backend:  ${GREEN}Running on port 5000${NC}"
echo -e "   Frontend: ${GREEN}Deployed in /root/business-crm/dist${NC}"
echo -e "   SSL:      ${GREEN}Active (Let's Encrypt)${NC}"
echo ""
echo -e "📝 Useful commands:"
echo -e "   View logs:  ${YELLOW}journalctl -u business-crm -f${NC}"
echo -e "   Restart:    ${YELLOW}systemctl restart business-crm${NC}"
echo -e "   Status:     ${YELLOW}systemctl status business-crm${NC}"
echo ""
echo -e "${GREEN}🎉 Enjoy your Business CRM!${NC}"
echo ""
