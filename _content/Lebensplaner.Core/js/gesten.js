// Wischgesten auf Dashboard-Karten (US-25).
//
// Liegt in Core, nicht in App: US-36 (F-A) braucht die Geste auch in der
// Raum-Detailansicht des Moduls Haushalt, und Haushalt darf nicht nach App
// (Abhängigkeitstabelle in CLAUDE.md). Ursprünglich in App, weil bis dahin
// kein Modul sie brauchte — diese Prämisse ist mit US-36 falsch geworden.
//
// Das Ziehen selbst läuft komplett hier, nie Frame für Frame durch C#
// (CLAUDE.md). Erst wenn eine Geste abgeschlossen ist, meldet dieses Modul
// GENAU EIN Ereignis an die Komponente ("erledigt"/"morgen") — C# tut den
// Rest über denselben Weg wie die Knöpfe.
//
// Nur nach links wischen löst etwas aus (F-16): Die iOS-Zurück-Geste braucht
// eine Bewegung nach rechts, beginnend am linken Bildschirmrand. Wer nur auf
// Linksbewegungen reagiert, kollidiert mit ihr grundsätzlich nicht — dazu
// kommt ein Ausschluss-Streifen am Rand als zweite, unabhängige Sicherung.
// Ob das am echten Gerät wirklich reibungslos ist, entscheidet erst US-26;
// kein Desktop-Browser kennt die iOS-Systemgeste.
//
// Wie indexeddb.js, datei.js, installation.js und aktualisierung.js erreicht
// diese Datei kein Unit-Test. Geprüft wird von Hand im Browser (Schwellen,
// Zurückfedern, Scroll-Zusammenspiel) und am Ende auf dem iPhone (F-16, US-26).
//
// US-244 hat einen ZWEITEN Aufrufer gebracht (die Abhak-Zeile der Routinen) und
// dafür GENAU EINE Zustandsmaschine gelassen: `starten` unten. Verschieden sind
// nur zwei Dinge — die STUFEN (wie weit wofür) und WOHIN gemeldet wird. Beides
// steht als Parameter, alles andere (Richtungssperre, Randausschluss, Maus-
// Ausschluss, Zurückfedern, Aufräumen) teilen sich beide Aufrufer. Eine zweite
// Datei mit einer zweiten Kopie dieser Logik wäre die Sorte Verdopplung, die
// beim ersten Nachbessern auseinanderläuft — und geprüft werden kann sie nur im
// Browser, also fiele das niemandem auf.

const SCHWELLE_MORGEN = 72;
const SCHWELLE_ERLEDIGT = 144;
const SPERRE_RICHTUNG = 10;
const RAND_AUSSCHLUSS = 24;

// Die zweistufige Dashboard-Karte (US-25): weit = erledigt, halb weit = morgen.
// Absteigend sortiert — `starten` nimmt die erste Stufe, die der Versatz erreicht.
const STUFEN_KARTE = [
    { ab: SCHWELLE_ERLEDIGT, aktion: 'erledigt' },
    { ab: SCHWELLE_MORGEN, aktion: 'morgen' },
];

// Die einstufige Abhak-Zeile (US-244): NUR erledigt, und zwar bei DERSELBEN
// Weite wie auf der Karte. Das ist die Zusage aus dem Akzeptanzkriterium — eine
// Geste, nicht zwei: gleiche Richtung, gleiche Strecke, gleiche Wirkung. Unter
// SCHWELLE_MORGEN bis SCHWELLE_ERLEDIGT passiert hier bewusst NICHTS; dass das
// kein Defekt ist, sieht man daran, dass auch nichts aufleuchtet (dieselbe
// Regel wie auf der Karte: sichtbar wird eine Stufe erst, wenn sie greift).
const STUFEN_ZEILE = [
    { ab: SCHWELLE_ERLEDIGT, aktion: 'erledigt' },
];

const gemerkteListener = new WeakMap();

/**
 * Die zweistufige Dashboard-Karte (US-25/US-36): meldet `Ausgeloest(aktion)` an
 * die Komponente, die genau EINE Karte vertritt.
 */
export function aktivieren(karte, dotNetRef) {
    starten(karte, STUFEN_KARTE, aktion => dotNetRef.invokeMethodAsync('Ausgeloest', aktion));
}

/**
 * Die einstufige Abhak-Zeile (US-244): meldet `Ausgeloest(aktion, kennung)`.
 *
 * Die KENNUNG ist der Unterschied zur Karte und kein Beiwerk: Dort vertritt der
 * .NET-Verweis genau eine Karte, hier vertritt EIN Verweis (der Screen) ALLE
 * Zeilen. Ohne sie käme am Screen zwar „erledigt" an, aber nicht, WELCHE Zeile
 * gewischt wurde — und er hakte die erstbeste ab. Sie wird beim Aktivieren
 * festgelegt und ist damit an dasselbe Element gebunden wie die Listener.
 */
export function aktivierenNurErledigt(zeile, dotNetRef, kennung) {
    starten(zeile, STUFEN_ZEILE, aktion => dotNetRef.invokeMethodAsync('Ausgeloest', aktion, kennung));
}

