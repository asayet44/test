#!/usr/bin/env python3
"""Petit serveur d'impression local (macOS / CUPS).

Le navigateur ne peut ni choisir une imprimante, ni n'imprimer que les pages
impaires. Ce serveur, qui écoute uniquement sur 127.0.0.1, reçoit le PDF du
userscript et le confie à la commande `lp` de macOS.

  GET  /imprimantes                     -> liste des imprimantes + imprimante par défaut
  POST /imprimer?imprimante=X&impaires=1 -> corps = PDF, envoyé à l'imprimante X

Chaque requête doit porter l'en-tête X-Token (contenu du fichier ~/.impression-pdf/jeton),
pour qu'un autre site web ne puisse pas déclencher d'impression.
"""
import hmac
import json
import os
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HOTE, PORT = '127.0.0.1', 8765
DOSSIER = os.path.expanduser('~/.impression-pdf')
TAILLE_MAX = 100 * 1024 * 1024  # 100 Mo

with open(os.path.join(DOSSIER, 'jeton')) as f:
    JETON = f.read().strip()


def lister_imprimantes():
    sortie = subprocess.run(['lpstat', '-e'], capture_output=True, text=True, timeout=10).stdout
    liste = [l.strip() for l in sortie.splitlines() if l.strip()]
    defaut = subprocess.run(['lpstat', '-d'], capture_output=True, text=True, timeout=10).stdout
    defaut = defaut.split(':', 1)[1].strip() if ':' in defaut else ''
    return liste, defaut


class Gestionnaire(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write('[impression] ' + fmt % args + '\n')

    def repondre(self, code, objet):
        corps = json.dumps(objet).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(corps)))
        self.end_headers()
        self.wfile.write(corps)

    def autorise(self):
        if hmac.compare_digest(self.headers.get('X-Token', ''), JETON):
            return True
        self.repondre(401, {'erreur': 'Jeton invalide : recopiez ~/.impression-pdf/jeton dans la molette'})
        return False

    def do_GET(self):
        if not self.autorise():
            return
        if urlparse(self.path).path == '/imprimantes':
            try:
                liste, defaut = lister_imprimantes()
                self.repondre(200, {'imprimantes': liste, 'defaut': defaut})
            except Exception as e:
                self.repondre(500, {'erreur': str(e)})
        else:
            self.repondre(404, {'erreur': 'inconnu'})

    def do_POST(self):
        if not self.autorise():
            return
        url = urlparse(self.path)
        if url.path != '/imprimer':
            return self.repondre(404, {'erreur': 'inconnu'})

        params = parse_qs(url.query)
        imprimante = params.get('imprimante', [''])[0]
        impaires = params.get('impaires', ['1'])[0] == '1'

        taille = int(self.headers.get('Content-Length', 0))
        if not 0 < taille <= TAILLE_MAX:
            return self.repondre(400, {'erreur': 'PDF vide ou trop gros'})
        donnees = self.rfile.read(taille)
        if not donnees.startswith(b'%PDF'):
            return self.repondre(400, {'erreur': "Ce n'est pas un PDF"})

        try:
            liste, defaut = lister_imprimantes()
        except Exception as e:
            return self.repondre(500, {'erreur': str(e)})
        imprimante = imprimante or defaut
        if imprimante not in liste:  # évite de passer n'importe quoi à lp
            return self.repondre(400, {'erreur': f'Imprimante inconnue : {imprimante or "(aucune)"}'})

        commande = ['lp', '-d', imprimante]
        if impaires:
            commande += ['-o', 'page-set=odd']

        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
            tmp.write(donnees)
            chemin = tmp.name
        try:
            r = subprocess.run(commande + [chemin], capture_output=True, text=True, timeout=60)
        finally:
            os.unlink(chemin)  # lp a déjà copié le fichier dans sa file d'attente

        if r.returncode != 0:
            return self.repondre(500, {'erreur': r.stderr.strip() or 'lp a échoué'})
        self.repondre(200, {'ok': True, 'imprimante': imprimante, 'impaires': impaires, 'lp': r.stdout.strip()})


if __name__ == '__main__':
    print(f'[impression] écoute sur http://{HOTE}:{PORT}', file=sys.stderr)
    ThreadingHTTPServer((HOTE, PORT), Gestionnaire).serve_forever()
