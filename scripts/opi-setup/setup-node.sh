#!/bin/bash
# =============================================================================
# Universal Residential Exit Node Setup
# Works on any Ubuntu/Debian Linux (Orange Pi, Raspberry Pi, x86, etc.)
#
# Usage:
#   curl -sL https://devcrm.hltrn.cc/uploads/spaces/11/awg/setup-node.sh | sudo bash -s -- \
#     --name opi1-home --ip 10.66.66.6 --role home
#
# Roles:
#   home   - 24/7 residential exit node
#   store  - exit node active only 22:00-09:00 MSK
# =============================================================================

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
NODE_NAME=""
AWG_IP=""
ROLE="home"
VPS_HOST="<VPN_IP>"
VPS_PORT="51820"
VPS_PUBKEY="MkOvu1mRqPd61M5mSlLYaEg5iNxXioknJMSfWWvyi1o="
SOCKS_PORT="1080"
SING_BOX_VERSION="1.11.0"

# AWG obfuscation params (MUST match VPS server)
AWG_JC=4
AWG_JMIN=50
AWG_JMAX=1000
AWG_S1=52
AWG_S2=48
AWG_H1=1009501749
AWG_H2=489390918
AWG_H3=1611410412
AWG_H4=1690143925

# CRM server SSH key
CRM_SSH_KEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBppUKrYwTExkgChP1LA+is99MWsFotoquCnF2rgtUfd root@v527836.hosted-by-vdsina.com"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*"; exit 1; }

# ── Parse args ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)  NODE_NAME="$2"; shift 2 ;;
    --ip)    AWG_IP="$2"; shift 2 ;;
    --role)  ROLE="$2"; shift 2 ;;
    --key)   AWG_PRIVKEY="$2"; shift 2 ;;
    *)       err "Unknown arg: $1" ;;
  esac
done

[[ -z "$NODE_NAME" ]] && err "Missing --name (e.g. opi1-home)"
[[ -z "$AWG_IP" ]]    && err "Missing --ip (e.g. 10.66.66.6)"

# ── Check root ────────────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && err "Run as root: sudo bash $0 ..."

log "Setting up node: $NODE_NAME ($AWG_IP) role=$ROLE"

# ── 1. System basics ─────────────────────────────────────────────────────────
log "Updating system and installing dependencies..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl wget git iptables net-tools \
  software-properties-common build-essential gcc make > /dev/null

# ── 2. SSH hardening ─────────────────────────────────────────────────────────
log "Configuring SSH..."
mkdir -p /root/.ssh
chmod 700 /root/.ssh

# Add CRM server key
grep -qF "$CRM_SSH_KEY" /root/.ssh/authorized_keys 2>/dev/null || \
  echo "$CRM_SSH_KEY" >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys

# Enable root login via key only
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sed -i 's/^#*PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd 2>/dev/null || systemctl restart ssh 2>/dev/null || true

# ── 3. Install AmneziaWG ─────────────────────────────────────────────────────
log "Installing AmneziaWG..."
if ! command -v awg &>/dev/null; then
  add-apt-repository -y ppa:amnezia/ppa 2>/dev/null || true
  apt-get update -qq
  apt-get install -y -qq amneziawg amneziawg-tools 2>/dev/null || {
    warn "PPA failed, building from source..."
    cd /tmp
    git clone --depth 1 https://github.com/amnezia-vpn/amneziawg-linux-kernel-module.git
    cd amneziawg-linux-kernel-module/src
    make && make install
    cd /tmp
    git clone --depth 1 https://github.com/amnezia-vpn/amneziawg-tools.git
    cd amneziawg-tools/src
    make && make install
    cd /root
  }
fi
log "AWG installed: $(which awg 2>/dev/null || echo 'via module')"

# ── 4. Generate or use AWG keypair ───────────────────────────────────────────
if [[ -z "${AWG_PRIVKEY:-}" ]]; then
  if [[ -f /etc/amnezia/amneziawg/awg0.conf ]]; then
    AWG_PRIVKEY=$(grep PrivateKey /etc/amnezia/amneziawg/awg0.conf | awk '{print $3}')
    log "Using existing private key from awg0.conf"
  elif [[ -f /etc/wireguard/wg0.conf ]]; then
    AWG_PRIVKEY=$(grep PrivateKey /etc/wireguard/wg0.conf | awk '{print $3}')
    log "Using existing private key from wg0.conf"
  else
    AWG_PRIVKEY=$(awg genkey 2>/dev/null || wg genkey)
    warn "Generated NEW keypair — you need to add this peer to VPS!"
    echo "$AWG_PRIVKEY" | (awg pubkey 2>/dev/null || wg pubkey) > /tmp/node-pubkey
    warn "Public key: $(cat /tmp/node-pubkey)"
    warn "Run on VPS: awg set awg0 peer $(cat /tmp/node-pubkey) allowed-ips ${AWG_IP}/32"
  fi
fi

