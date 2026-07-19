// Abschluss-Animationen (US-154): drei dezente, kurze Rückmeldungen beim
// Abschließen einer Aktion — ein gezeichneter Haken, ein Neon-Aufleuchten, ein
// Glas-Ripple. Reine Darstellung: dieses Modul kennt keine Fachlogik, ruft keinen
// Dienst, ändert keine Daten. Angestoßen wird es aus C# über GENAU EIN Ereignis
// (abspielen), nie Frame für Frame (CLAUDE.md: Animieren gehört in JS/CSS, C#
// erfährt nur das Ergebnis/den Anstoß).
//
// Wie indexeddb.js/gesten.js/dialog.js erreicht diese Datei keinen Unit-Test —
// geprüft wird die C#-Naht (Abschlussanimation) und von Hand im Browser (Optik,
// prefers-reduced-motion, schnelles Wiederauslösen).
//
// Aufräumen wie dialog.js/gesten.js: jede laufende Animation wird über einen
// WeakMap-Eintrag gemerkt und räumt sich selbst ab — bei 'animationend' ODER,
// falls das ausbleibt (Element vorzeitig entfernt, Animation unterbrochen), über
// einen Sicherungs-Timeout. Ein erneutes Auslösen auf demselben Element bricht
// die vorige zuerst ab: nichts staut oder überlagert sich (AC4). deaktivieren()
// gibt einer Wirt-Komponente den Weg, eine noch laufende Animation beim
// Verschwinden abzuräumen (DisposeAsync).

const laufende = new WeakMap();

const EFFEKTE = new Set(['haken', 'neon', 'ripple']);

// Länger als die längste Animation (~300 ms). Nur Fallback: Bleibt 'animationend'
// aus, räumt dieser Timeout ab.
const SICHERUNG_MS = 600;

// Der statische Ersatz bei reduzierter Bewegung liegt kurz an und geht wieder.
const STATISCH_MS = 320;

const HAKEN_SVG =
    '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true">' +
    '<path pathLength="1" d="M13 24.5 L21 32.5 L35 16" ' +
    'stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

function reduzierteBewegung() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function abspielen(element, effekt) {
    if (!element || !EFFEKTE.has(effekt)) {
        return;
    }

    // Kein Stapeln: eine noch laufende Rückmeldung auf diesem Element zuerst weg.
    abbrechen(element);

    if (reduzierteBewegung()) {
        spieleStatisch(element);
        return;
    }

    // Die Overlay-Schicht liegt absolut über dem Element. Ist das Element selbst
    // nicht positioniert, wäre der Bezugsrahmen ein entfernterer Vorfahr — dann
    // machen wir es für die Dauer der Animation zum Bezugsrahmen. position:relative
    // verschiebt nichts im Layout (kein Sprung, AC5).
    const warStatisch = getComputedStyle(element).position === 'static';
    if (warStatisch) {
        element.classList.add('lp-anim-wirt');
    }

    const schicht = document.createElement('span');
    schicht.className = `lp-anim lp-anim--${effekt}`;
    schicht.setAttribute('aria-hidden', 'true');
    if (effekt === 'haken') {
        schicht.innerHTML = HAKEN_SVG;
    }

    const eintrag = { aufraeumen: null };

    let fertig = false;
    let sicherung = 0;
    const aufraeumen = () => {
        if (fertig) {
            return;
        }
        fertig = true;
        clearTimeout(sicherung);
        schicht.removeEventListener('animationend', beiAnimationsende);
        schicht.remove();
        if (warStatisch) {
            element.classList.remove('lp-anim-wirt');
        }
        // Nur löschen, wenn seither nichts Neues gestartet ist — sonst räumte ein
        // Nachzügler den frischen Eintrag ab.
        if (laufende.get(element) === eintrag) {
            laufende.delete(element);
        }
    };

    const beiAnimationsende = (ereignis) => {
        // 'animationend' blubbert: Beim Haken meldet auch der zeichnende SVG-Pfad.
        // Nur das Ende der Overlay-Schicht selbst (deren Container-Animation bzw.
        // der ::before-Ripple) räumt ab — sonst schnitte der Pfad sich selbst ab.
        if (ereignis.target === schicht) {
            aufraeumen();
        }
    };

    eintrag.aufraeumen = aufraeumen;
    laufende.set(element, eintrag);

    schicht.addEventListener('animationend', beiAnimationsende);
    sicherung = setTimeout(aufraeumen, SICHERUNG_MS);
    element.appendChild(schicht);
}

// Reduzierte Bewegung: kein Overlay, keine Animation — nur ein kurzer, unbewegter
// Zustandswechsel (statischer Akzent-Umriss, in grundlage.css). Genauso über die
// WeakMap gemerkt, damit abbrechen()/erneutes Auslösen ihn sauber zurücknimmt.
function spieleStatisch(element) {
    element.classList.add('lp-anim-statisch');

    const eintrag = { aufraeumen: null };
    let fertig = false;
    const aufraeumen = () => {
        if (fertig) {
            return;
        }
        fertig = true;
        clearTimeout(zeit);
        element.classList.remove('lp-anim-statisch');
        if (laufende.get(element) === eintrag) {
            laufende.delete(element);
        }
    };
    const zeit = setTimeout(aufraeumen, STATISCH_MS);

    eintrag.aufraeumen = aufraeumen;
    laufende.set(element, eintrag);
}

function abbrechen(element) {
    const eintrag = laufende.get(element);
    if (eintrag && eintrag.aufraeumen) {
        eintrag.aufraeumen();
    }
}

// Aufräum-Weg für eine Wirt-Komponente, deren Element verschwindet (Muster
// dialog.js/gesten.js). Deckungsgleich mit dem internen Abbruch — der eigene
// Name macht den Zweck an der Aufrufstelle (DisposeAsync) klar.
export function deaktivieren(element) {
    abbrechen(element);
}
