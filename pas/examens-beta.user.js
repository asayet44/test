// ==UserScript==
// @name         Examens types (bêta)
// @namespace    saisie-rapide-beta
// @version      1.6
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
     ===================================================================== */
  const EXAMENS = [
    { nom: 'Général', texte: 'Pas de signe de déshydratation. Bon état général.' },
    // onglet: 'CAT' -> écrit dans le Commentaire de l'onglet CAT (par défaut : EXAM)
    { nom: 'CAT', onglet: 'CAT', texte: 'Consigne d\'urgence donnée et comprise par le patient. Consigne de revoir son médecin traitant. Traitement symptomatique.' },
    { nom: 'Cardio', texte: 'BDC réguliers, pas de souffle, pas de douleur thoracique, pas de signe d\'IC.' },
    { nom: 'Pneumo', texte: 'MV bilatéral symétrique, pas de bruit surajouté.' },
    { nom: 'Abdo', texte: 'Ventre souple dépressible, pas de défense. Pas de signe fonctionnel urinaire, pas de douleur à l\'ébranlement lombaire.' },
    { nom: 'ORL', morceaux: ['Pas d\'OMA.', 'Pas d\'angine.', 'Pas d\'adénopathie cervicale.', 'Angine.', 'Streptatest +.', 'Streptatest -.', 'Adénopathies cervicales.', 'Fièvre.', 'Difficulté à l\'alimentation.', 'Alimentation conservée.'] },
    { nom: 'Gastro', texte: 'Tableau évocateur d\'une gastro-entérite simple sans signe de gravité. Pas de signe de déshydratation. Bon état général. Ventre souple dépressible, pas de défense.' },
    { nom: 'Lumbago', texte: 'Lombalgie commune non déficitaire sans signe de gravité. Pas de syndrome de la queue de cheval. Pas de déficit moteur. Pas de déficit sensitif. Lasègue et Léri normaux. ROT L4 S1 normaux.' },
    { nom: 'Oeil', texte: 'Orgelet simple sans signe de gravité. Chalazion simple sans signe de gravité. Pas de BAV. Pas de lésion cornée. Pas de rougeur.' },
    // morceaux : liste donnée telle quelle, quand une virgule ne doit pas couper le bouton en deux
    { nom: 'Uro', morceaux: ['Cystite simple sans signe de gravité.', 'BU normale.', 'BU leucocytes, nitrite et sang +.', 'Pas de douleur à l\'ébranlement lombaire.', 'Pas de SFU.', 'SFU +.'] },
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

  // Passe sur l'onglet voulu (EXAM ou CAT), puis agit une fois le bon Commentaire affiché
  function surOnglet(nom, action) {
    const onglet = [...document.querySelectorAll('body *')].find(
      (el) => el.children.length === 0 && el.textContent.trim() === nom
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

  const estPresent = (texte) => !!getCommentaire()?.value.includes(texte);

  // Supprime la dernière occurrence de chaque morceau, avec l'espace qui le séparait du reste
  function retirer(textes) {
    const champ = getCommentaire();
    if (!champ) return;
    let v = champ.value;
    for (const t of textes) {
      let debut = v.lastIndexOf(t);
      if (debut < 0) continue;
      let fin = debut + t.length;
      if (v[debut - 1] === ' ') debut--;
      else if (v[fin] === ' ') fin++;
      v = v.slice(0, debut) + v.slice(fin);
    }
    setValue(champ, v);
  }

  /* ===== Style : animations douces et réponse immédiate au toucher ===== */
  const css = document.createElement('style');
  css.textContent = `
    #sr-beta { position: fixed; right: 12px; bottom: 170px; z-index: 99999;
      display: flex; flex-direction: column; align-items: flex-end; gap: 8px; font-family: sans-serif; }
    #sr-beta button { touch-action: manipulation; -webkit-tap-highlight-color: transparent;
      border: none; border-radius: 20px; padding: 10px 14px; font-size: 15px; color: #fff;
      background: #6b8fd6; box-shadow: 0 2px 6px rgba(0,0,0,.25); cursor: pointer;
      transition: transform .12s ease, background-color .2s ease, opacity .2s ease; }
    #sr-beta button:active { transform: scale(.93); }
    #sr-beta .principal { background: #7a4fd6; font-size: 16px; padding: 12px 16px; }
    #sr-beta .retour { background: #888; }
    #sr-beta .tout { background: #2e5fb8; }
    #sr-beta .fait { background: #2e9e5b; }
    #sr-beta .retire { background: #d64545; }
    #sr-beta .panneau { display: flex; flex-wrap: wrap; gap: 6px; max-width: 80vw; max-height: 50vh;
      overflow-y: auto; padding: 8px; border-radius: 16px; background: rgba(255,255,255,.92);
      box-shadow: 0 4px 14px rgba(0,0,0,.25);
      transition: opacity .18s ease, transform .18s ease; transform-origin: bottom right; }
    #sr-beta .panneau.cache { opacity: 0; transform: translateY(8px) scale(.97); }
    /* La zone invisible autour des boutons laisse passer les touchers vers PAS */
    #sr-beta { pointer-events: none; }
    #sr-beta button, #sr-beta .panneau { pointer-events: auto; }
    #sr-beta .panneau.cache, #sr-beta .panneau.cache button { pointer-events: none; }
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

    // Rouge un instant pour montrer la suppression, puis retour à la couleur normale
    function flashRouge(boutons) {
      boutons.forEach((b) => b.classList.add('retire'));
      setTimeout(() => boutons.forEach((b) => b.classList.remove('retire')), 600);
    }

    // Écran 2 : les morceaux d'un examen. Vert = présent dans le Commentaire ;
    // un appui sur un bouton vert retire le morceau.
    function afficherExamen(ex) {
      const surOngletExam = (action) => surOnglet(ex.onglet || 'EXAM', action);
      const textes = ex.morceaux || decouper(ex.texte);
      const morceaux = textes.map((m) => bouton(m, '', () => surOngletExam(() => {
        if (estPresent(m)) { retirer([m]); flashRouge([b(m)]); } else inserer(m);
        rafraichir();
      })));
      const b = (m) => morceaux[textes.indexOf(m)];
      const tout = bouton('Tout', 'tout', () => surOngletExam(() => {
        const manquants = textes.filter((m) => !estPresent(m));
        if (manquants.length) inserer(manquants.join(' '));
        else { retirer(textes); flashRouge([tout, ...morceaux]); }
        rafraichir();
      }));
      // La couleur suit le texte réellement présent, même après fermeture du panneau
      function rafraichir() {
        textes.forEach((m) => b(m).classList.toggle('fait', estPresent(m)));
        tout.classList.toggle('fait', textes.every(estPresent));
      }
      panneau.replaceChildren(bouton('← ' + ex.nom, 'retour', afficherListe), tout, ...morceaux);
      surOngletExam(rafraichir); // les couleurs se lisent dans le Commentaire du bon onglet
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
  // Une seule vérification par image affichée, pas à chaque petite modification de la page
  let prevu = false;
  const planifier = () => {
    if (prevu) return;
    prevu = true;
    requestAnimationFrame(() => { prevu = false; ensureButton(); });
  };
  new MutationObserver(planifier).observe(document.documentElement, { childList: true, subtree: true });
  ensureButton();
})();
