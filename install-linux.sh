#!/bin/bash

# Check if npm/node is installed
if ! command -v npm &> /dev/null; then
    echo "npm is not installed. Installing Node.js and npm..."

    # Detect the Linux distribution
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
        OS_LIKE=$ID_LIKE
    elif [ -f /etc/lsb-release ]; then
        . /etc/lsb-release
        OS=$(echo $DISTRIB_ID | tr '[:upper:]' '[:lower:]')
    else
        echo "Unable to detect Linux distribution."
        exit 1
    fi

    # Normalize OS names
    case "$OS" in
        ubuntu|debian|linuxmint|elementary|pop|neon|zorin)
            echo "Detected Debian-based system. Installing Node.js..."
            sudo apt-get update
            sudo apt-get install -y nodejs npm
            ;;
        fedora|rhel|centos|rocky|almalinux|nobara)
            echo "Detected RHEL-based system. Installing Node.js..."
            sudo dnf install -y nodejs npm || sudo yum install -y nodejs npm
            ;;
        arch|manjaro|endeavouros|garuda|artix)
            echo "Detected Arch-based system. Installing Node.js..."
            sudo pacman -S --noconfirm nodejs npm
            ;;
        alpine)
            echo "Detected Alpine Linux. Installing Node.js..."
            sudo apk add --no-cache nodejs npm
            ;;
        opensuse|opensuse-leap|opensuse-tumbleweed)
            echo "Detected openSUSE. Installing Node.js..."
            sudo zypper install -y nodejs npm
            ;;
        void)
            echo "Detected Void Linux. Installing Node.js..."
            sudo xbps-install -S -y nodejs npm
            ;;
        gentoo)
            echo "Detected Gentoo Linux. Installing Node.js..."
            sudo emerge --ask=n nodejs
            ;;
        nixos)
            echo "Detected NixOS. Installing Node.js..."
            nix-shell -p nodejs npm --run "npm --version"
            ;;
        slackware)
            echo "Detected Slackware Linux. Installing Node.js..."
            echo "Please install Node.js manually from https://nodejs.org/"
            exit 1
            ;;
        *)
            # Try to detect by ID_LIKE as fallback
            if [[ "$OS_LIKE" == *"debian"* ]]; then
                echo "Detected Debian-like system. Installing Node.js..."
                sudo apt-get update
                sudo apt-get install -y nodejs npm
            elif [[ "$OS_LIKE" == *"fedora"* ]]; then
                echo "Detected Fedora-like system. Installing Node.js..."
                sudo dnf install -y nodejs npm || sudo yum install -y nodejs npm
            elif [[ "$OS_LIKE" == *"arch"* ]]; then
                echo "Detected Arch-like system. Installing Node.js..."
                sudo pacman -S --noconfirm nodejs npm
            else
                echo "Unsupported Linux distribution: $OS"
                echo "Please install Node.js and npm manually from https://nodejs.org/"
                exit 1
            fi
            ;;
    esac

    echo "Node.js installation complete."
else
    echo "npm is already installed."
fi

echo "Installing pnpm..."
curl -fsSL https://get.pnpm.io/install.sh | sh -

# Add pnpm to PATH if not already there
export PNPM_HOME="$HOME/.local/share/pnpm"
case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
esac

# Source shell profile to ensure pnpm is in PATH
if [ -n "$BASH_VERSION" ]; then
    source $HOME/.bashrc 2>/dev/null || true
elif [ -n "$ZSH_VERSION" ]; then
    source $HOME/.zshrc 2>/dev/null || true
fi

echo "pnpm installation complete!"
echo "Installing Vermcord..."

# Run pnpm i in a separate shell and wait for it to close
echo "Running: pnpm i"
bash -c "pnpm i"
wait

# Run pnpm build in a separate shell and wait for it to close
echo "Running: pnpm build"
bash -c "pnpm build"
wait

# Run pnpm inject normally in the current shell
echo "Running: pnpm inject"
pnpm inject

clear
echo "Vermcord Installed!"