function starten(karte, stufen, melden) {
    const zustand = { phase: 'ruhe', startX: 0, startY: 0, pointerId: null, versatz: 0 };

    // Aus 'erledigt' wird 'wisch--erledigt': Der Klassenname folgt der Aktion,
    // damit „welche Stufe greift" und „was sieht man" nicht zwei Listen sind.
    const klassen = stufen.map(stufe => `wisch--${stufe.aktion}`);

    // Welche Stufe bei diesem Versatz greift — oder `undefined`. Die Stufen sind
    // absteigend geordnet, also gewinnt die weiteste erreichte.
    const stufeFuer = betrag => stufen.find(stufe => betrag >= stufe.ab);

    const zuruecksetzen = () => {
        zustand.phase = 'ruhe';
        zustand.pointerId = null;
        zustand.versatz = 0;
        karte.classList.remove('wisch--zieht', ...klassen);
        karte.style.removeProperty('--wisch-versatz');
    };

    const aufPointerDown = (ev) => {
        if (!ev.isPrimary || ev.pointerType === 'mouse') {
            // Nur ein Finger, keine Maus: Ziehen mit der Maus hat niemand
            // bestellt, die Knöpfe reichen dort.
            return;
        }
        if (karte.dataset.gesperrt === 'true') {
            // Dieselbe Sperre wie die Knöpfe (_arbeitet): Ein Schreibvorgang
            // läuft, eine zweite Aktion würde auf einem Stand rechnen, den es
            // gleich nicht mehr gibt.
            return;
        }
        if (ev.clientX < RAND_AUSSCHLUSS) {
            // Der linke Rand bleibt der iOS-Zurück-Geste vorbehalten.
            return;
        }

        zustand.phase = 'moeglich';
        zustand.startX = ev.clientX;
        zustand.startY = ev.clientY;
        zustand.pointerId = ev.pointerId;
    };

    const aufPointerMove = (ev) => {
        if (zustand.pointerId !== ev.pointerId) {
            return;
        }

        const dx = ev.clientX - zustand.startX;
        const dy = ev.clientY - zustand.startY;

        if (zustand.phase === 'moeglich') {
            if (Math.abs(dy) > SPERRE_RICHTUNG && Math.abs(dy) >= Math.abs(dx)) {
                // Senkrecht gewinnt: Das ist Scrollen, keine Geste. Wir lassen
                // los und rühren nichts an — touch-action: pan-y erledigt den
                // Rest nativ.
                zustand.phase = 'scrollt';
                return;
            }
            if (dx <= -SPERRE_RICHTUNG && Math.abs(dx) > Math.abs(dy)) {
                zustand.phase = 'zieht';
                karte.setPointerCapture(ev.pointerId);
                karte.classList.add('wisch--zieht');
            } else {
                // Weder eindeutig senkrecht noch eindeutig eine Linksbewegung
                // (z. B. nach rechts) — abwarten, das ist nicht unsere Geste.
                return;
            }
        }

        if (zustand.phase !== 'zieht') {
            return;
        }

        ev.preventDefault();
        zustand.versatz = Math.min(0, dx); // nur nach links, nie darüber hinaus nach rechts
        karte.style.setProperty('--wisch-versatz', `${zustand.versatz}px`);

        const erreicht = stufeFuer(Math.abs(zustand.versatz));
        stufen.forEach((stufe, i) => karte.classList.toggle(klassen[i], stufe === erreicht));
    };

    const aufPointerEnde = (ev) => {
        if (zustand.pointerId !== ev.pointerId) {
            return;
        }

        const warAmZiehen = zustand.phase === 'zieht';
        if (warAmZiehen) {
            try {
                karte.releasePointerCapture(ev.pointerId);
            } catch {
                // Schon losgelassen (z. B. nach pointercancel) — kein Problem.
            }
        }

        const betrag = Math.abs(zustand.versatz);
        zuruecksetzen();

        if (!warAmZiehen) {
            return;
        }

        const erreicht = stufeFuer(betrag);

        if (erreicht) {
            melden(erreicht.aktion);
        }
        // Unter der ersten Schwelle: nichts. Die Karte ist schon zurückgefedert.
    };

    karte.addEventListener('pointerdown', aufPointerDown);
    karte.addEventListener('pointermove', aufPointerMove, { passive: false });
    karte.addEventListener('pointerup', aufPointerEnde);
    karte.addEventListener('pointercancel', aufPointerEnde);

    gemerkteListener.set(karte, { aufPointerDown, aufPointerMove, aufPointerEnde });
}

export function deaktivieren(karte) {
    const gemerkt = gemerkteListener.get(karte);
    if (!gemerkt) {
        return;
    }

    karte.removeEventListener('pointerdown', gemerkt.aufPointerDown);
    karte.removeEventListener('pointermove', gemerkt.aufPointerMove);
    karte.removeEventListener('pointerup', gemerkt.aufPointerEnde);
    karte.removeEventListener('pointercancel', gemerkt.aufPointerEnde);
    gemerkteListener.delete(karte);
}
