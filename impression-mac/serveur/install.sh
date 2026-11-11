#!/bin/bash
# Installe (ou désinstalle avec --desinstaller) le serveur d'impression local sur macOS.
# Il démarre tout seul à l'ouverture de session (LaunchAgent) et n'écoute que sur 127.0.0.1.
set -euo pipefail

DIR="$HOME/.impression-pdf"
LABEL="fr.fiouf.impression-pdf"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
RAW="https://raw.githubusercontent.com/asayet44/test/main/impression-mac/serveur/impression-serveur.py"
UID_NUM="$(id -u)"

if [ "${1:-}" = "--desinstaller" ]; then
  launchctl bootout "gui/$UID_NUM" "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  rm -rf "$DIR"
  echo "Serveur d'impression désinstallé."
  exit 0
fi

PY="$(command -v python3 || true)"
if [ -z "$PY" ]; then
  echo "python3 est introuvable. Lancez « xcode-select --install » puis relancez ce script." >&2
  exit 1
fi

mkdir -p "$DIR"

# Copie locale si on lance le script depuis le dépôt cloné, sinon téléchargement.
SRC="$(dirname "${BASH_SOURCE[0]:-$0}")/impression-serveur.py"
if [ -f "$SRC" ]; then cp "$SRC" "$DIR/impression-serveur.py"; else curl -fsSL "$RAW" -o "$DIR/impression-serveur.py"; fi

# Jeton secret (créé une seule fois) : le userscript doit le présenter à chaque requête.
if [ ! -s "$DIR/jeton" ]; then
  "$PY" -c 'import secrets; print(secrets.token_urlsafe(24))' > "$DIR/jeton"
  chmod 600 "$DIR/jeton"
fi

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$PY</string><string>$DIR/impression-serveur.py</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>$DIR/serveur.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$UID_NUM" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$UID_NUM" "$PLIST"

JETON="$(cat "$DIR/jeton")"
printf %s "$JETON" | pbcopy 2>/dev/null || true
echo
echo "Serveur installé et démarré (http://127.0.0.1:8765)."
echo "Jeton (déjà copié dans le presse-papiers) : $JETON"
echo "Collez-le dans la molette du userscript, champ « Jeton »."
