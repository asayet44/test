// ==UserScript==
// @name         Constantes aléatoires
// @namespace    saisie-rapide
// @version      2.1
// @description  Remplit les constantes avec des valeurs aléatoires cohérentes, puis curseur dans Diag
// @match        *://*/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/asayet44/test/main/pas/constantes-aleatoires.user.js
// @downloadURL  https://raw.githubusercontent.com/asayet44/test/main/pas/constantes-aleatoires.user.js
// ==/UserScript==

(function () {
  'use strict';

  // Écrit une valeur dans un champ de façon à ce que l'appli web la "voie"
  // (les frameworks type React/Vue ignorent un simple el.value = ...)
  function setValue(el, v) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // Repère les champs grâce à leur texte d'aide (placeholder)
  function getFields() {
    const byPh = (ph) => [...document.querySelectorAll('input')].filter(
      (i) => (i.placeholder || '').trim() === ph
    );
    const mmhg = byPh('mmHg');
    return {
      pas: mmhg[0],
      pad: mmhg[1],
      fc: byPh('bpm')[0],
      sat: byPh('%')[0],
      t: byPh('°C')[0],
    };
  }

  // Champ de recherche du diagnostic = l'input situé à côté du bouton "Rechercher"
  function getDiagField() {
    const btn = [...document.querySelectorAll('button, input[type=button], input[type=submit], a, div')]
      .find((b) => (b.textContent || b.value || '').trim() === 'Rechercher');
    if (!btn) return null;
    let box = btn.parentElement;
    for (let i = 0; i < 4 && box; i++) {
      const inp = box.querySelector('input[type=text], input:not([type])');
      if (inp) return inp;
      box = box.parentElement;
    }
    return null;
  }

  // Génère des valeurs aléatoires cohérentes
  const entier = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  function genererValeurs() {
    const pas = entier(100, 140);
    const pad = entier(80, Math.min(100, pas - 20)); // toujours < PAS, différentielle >= 20
    const fc = entier(50, 90);
    const sat = entier(96, 100);
    const t = (entier(360, 375) / 10).toFixed(1).replace('.', ','); // 36,0 -> 37,5
    return { pas, pad, fc, sat, t };
  }

  function saisir() {
    const f = getFields();
    if (!f.pas || !f.pad || !f.fc || !f.sat || !f.t) {
      alert('Champs des constantes introuvables sur cette page.');
      return;
    }
    const v = genererValeurs();
    setValue(f.pas, String(v.pas));
    setValue(f.pad, String(v.pad));
    setValue(f.fc, String(v.fc));
    setValue(f.sat, String(v.sat));
    setValue(f.t, v.t);

    const diag = getDiagField();
    if (diag) {
      diag.scrollIntoView({ block: 'center' });
      diag.focus();
    }
  }

  // Ajoute le bouton flottant seulement quand les champs sont affichés
  function ensureButton() {
    const present = !!getFields().fc;
    let btn = document.getElementById('sr-constantes-btn');
    if (present && !btn) {
      btn = document.createElement('button');
      btn.id = 'sr-constantes-btn';
      btn.textContent = '⚡ Constantes';
      Object.assign(btn.style, {
        position: 'fixed', right: '12px', bottom: '110px', zIndex: 99999,
        padding: '12px 16px', fontSize: '16px', borderRadius: '24px',
        border: 'none', background: '#4a7fd6', color: '#fff',
        boxShadow: '0 2px 8px rgba(0,0,0,.3)',
      });
      btn.addEventListener('click', saisir);
      document.body.appendChild(btn);
    } else if (!present && btn) {
      btn.remove();
    }
  }

  // L'appli change de "page" sans recharger : on revérifie régulièrement
  setInterval(ensureButton, 1000);
})();
