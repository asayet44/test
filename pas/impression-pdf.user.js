// ==UserScript==
// @name         Impression PDF
// @namespace    saisie-rapide
// @version      1.0
// @description  L'icône imprimante de PAS ouvre directement l'écran d'impression au lieu d'afficher le PDF
// @match        https://somenor.net/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/asayet44/test/main/pas/impression-pdf.user.js
// @downloadURL  https://raw.githubusercontent.com/asayet44/test/main/pas/impression-pdf.user.js
// ==/UserScript==

(function () {
  'use strict';

  // PAS fabrique le PDF dans la page puis l'ouvre à une adresse "blob:".
  // Les extensions ne peuvent pas agir sur cette page blob, donc on intercepte
  // l'ouverture côté PAS et on imprime le PDF dans un cadre invisible.
  const ouvrirOriginal = window.open.bind(window);

  async function imprimerOuOuvrir(url) {
    try {
      const fichier = await (await fetch(url)).blob();
      if (fichier.type !== 'application/pdf') return ouvrirOriginal(url, '_blank');

      const cadre = document.createElement('iframe');
      Object.assign(cadre.style, {
        position: 'fixed', right: 0, bottom: 0, width: '1px', height: '1px', opacity: 0, border: 0,
      });
      cadre.src = url;
      cadre.onload = () => {
        // délai : le lecteur PDF doit finir d'afficher le document avant l'impression
        setTimeout(() => {
          try {
            cadre.contentWindow.focus();
            cadre.contentWindow.print();
          } catch (e) {
            console.warn('[Impression PDF] impression impossible, ouverture normale', e);
            ouvrirOriginal(url, '_blank');
          }
        }, 800);
      };
      document.body.appendChild(cadre);
    } catch (e) {
      console.warn('[Impression PDF] échec, ouverture normale', e);
      ouvrirOriginal(url, '_blank');
    }
  }

  const estBlob = (url) => typeof url === 'string' && url.startsWith('blob:');

  // Cas 1 : PAS ouvre le PDF avec window.open
  window.open = function (url, ...reste) {
    if (estBlob(String(url))) {
      imprimerOuOuvrir(String(url));
      return null;
    }
    return ouvrirOriginal(url, ...reste);
  };

  // Cas 2 : PAS ouvre le PDF avec un lien <a href="blob:..." target="_blank">
  const clicOriginal = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (estBlob(this.href) && this.target === '_blank') return imprimerOuOuvrir(this.href);
    return clicOriginal.call(this);
  };
  document.addEventListener('click', (e) => {
    const lien = e.target.closest && e.target.closest('a[href^="blob:"][target="_blank"]');
    if (!lien) return;
    e.preventDefault();
    imprimerOuOuvrir(lien.href);
  }, true);
})();
