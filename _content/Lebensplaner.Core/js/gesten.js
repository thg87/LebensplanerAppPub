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

const SCHWELLE_MORGEN = 72;
const SCHWELLE_ERLEDIGT = 144;
const SPERRE_RICHTUNG = 10;
const RAND_AUSSCHLUSS = 24;

const gemerkteListener = new WeakMap();

export function aktivieren(karte, dotNetRef) {
    const zustand = { phase: 'ruhe', startX: 0, startY: 0, pointerId: null, versatz: 0 };

    const zuruecksetzen = () => {
        zustand.phase = 'ruhe';
        zustand.pointerId = null;
        zustand.versatz = 0;
        karte.classList.remove('wisch--zieht', 'wisch--morgen', 'wisch--erledigt');
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

        const betrag = Math.abs(zustand.versatz);
        karte.classList.toggle('wisch--morgen', betrag >= SCHWELLE_MORGEN && betrag < SCHWELLE_ERLEDIGT);
        karte.classList.toggle('wisch--erledigt', betrag >= SCHWELLE_ERLEDIGT);
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

        if (betrag >= SCHWELLE_ERLEDIGT) {
            dotNetRef.invokeMethodAsync('Ausgeloest', 'erledigt');
        } else if (betrag >= SCHWELLE_MORGEN) {
            dotNetRef.invokeMethodAsync('Ausgeloest', 'morgen');
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