# ── 5. Create AWG config ─────────────────────────────────────────────────────
log "Writing AWG config..."
mkdir -p /etc/amnezia/amneziawg
cat > /etc/amnezia/amneziawg/awg0.conf << AWGEOF
[Interface]
PrivateKey = ${AWG_PRIVKEY}
Address = ${AWG_IP}/32
# DNS handled by sing-box, not here
Jc = ${AWG_JC}
Jmin = ${AWG_JMIN}
Jmax = ${AWG_JMAX}
S1 = ${AWG_S1}
S2 = ${AWG_S2}
H1 = ${AWG_H1}
H2 = ${AWG_H2}
H3 = ${AWG_H3}
H4 = ${AWG_H4}

[Peer]
PublicKey = ${VPS_PUBKEY}
Endpoint = ${VPS_HOST}:${VPS_PORT}
AllowedIPs = 10.66.66.0/24
PersistentKeepalive = 25
AWGEOF
chmod 600 /etc/amnezia/amneziawg/awg0.conf

# Stop old WG if running
systemctl stop wg-quick@wg0 2>/dev/null || true
systemctl disable wg-quick@wg0 2>/dev/null || true
ip link delete wg0 2>/dev/null || true

# Start AWG
systemctl enable awg-quick@awg0
systemctl restart awg-quick@awg0
sleep 2

if awg show awg0 | grep -q "latest handshake"; then
  log "AWG tunnel UP — connected to VPS"
else
  warn "AWG started but no handshake yet (may take a few seconds)"
fi

# ── 6. Install microsocks (SOCKS5 proxy) ─────────────────────────────────────
log "Installing microsocks..."
if ! command -v microsocks &>/dev/null; then
  cd /tmp
  git clone --depth 1 https://github.com/rofl0r/microsocks.git
  cd microsocks
  make && cp microsocks /usr/local/bin/
  cd /root
fi

# Create systemd service
cat > /etc/systemd/system/microsocks.service << 'MSEOF'
[Unit]
Description=MicroSOCKS proxy
After=awg-quick@awg0.service
Wants=awg-quick@awg0.service

[Service]
Type=simple
ExecStart=/usr/local/bin/microsocks -i 0.0.0.0 -p 1080
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
MSEOF

systemctl daemon-reload
systemctl enable microsocks
systemctl restart microsocks
log "microsocks running on port ${SOCKS_PORT}"

# ── 7. Install sing-box ──────────────────────────────────────────────────────
log "Installing sing-box..."
ARCH=$(dpkg --print-architecture)
case "$ARCH" in
  arm64|aarch64) SB_ARCH="arm64" ;;
  amd64|x86_64)  SB_ARCH="amd64" ;;
  armhf)         SB_ARCH="armv7" ;;
  *)             err "Unsupported arch: $ARCH" ;;
esac

if ! command -v sing-box &>/dev/null; then
  cd /tmp
  wget -q "https://github.com/SagerNet/sing-box/releases/download/v${SING_BOX_VERSION}/sing-box-${SING_BOX_VERSION}-linux-${SB_ARCH}.tar.gz" -O sing-box.tar.gz
  tar xzf sing-box.tar.gz
  cp sing-box-${SING_BOX_VERSION}-linux-${SB_ARCH}/sing-box /usr/local/bin/
  chmod +x /usr/local/bin/sing-box
  cd /root
fi
log "sing-box installed: $(sing-box version 2>/dev/null | head -1)"

# ── 8. Configure sing-box (local geo-routing) ────────────────────────────────
log "Configuring sing-box for local geo-routing..."
mkdir -p /etc/sing-box

cat > /etc/sing-box/config.json << 'SBEOF'
{
  "log": {
    "level": "warn",
    "timestamp": true
  },
  "dns": {
    "servers": [
      {
        "type": "udp",
        "tag": "dns-ru",
        "server": "77.88.8.8",
        "server_port": 53
      },
      {
        "type": "udp",
        "tag": "dns-default",
        "server": "1.1.1.1",
        "server_port": 53
      }
    ],
    "rules": [
      {
        "rule_set": ["geosite-ru"],
        "server": "dns-ru"
      }
    ],
    "final": "dns-default",
    "independent_cache": true
  },
  "inbounds": [
    {
      "type": "tun",
      "tag": "tun-in",
      "interface_name": "tun0",
      "inet4_address": "172.19.0.1/30",
      "auto_route": true,
      "strict_route": true,
      "sniff": true,
      "exclude_interface": ["awg0"]
    }
  ],
  "outbounds": [
    {
      "type": "direct",
      "tag": "direct"
    },
    {
      "type": "socks",
      "tag": "vpn-tunnel",
      "server": "10.66.66.1",
      "server_port": 12345,
      "version": "5"
    }
  ],
  "route": {
    "rules": [
      {
        "protocol": "dns",
        "action": "hijack-dns"
      },
      {
        "rule_set": ["geoip-ru", "geosite-ru"],
        "outbound": "direct"
      },
      {
        "ip_cidr": ["10.0.0.0/8", "192.168.0.0/16", "172.16.0.0/12"],
        "outbound": "direct"
      }
    ],
    "rule_set": [
      {
        "type": "remote",
        "tag": "geoip-ru",
        "format": "binary",
        "url": "https://raw.githubusercontent.com/hiddify/hiddify-geo/rule-set/country/geoip-ru.srs",
        "update_interval": "120h0m0s"
      },
      {
        "type": "remote",
        "tag": "geosite-ru",
        "format": "binary",
        "url": "https://raw.githubusercontent.com/hiddify/hiddify-geo/rule-set/country/geosite-ru.srs",
        "update_interval": "120h0m0s"
      }
    ],
    "final": "direct",
    "auto_detect_interface": true
  }
}
SBEOF

