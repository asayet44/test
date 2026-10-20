// ==UserScript==
// @name         Examens types
// @namespace    saisie-rapide
// @version      2.2
// @description  Bouton Examen qui déplie des sous-boutons d'examens types, insérés dans le Commentaire
// @match        *://*/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/asayet44/test/main/pas/examens-types.user.js
// @downloadURL  https://raw.githubusercontent.com/asayet44/test/main/pas/examens-types.user.js
// ==/UserScript==

(function () {
  'use strict';

  /* =====================================================================
     EXAMENS TYPES — c'est la seule partie à modifier
     - "nom"   : texte affiché sur le sous-bouton
     - "texte" : ce qui est inséré dans le Commentaire (\n = retour à la ligne)
     ===================================================================== */
  const EXAMENS = [
    {
      nom: 'Cardio',
      texte: 'BDC réguliers, pas de souffle, pas de douleur thoracique, pas de signe d\'IC.',
    },
    {
      nom: 'Pneumo',
      texte: 'MV bilatéral symétrique, pas de bruit surajouté.',
    },
    {
      nom: 'Abdo',
      texte: 'Ventre souple dépressible, pas de défense. Pas de signe fonctionnel urinaire, pas de douleur à l\'ébranlement lombaire.',
    },
    {
      nom: 'ORL',
      texte: 'Pas d\'OMA. Pas d\'angine. Pas d\'adénopathie cervicale.',
    },
    {
      nom: 'Gastro',
      texte: 'Tableau évocateur d\'une gastro-entérite simple sans signe de gravité. Pas de signe de déshydratation. Bon état général. Ventre souple dépressible, pas de défense.',
    },
    {
      nom: 'Lumbago',
      texte: 'Lombalgie commune non déficitaire sans signe de gravité. Pas de syndrome de la queue de cheval. Pas de déficit moteur. Pas de déficit sensitif. Lasègue et Léri normaux. ROT L4 S1 normaux.',
    },
  ];

  const LIMITE = 1500; // nombre max de caractères du champ Commentaire

  // Écrit une valeur dans un champ de façon à ce que l'appli web la "voie"
  function setValue(el, v) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // Repère le champ Commentaire grâce à son texte d'aide
  function getCommentaire() {
    const champs = [...document.querySelectorAll('textarea, input')].filter(
      (el) => (el.placeholder || '').trim().startsWith('Commentaire')
    );
    // Le visible en priorité (celui de l'onglet affiché), sinon le premier trouvé comme en v1
    return champs.find((el) => el.offsetWidth > 0 || el.offsetHeight > 0) || champs[0];
  }

  // Onglet EXAM (à côté de ATCD et CAT) : l'élément le plus profond dont le texte est exactement "EXAM"
  function getOngletExam() {
    return [...document.querySelectorAll('body *')].find(
      (el) => el.children.length === 0 && el.textContent.trim() === 'EXAM'
    );
  }

  // Passe sur l'onglet EXAM puis lance l'action, le temps que l'appli affiche le bon champ
  function surOngletExam(action) {
    const onglet = getOngletExam();
    if (!onglet) return action();
    onglet.click();
    setTimeout(action, 300);
  }

  // Ajoute le texte à la suite de ce qui est déjà écrit (n'efface rien)
  function inserer(texte) {
    const champ = getCommentaire();
    if (!champ) {
      alert('Champ Commentaire introuvable sur cette page.');
      return;
    }
    const actuel = champ.value.trim();
    const nouveau = actuel ? actuel + '\n\n' + texte : texte; // ligne vide entre deux examens
    if (nouveau.length > LIMITE) {
      alert(`Trop long : ${nouveau.length}/${LIMITE} caractères. Texte non inséré.`);
      return;
    }
    setValue(champ, nouveau);
    champ.scrollIntoView({ block: 'center' });
  }

  // Style commun des boutons
  function styler(b, couleur) {
    Object.assign(b.style, {
      padding: '10px 14px', fontSize: '15px', borderRadius: '20px',
      border: 'none', background: couleur, color: '#fff',
      boxShadow: '0 2px 8px rgba(0,0,0,.3)', cursor: 'pointer', whiteSpace: 'nowrap',
    });
  }

  // Construit le bouton Examen + son menu de sous-boutons
  function creerInterface() {
    const conteneur = document.createElement('div');
    conteneur.id = 'sr-examens';
    Object.assign(conteneur.style, {
      position: 'fixed', right: '12px', bottom: '170px', zIndex: 99999,
      display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px',
    });

    // Menu (caché au départ)
    const menu = document.createElement('div');
    Object.assign(menu.style, {
      display: 'none', flexDirection: 'column', alignItems: 'flex-end', gap: '6px',
    });
    EXAMENS.forEach((ex) => {
      const sb = document.createElement('button');
      sb.textContent = ex.nom;
      styler(sb, '#6b8fd6');
      sb.addEventListener('click', () => {
        surOngletExam(() => inserer(ex.texte)); // le menu reste ouvert pour enchaîner
      });
      menu.appendChild(sb);
    });

    // Bouton principal : ouvre / ferme le menu
    const principal = document.createElement('button');
    principal.textContent = '🩺 Examen';
    styler(principal, '#2e5fb8');
    principal.style.padding = '12px 16px';
    principal.style.fontSize = '16px';
    principal.addEventListener('click', () => {
      menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
    });

    conteneur.appendChild(menu);      // menu au-dessus
    conteneur.appendChild(principal); // bouton en dessous
    document.body.appendChild(conteneur);
  }

  // Affiche l'interface seulement quand le champ Commentaire est présent
  function ensureButton() {
    const present = !!getCommentaire();
    const ui = document.getElementById('sr-examens');
    if (present && !ui) creerInterface();
    else if (!present && ui) ui.remove();
  }

  // L'appli change de "page" sans recharger : on revérifie régulièrement
  setInterval(ensureButton, 1000);
})();
