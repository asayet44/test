// ==UserScript==
// @name         Impression directe Mac (pages impaires)
// @namespace    saisie-rapide
// @version      1.0
// @description  Bouton imprimer + molette (imprimante, pages impaires). Les PDF ouverts sur ALP partent directement à l'imprimante choisie.
// @match        https://somenor.net/sos77/ALP/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @connect      127.0.0.1
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/asayet44/test/main/impression-mac/impression-mac.user.js
// @downloadURL  https://raw.githubusercontent.com/asayet44/test/main/impression-mac/impression-mac.user.js
// ==/UserScript==

(function () {
  'use strict';

  const SERVEUR = 'http://127.0.0.1:8765';
  const W = unsafeWindow;
  const ouvrirOriginal = W.open.bind(W);

  let dernierPdf = null; // dernier PDF intercepté, pour le bouton « Imprimer »

  // ---------- réglages (mémorisés par Violentmonkey) ----------
  const lire = (cle, defaut) => GM_getValue(cle, defaut);
  const ecrire = (cle, valeur) => GM_setValue(cle, valeur);

  // ---------- dialogue avec le serveur local ----------
  function appel(methode, chemin, corps, entetes) {
    return new Promise((ok, ko) => {
      GM_xmlhttpRequest({
        method: methode,
        url: SERVEUR + chemin,
        headers: Object.assign({ 'X-Token': lire('jeton', '') }, entetes || {}),
        data: corps,
        timeout: 60000,
        onload: (r) => {
          let json = null;
          try { json = JSON.parse(r.responseText); } catch (e) { /* réponse non JSON */ }
          if (r.status >= 200 && r.status < 300) ok(json);
          else ko(new Error((json && json.erreur) || 'Erreur HTTP ' + r.status));
        },
        onerror: () => ko(new Error("Serveur d'impression injoignable (voir installation)")),
        ontimeout: () => ko(new Error("Le serveur d'impression ne répond pas")),
      });
    });
  }

  async function imprimer(pdf) {
    const imprimante = lire('imprimante', '');
    if (!imprimante) {
      ouvrirReglages();
      throw new Error("Choisissez d'abord une imprimante (molette)");
    }
    const impaires = lire('impaires', true) ? 1 : 0;
    const r = await appel(
      'POST',
      '/imprimer?imprimante=' + encodeURIComponent(imprimante) + '&impaires=' + impaires,
      pdf,
      { 'Content-Type': 'application/pdf' }
    );
    notifier('Envoyé à ' + r.imprimante + (r.impaires ? ' (pages impaires)' : ' (toutes les pages)'));
  }

  // ---------- interception des PDF ouverts par la page ----------
  const estPdf = (url) =>
    typeof url === 'string' && (url.startsWith('blob:') || /\.pdf([?#].*)?$/i.test(url));

  async function traiter(url) {
    try {
      const fichier = await (await fetch(url)).blob();
      if (fichier.type !== 'application/pdf') return ouvrirOriginal(url, '_blank');
      dernierPdf = fichier;
      await imprimer(fichier);
    } catch (e) {
      notifier(e.message, true);
      ouvrirOriginal(url, '_blank'); // en cas de souci, on affiche le PDF comme avant
    }
  }

  W.open = function (url, ...reste) {
    if (estPdf(String(url))) {
      traiter(String(url));
      return null;
    }
    return ouvrirOriginal(url, ...reste);
  };

  const clicOriginal = W.HTMLAnchorElement.prototype.click;
  W.HTMLAnchorElement.prototype.click = function () {
    if (estPdf(this.href) && this.target === '_blank') return traiter(this.href);
    return clicOriginal.call(this);
  };
  document.addEventListener('click', (e) => {
    const lien = e.target.closest && e.target.closest('a[target="_blank"]');
    if (!lien || !estPdf(lien.href)) return;
    e.preventDefault();
    traiter(lien.href);
  }, true);

  // ---------- interface : bouton + molette ----------
  let boite, panneau, toast, timerToast;

  function notifier(texte, erreur) {
    if (!toast) return console.log('[Impression Mac]', texte);
    toast.textContent = texte;
    toast.style.background = erreur ? '#b3261e' : '#1e6e3a';
    toast.style.display = 'block';
    clearTimeout(timerToast);
    timerToast = setTimeout(() => (toast.style.display = 'none'), erreur ? 6000 : 3000);
  }

  function style(el, css) { Object.assign(el.style, css); return el; }

  async function remplirImprimantes(select, etat) {
    etat.textContent = 'Recherche des imprimantes…';
    try {
      const r = await appel('GET', '/imprimantes');
      select.innerHTML = '';
      const choisie = lire('imprimante', '') || r.defaut;
      r.imprimantes.forEach((nom) => {
        const o = document.createElement('option');
        o.value = o.textContent = nom;
        o.selected = nom === choisie;
        select.appendChild(o);
      });
      if (select.value) ecrire('imprimante', select.value);
      etat.textContent = r.imprimantes.length ? 'Connecté ✓' : 'Aucune imprimante installée sur ce Mac';
    } catch (e) {
      etat.textContent = e.message;
    }
  }

  function ouvrirReglages() {
    if (!panneau) return;
    panneau.style.display = 'block';
    remplirImprimantes(panneau.querySelector('select'), panneau.querySelector('.etat'));
  }

  function construireInterface() {
    boite = style(document.createElement('div'), {
      position: 'fixed', right: '12px', bottom: '12px', zIndex: 2147483647,
      font: '14px -apple-system, sans-serif', display: 'flex', gap: '4px', alignItems: 'flex-end',
      flexDirection: 'column',
    });

    toast = style(document.createElement('div'), {
      display: 'none', color: '#fff', padding: '6px 10px', borderRadius: '6px', maxWidth: '260px',
    });

    panneau = style(document.createElement('div'), {
      display: 'none', background: '#fff', color: '#111', border: '1px solid #999', borderRadius: '8px',
      padding: '10px', width: '250px', boxShadow: '0 2px 10px rgba(0,0,0,.3)',
    });
    panneau.innerHTML =
      '<div style="margin-bottom:6px"><b>Imprimante</b></div>' +
      '<select style="width:100%;margin-bottom:8px"></select>' +
      '<label style="display:block;margin-bottom:8px"><input type="checkbox" class="impaires"> Seulement les pages impaires</label>' +
      '<div style="margin-bottom:2px"><b>Jeton</b> (voir installation)</div>' +
      '<input type="password" class="jeton" style="width:100%;margin-bottom:8px;box-sizing:border-box">' +
      '<div class="etat" style="font-size:12px;color:#555;margin-bottom:8px"></div>' +
      '<button class="fermer">Fermer</button>';

    const select = panneau.querySelector('select');
    const impaires = panneau.querySelector('.impaires');
    const jeton = panneau.querySelector('.jeton');
    impaires.checked = lire('impaires', true);
    jeton.value = lire('jeton', '');
    select.onchange = () => ecrire('imprimante', select.value);
    impaires.onchange = () => ecrire('impaires', impaires.checked);
    jeton.onchange = () => { ecrire('jeton', jeton.value.trim()); ouvrirReglages(); };
    panneau.querySelector('.fermer').onclick = () => (panneau.style.display = 'none');

    const rangee = style(document.createElement('div'), { display: 'flex', gap: '4px' });
    const bouton = (texte, titre, action) => {
      const b = style(document.createElement('button'), {
        padding: '6px 10px', borderRadius: '6px', border: '1px solid #666', background: '#f4f4f4',
        cursor: 'pointer', font: 'inherit', color: '#111',
      });
      b.textContent = texte; b.title = titre; b.onclick = action;
      return b;
    };
    rangee.append(
      bouton('🖨 Imprimer', 'Réimprimer le dernier PDF', async () => {
        if (!dernierPdf) return notifier("Aucun PDF ouvert depuis le chargement de la page", true);
        try { await imprimer(dernierPdf); } catch (e) { notifier(e.message, true); }
      }),
      bouton('⚙', 'Réglages (imprimante, pages impaires)', () =>
        panneau.style.display === 'none' ? ouvrirReglages() : (panneau.style.display = 'none'))
    );

    boite.append(toast, panneau, rangee);
    document.body.appendChild(boite);
  }

  if (document.body) construireInterface();
  else document.addEventListener('DOMContentLoaded', construireInterface);
})();