# Create systemd service for sing-box
cat > /etc/systemd/system/sing-box.service << 'SSEOF'
[Unit]
Description=sing-box service
After=network.target awg-quick@awg0.service
Wants=awg-quick@awg0.service

[Service]
Type=simple
ExecStart=/usr/local/bin/sing-box run -c /etc/sing-box/config.json
Restart=always
RestartSec=5
CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_RAW CAP_NET_BIND_SERVICE
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_RAW CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
SSEOF

systemctl daemon-reload
systemctl enable sing-box
systemctl restart sing-box
log "sing-box running with geo-routing (RU=direct, else=direct for now)"

# ── 9. Firewall: allow SOCKS only from AWG network ───────────────────────────
log "Configuring firewall..."
# Allow SOCKS5 only from VPS through AWG tunnel
iptables -A INPUT -i awg0 -p tcp --dport ${SOCKS_PORT} -s 10.66.66.1 -j ACCEPT
iptables -A INPUT -p tcp --dport ${SOCKS_PORT} -j DROP

# Enable IP forwarding
sysctl -w net.ipv4.ip_forward=1 > /dev/null
grep -q "net.ipv4.ip_forward=1" /etc/sysctl.conf || echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf

# Save iptables
iptables-save > /etc/iptables/rules.v4 2>/dev/null || {
  mkdir -p /etc/iptables
  iptables-save > /etc/iptables/rules.v4
}

# ── 10. Store schedule (cron) ─────────────────────────────────────────────────
if [[ "$ROLE" == "store" ]]; then
  log "Setting up store schedule (active 22:00-09:00 MSK only)..."

  # Set timezone
  timedatectl set-timezone Europe/Moscow 2>/dev/null || \
    ln -sf /usr/share/zoneinfo/Europe/Moscow /etc/localtime

  cat > /usr/local/bin/node-schedule.sh << 'SCHEDEOF'
#!/bin/bash
# Start microsocks at 22:00, stop at 09:00 (MSK)
HOUR=$(date +%H)
if [[ $HOUR -ge 22 ]] || [[ $HOUR -lt 9 ]]; then
  systemctl start microsocks 2>/dev/null
else
  systemctl stop microsocks 2>/dev/null
fi
SCHEDEOF
  chmod +x /usr/local/bin/node-schedule.sh

  # Cron: check every 15 minutes
  (crontab -l 2>/dev/null | grep -v node-schedule; \
   echo "*/15 * * * * /usr/local/bin/node-schedule.sh") | crontab -

  # Also set up timers for exact transitions
  # 22:00 — start
  (crontab -l 2>/dev/null; echo "0 22 * * * systemctl start microsocks") | sort -u | crontab -
  # 09:00 — stop
  (crontab -l 2>/dev/null; echo "0 9 * * * systemctl stop microsocks") | sort -u | crontab -

  # Apply schedule now
  /usr/local/bin/node-schedule.sh
  log "Store schedule configured: microsocks active 22:00-09:00 MSK"
else
  log "Home node: microsocks active 24/7"
fi

# ── 11. Set hostname ─────────────────────────────────────────────────────────
hostnamectl set-hostname "$NODE_NAME" 2>/dev/null || \
  echo "$NODE_NAME" > /etc/hostname

# ── 12. Bandwidth limits (prevent channel overload) ──────────────────────────
log "Setting bandwidth limits..."
apt-get install -y -qq wondershaper 2>/dev/null || true
if command -v wondershaper &>/dev/null; then
  # Limit to 10Mbps down / 5Mbps up on AWG interface
  wondershaper awg0 10240 5120 2>/dev/null || true
  log "Bandwidth limited: 10Mbps down / 5Mbps up on awg0"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "======================================"
echo "  Node setup complete: $NODE_NAME"
echo "======================================"
echo "  AWG IP:     $AWG_IP"
echo "  VPN tunnel: awg0 → ${VPS_HOST}:${VPS_PORT}"
echo "  SOCKS5:     0.0.0.0:${SOCKS_PORT} (AWG only)"
echo "  sing-box:   RU traffic → direct"
echo "  Role:       $ROLE"
[[ "$ROLE" == "store" ]] && echo "  Schedule:   22:00-09:00 MSK only"
echo "  Hostname:   $NODE_NAME"
echo "======================================"
echo ""
echo "Test commands:"
echo "  awg show                    # check tunnel"
echo "  curl -x socks5://127.0.0.1:1080 ifconfig.me  # test SOCKS"
echo "  systemctl status sing-box   # check routing"
echo ""
