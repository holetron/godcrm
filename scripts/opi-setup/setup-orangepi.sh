#!/bin/bash
###############################################################################
# Orange Pi Universal Setup Script
# Запускается с USB-флешки. Настраивает систему на SSD/eMMC.
#
# Использование:
#   1. Скопировать эту папку на USB-флешку
#   2. Загрузить Orange Pi с microSD (любой рабочей ОС)
#   3. Вставить USB, примонтировать, запустить:
#      sudo bash /media/usb/setup-orangepi.sh [hostname] [awg-ip]
#
# Примеры:
#   sudo bash /media/usb/setup-orangepi.sh opi1-office 10.66.66.6
#   sudo bash /media/usb/setup-orangepi.sh opi2-office 10.66.66.10
#   sudo bash /media/usb/setup-orangepi.sh opi3-new 10.66.66.16
###############################################################################

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*"; exit 1; }

# --- Args ---
HOSTNAME="${1:-}"
AWG_IP="${2:-}"

if [ -z "$HOSTNAME" ] || [ -z "$AWG_IP" ]; then
    echo "Usage: $0 <hostname> <awg-ip>"
    echo "  hostname: e.g. opi1-office, opi2-office, opi3-new"
    echo "  awg-ip:   e.g. 10.66.66.6, 10.66.66.10, 10.66.66.16"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- SSH Keys (CRM server + Geratron) ---
SSH_KEYS=(
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBppUKrYwTExkgChP1LA+is99MWsFotoquCnF2rgtUfd root@crm-server"
)

