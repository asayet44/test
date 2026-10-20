// ==UserScript==
// @name         Examens types (bêta)
// @namespace    saisie-rapide-beta
// @version      1.0
// @description  Bêta : examens découpés en morceaux cliquables, insérés à la suite dans le Commentaire d'EXAM
// @match        https://somenor.net/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/asayet44/test/main/pas/examens-beta.user.js
// @downloadURL  https://raw.githubusercontent.com/asayet44/test/main/pas/examens-beta.user.js
// ==/UserScript==

(function () {
  'use strict';

  /* =====================================================================
     EXAMENS TYPES — chaque morceau entre deux points ou deux virgules
     devient un bouton.
     shortcut: copie des textes du script principal, à fusionner si la bêta est adoptée
     ===================================================================== */
  const EXAMENS = [
    { nom: 'Cardio', texte: 'BDC réguliers, pas de souffle, pas de douleur thoracique, pas de signe d\'IC.' },
    { nom: 'Pneumo', texte: 'MV bilatéral symétrique, pas de bruit surajouté.' },
    { nom: 'Abdo', texte: 'Ventre souple dépressible, pas de défense. Pas de signe fonctionnel urinaire, pas de douleur à l\'ébranlement lombaire.' },
    { nom: 'ORL', texte: 'Pas d\'OMA. Pas d\'angine. Pas d\'adénopathie cervicale.' },
    { nom: 'Gastro', texte: 'Tableau évocateur d\'une gastro-entérite simple sans signe de gravité. Pas de signe de déshydratation. Bon état général. Ventre souple dépressible, pas de défense.' },
    { nom: 'Lumbago', texte: 'Lombalgie commune non déficitaire sans signe de gravité. Pas de syndrome de la queue de cheval. Pas de déficit moteur. Pas de déficit sensitif. Lasègue et Léri normaux. ROT L4 S1 normaux.' },
  ];

  const LIMITE = 1500;

  // "A, b. C" -> ["A.", "B.", "C."] : chaque morceau commence par une majuscule et finit par un point
  function decouper(texte) {
    return texte.split(/[.,]/)
      .map((m) => m.trim())
      .filter(Boolean)
      .map((m) => m[0].toUpperCase() + m.slice(1) + '.');
  }

  /* ===== Champ Commentaire de l'onglet EXAM ===== */
  function setValue(el, v) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function getCommentaire() {
    const champs = [...document.querySelectorAll('textarea, input')].filter(
      (el) => (el.placeholder || '').trim().startsWith('Commentaire')
    );
    return champs.find((el) => el.offsetWidth > 0 || el.offsetHeight > 0) || champs[0];
  }

  function surOngletExam(action) {
    const onglet = [...document.querySelectorAll('body *')].find(
      (el) => el.children.length === 0 && el.textContent.trim() === 'EXAM'
    );
    if (!onglet) return action();
    onglet.click();
    setTimeout(action, 150);
  }

  // Ajoute à la suite, séparé d'un simple espace ; renvoie false si rien n'a été inséré
  function inserer(texte) {
    const champ = getCommentaire();
    if (!champ) { alert('Champ Commentaire introuvable.'); return false; }
    const actuel = champ.value.trim();
    const nouveau = actuel ? actuel + ' ' + texte : texte;
    if (nouveau.length > LIMITE) {
      alert(`Trop long : ${nouveau.length}/${LIMITE} caractères. Texte non inséré.`);
      return false;
    }
    setValue(champ, nouveau);
    return true;
  }

  /* ===== Style : animations douces et réponse immédiate au toucher ===== */
  const css = document.createElement('style');
  css.textContent = `
    #sr-beta { position: fixed; left: 12px; bottom: 170px; z-index: 99999;
      display: flex; flex-direction: column; align-items: flex-start; gap: 8px; font-family: sans-serif; }
    #sr-beta button { touch-action: manipulation; -webkit-tap-highlight-color: transparent;
      border: none; border-radius: 20px; padding: 10px 14px; font-size: 15px; color: #fff;
      background: #6b8fd6; box-shadow: 0 2px 6px rgba(0,0,0,.25); cursor: pointer;
      transition: transform .12s ease, background-color .2s ease, opacity .2s ease; }
    #sr-beta button:active { transform: scale(.93); }
    #sr-beta .principal { background: #7a4fd6; font-size: 16px; padding: 12px 16px; }
    #sr-beta .retour { background: #888; }
    #sr-beta .tout { background: #2e5fb8; }
    #sr-beta .fait { background: #2e9e5b; }
    #sr-beta .panneau { display: flex; flex-wrap: wrap; gap: 6px; max-width: 80vw; max-height: 50vh;
      overflow-y: auto; padding: 8px; border-radius: 16px; background: rgba(255,255,255,.92);
      box-shadow: 0 4px 14px rgba(0,0,0,.25);
      transition: opacity .18s ease, transform .18s ease; transform-origin: bottom left; }
    #sr-beta .panneau.cache { opacity: 0; transform: translateY(8px) scale(.97); pointer-events: none; }
  `;

  function bouton(texte, classe, action) {
    const b = document.createElement('button');
    b.textContent = texte;
    if (classe) b.className = classe;
    b.addEventListener('click', action);
    return b;
  }

  /* ===== Interface ===== */
  function creerInterface() {
    document.head.appendChild(css);
    const racine = document.createElement('div');
    racine.id = 'sr-beta';
    const panneau = document.createElement('div');
    panneau.className = 'panneau cache';

    // Écran 1 : la liste des examens
    function afficherListe() {
      panneau.replaceChildren(...EXAMENS.map((ex) => bouton(ex.nom, '', () => afficherExamen(ex))));
    }

    // Écran 2 : les morceaux d'un examen ; un morceau inséré passe au vert
    function afficherExamen(ex) {
      const morceaux = decouper(ex.texte).map((m) =>
        bouton(m, '', (e) => surOngletExam(() => { if (inserer(m)) e.target.classList.add('fait'); }))
      );
      const tout = bouton('Tout', 'tout', (e) => surOngletExam(() => {
        if (inserer(decouper(ex.texte).join(' '))) {
          e.target.classList.add('fait');
          morceaux.forEach((b) => b.classList.add('fait'));
        }
      }));
      panneau.replaceChildren(bouton('← ' + ex.nom, 'retour', afficherListe), tout, ...morceaux);
    }

    const principal = bouton('🧪 Examen β', 'principal', () => {
      if (panneau.classList.toggle('cache')) return;
      afficherListe(); // on repart toujours de la liste à l'ouverture
    });

    racine.append(panneau, principal);
    document.body.appendChild(racine);
  }

  // Apparition dès que la page change, sans attendre une vérification à la seconde
  function ensureButton() {
    const present = !!getCommentaire();
    const ui = document.getElementById('sr-beta');
    if (present && !ui) creerInterface();
    else if (!present && ui) ui.remove();
  }
  new MutationObserver(ensureButton).observe(document.documentElement, { childList: true, subtree: true });
  ensureButton();
})();