# Load extra keys from keys/ directory if present
if [ -d "$SCRIPT_DIR/keys" ]; then
    for kf in "$SCRIPT_DIR/keys"/*.pub; do
        [ -f "$kf" ] && SSH_KEYS+=("$(cat "$kf")")
    done
fi

# --- AWG Config ---
AWG_SERVER_PUBKEY="MkOvu1mRqPd61M5mSlLYaEg5iNxXioknJMSfWWvyi1o="
AWG_ENDPOINT="<VPN_IP>:51820"

###############################################################################
# 1. Detect target disk (SSD/NVMe)
###############################################################################
log "Detecting disks..."

TARGET_DISK=""
for disk in /dev/nvme0n1 /dev/sda /dev/mmcblk1; do
    if [ -b "$disk" ]; then
        # Skip the boot disk
        BOOT_DISK=$(mount | grep ' / ' | awk '{print $1}' | sed 's/p\?[0-9]*$//')
        if [ "$disk" != "$BOOT_DISK" ]; then
            TARGET_DISK="$disk"
            break
        fi
    fi
done

if [ -z "$TARGET_DISK" ]; then
    warn "No secondary disk found. Will configure current system only (no SSD clone)."
    CLONE_TO_SSD=false
else
    log "Target disk: $TARGET_DISK"
    CLONE_TO_SSD=true
fi

###############################################################################
# 2. System setup (runs on current OS)
###############################################################################
log "Setting hostname to $HOSTNAME..."
hostnamectl set-hostname "$HOSTNAME"

log "Setting timezone to Moscow..."
timedatectl set-timezone Europe/Moscow

log "Updating packages..."
apt update -qq

###############################################################################
# 3. SSH Setup
###############################################################################
log "Configuring SSH..."
mkdir -p /root/.ssh
chmod 700 /root/.ssh
touch /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys

for key in "${SSH_KEYS[@]}"; do
    if ! grep -qF "$key" /root/.ssh/authorized_keys 2>/dev/null; then
        echo "$key" >> /root/.ssh/authorized_keys
        log "  Added key: ${key:0:50}..."
    fi
done

# Ensure sshd allows root login and is enabled
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config
sed -i 's/^#*PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config
systemctl enable ssh sshd 2>/dev/null || true
systemctl restart sshd 2>/dev/null || systemctl restart ssh 2>/dev/null || true

###############################################################################
# 4. Network — ensure connectivity survives WG/AWG mishaps
###############################################################################
log "Configuring network safety..."

# Disable any existing WG that might hijack routing
systemctl stop wg-quick@wg0 2>/dev/null || true
systemctl disable wg-quick@wg0 2>/dev/null || true
ip link delete wg0 2>/dev/null || true

# Ensure NetworkManager manages connections
systemctl enable NetworkManager 2>/dev/null || true

###############################################################################
# 5. Install AmneziaWG
###############################################################################
log "Installing AmneziaWG..."
if ! command -v awg &>/dev/null; then
    add-apt-repository -y ppa:amnezia/ppa
    apt update -qq
    apt install -y amneziawg
fi

# Generate keypair if not exists
AWG_DIR="/etc/amnezia/amneziawg"
mkdir -p "$AWG_DIR"

if [ -f "$SCRIPT_DIR/awg-keys/${HOSTNAME}.key" ]; then
    # Use pre-generated key from USB
    PRIVATE_KEY=$(cat "$SCRIPT_DIR/awg-keys/${HOSTNAME}.key")
    log "Using pre-generated AWG key from USB"
elif [ -f "$AWG_DIR/private.key" ]; then
    PRIVATE_KEY=$(cat "$AWG_DIR/private.key")
    log "Using existing AWG private key"
else
    PRIVATE_KEY=$(awg genkey)
    echo "$PRIVATE_KEY" > "$AWG_DIR/private.key"
    chmod 600 "$AWG_DIR/private.key"
    PUBLIC_KEY=$(echo "$PRIVATE_KEY" | awg pubkey)
    echo "$PUBLIC_KEY" > "$AWG_DIR/public.key"
    log "Generated new AWG keypair"
    warn "PUBLIC KEY: $PUBLIC_KEY"
    warn ">>> Add this peer to VPS: awg set awg0 peer $PUBLIC_KEY allowed-ips ${AWG_IP}/32"
fi

# Create AWG config
cat > "$AWG_DIR/awg0.conf" << AWGEOF
[Interface]
PrivateKey = ${PRIVATE_KEY}
Address = ${AWG_IP}/24
DNS = 1.1.1.1, 8.8.8.8
Jc = 4
Jmin = 50
Jmax = 1000
S1 = 52
S2 = 48
H1 = 1009501749
H2 = 489390918
H3 = 1611410412
H4 = 1690143925

# Don't route ALL traffic through VPN — only VPN subnet
# This prevents internet loss if VPN goes down
PostUp = ip route add 10.66.66.0/24 dev %i
PostDown = ip route del 10.66.66.0/24 dev %i 2>/dev/null || true

[Peer]
PublicKey = ${AWG_SERVER_PUBKEY}
Endpoint = ${AWG_ENDPOINT}
AllowedIPs = 10.66.66.0/24
PersistentKeepalive = 25
AWGEOF

chmod 600 "$AWG_DIR/awg0.conf"

# Enable AWG
systemctl enable awg-quick@awg0
systemctl restart awg-quick@awg0 2>/dev/null || true

###############################################################################
# 6. Swap (4GB)
###############################################################################
log "Setting up swap..."
if ! swapon --show | grep -q '/swapfile'; then
    if [ ! -f /swapfile ]; then
        fallocate -l 4G /swapfile
        chmod 600 /swapfile
        mkswap /swapfile
    fi
    swapon /swapfile 2>/dev/null || true
    grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

###############################################################################
# 7. fail2ban
###############################################################################
log "Installing fail2ban..."
apt install -y -qq fail2ban
systemctl enable fail2ban
systemctl start fail2ban 2>/dev/null || true

###############################################################################
# 8. IP forwarding
###############################################################################
log "Enabling IP forwarding..."
sysctl -w net.ipv4.ip_forward=1 > /dev/null
grep -q 'net.ipv4.ip_forward=1' /etc/sysctl.conf || echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf

###############################################################################
# 9. Install useful tools
###############################################################################
log "Installing tools..."
apt install -y -qq htop iotop iftop tmux curl wget rsync 2>/dev/null || true

###############################################################################
# 10. Clone to SSD (optional)
###############################################################################
if [ "$CLONE_TO_SSD" = true ]; then
    echo ""
    warn "=== SSD CLONE ==="
    warn "Target: $TARGET_DISK"
    warn "This will ERASE $TARGET_DISK and clone current system to it."
    read -p "Proceed? (y/N): " CONFIRM
    if [ "$CONFIRM" = "y" ] || [ "$CONFIRM" = "Y" ]; then
        log "Partitioning $TARGET_DISK..."

        # Create single ext4 partition
        parted -s "$TARGET_DISK" mklabel gpt
        parted -s "$TARGET_DISK" mkpart primary ext4 1MiB 100%

        # Determine partition name
        if [[ "$TARGET_DISK" == *nvme* ]]; then
            TARGET_PART="${TARGET_DISK}p1"
        else
            TARGET_PART="${TARGET_DISK}1"
        fi

        log "Formatting ${TARGET_PART}..."
        mkfs.ext4 -F -L "orangepi-root" "$TARGET_PART"

        log "Mounting and cloning (this takes 5-15 min)..."
        MOUNT_POINT="/mnt/ssd-clone"
        mkdir -p "$MOUNT_POINT"
        mount "$TARGET_PART" "$MOUNT_POINT"

        rsync -aAXH --info=progress2 \
            --exclude='/mnt/*' \
            --exclude='/proc/*' \
            --exclude='/sys/*' \
            --exclude='/dev/*' \
            --exclude='/run/*' \
            --exclude='/tmp/*' \
            --exclude='/media/*' \
            --exclude='/swapfile' \
            / "$MOUNT_POINT/"

        # Create mount points
        mkdir -p "$MOUNT_POINT"/{proc,sys,dev,run,tmp,mnt,media}

        # Create new swapfile on SSD
        fallocate -l 4G "$MOUNT_POINT/swapfile"
        chmod 600 "$MOUNT_POINT/swapfile"
        mkswap "$MOUNT_POINT/swapfile"

        # Update fstab for SSD boot
        SSD_UUID=$(blkid -s UUID -o value "$TARGET_PART")
        cat > "$MOUNT_POINT/etc/fstab" << FSTAB
UUID=${SSD_UUID}  /  ext4  defaults,noatime  0  1
/swapfile  none  swap  sw  0  0
FSTAB

        umount "$MOUNT_POINT"
        log "Clone complete! UUID: $SSD_UUID"
        warn "To boot from SSD, update U-Boot or use armbian-config → System → Boot from SSD"
    else
        log "Skipping SSD clone."
    fi
fi

###############################################################################
# Done
###############################################################################
echo ""
echo "============================================"
log "Setup complete!"
echo "============================================"
echo ""
echo "  Hostname:  $HOSTNAME"
echo "  AWG IP:    $AWG_IP"
echo "  SSH:       root@${AWG_IP} (via AWG tunnel)"
echo ""

# Show AWG status
awg show awg0 2>/dev/null && log "AWG tunnel is UP" || warn "AWG tunnel not connected yet"

# Show public key (needed to add peer on VPS)
if [ -f "$AWG_DIR/public.key" ]; then
    echo ""
    warn "AWG Public Key: $(cat $AWG_DIR/public.key)"
    warn "Add on VPS: awg set awg0 peer $(cat $AWG_DIR/public.key) allowed-ips ${AWG_IP}/32"
fi

echo ""
log "Reboot recommended: sudo reboot"
