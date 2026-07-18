// Dialog/Sheet-Baustein (US-28): kapselt showModal()/close() — Blazor bindet
// das <dialog>-Element nicht direkt, das geht nur über JS-Interop.
//
// Ein Klick auf den Hintergrund schließt bewusst NICHT von selbst: Es gibt
// hier keinen Listener dafür. <dialog> tut das ohnehin nicht ungefragt — genau
// die Zurückhaltung, die die Story verlangt (kein impliziter Datenverlust bei
// ungespeicherten Eingaben).
//
// Escape löst nativ das 'close'-Ereignis aus; derselbe Weg wie ein
// Schließen-Knopf, der schliessen() ruft. Beide melden sich über genau dieses
// eine Ereignis an C# zurück — eine einzige Quelle, unabhängig davon, wie
// geschlossen wurde.
//
// US-59: Auf Handybreite (≤ 640 px, dort ist .lp-dialog ein Bottom-Sheet) kommt
// eine Swipe-nach-unten-Geste hinzu. Sie läuft KOMPLETT in JS/CSS — kein Interop
// pro Frame (CLAUDE.md „Gesten"). Über den Schwellwert hinaus gezogen, schließt
// sie über denselben element.close() → 'close'-Weg wie Escape/✕; darunter
// schnappt das Sheet zurück. C# erfährt nur das Ergebnis (das 'close'-Ereignis).

const gemerkterZustand = new WeakMap();

// Ab dieser Breite ist .lp-dialog ein von unten angedocktes Sheet — dieselbe
// Grenze wie die Media-Query in grundlage.css. Nur hier ist die Geste aktiv.
const HANDY_BREITE = '(max-width: 640px)';

// Kleine Totzone, damit ein Tipp/kurzes Wackeln nicht schon als Ziehen gilt.
const ZIEH_TOTZONE_PX = 8;

// Schwellwerte zum Schließen (F-24): Strecke ODER Geschwindigkeit. Startwerte,
// im Browser am Gerät feinjustierbar.
const STRECKE_MAX_PX = 120;
const GESCHWINDIGKEIT_PX_PRO_MS = 0.5;

// Sicherung, falls 'transitionend' ausbleibt (z. B. Transition abgebrochen).
const NACHLAUF_SICHERUNG_MS = 400;

function istHandy() {
    return window.matchMedia(HANDY_BREITE).matches;
}

function reduzierteBewegung() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function aktivieren(element, dotNetRef) {
    const zustand = {
        moeglich: false,
        zieht: false,
        startY: 0,
        startZeit: 0,
        imGriff: false,
        verschiebung: 0,
        nachlaufAufraeumen: null,
    };

    const aufSchliessen = () => {
        dotNetRef.invokeMethodAsync('Geschlossen');
    };

    const zustandZuruecksetzen = () => {
        zustand.moeglich = false;
        zustand.zieht = false;
        zustand.verschiebung = 0;
    };

    // Beendet einen laufenden Nachlauf-Übergang sofort (aufräumen), falls einer
    // aktiv war — sonst würde ein neuer Zug auf einem halb fertigen Übergang
    // aufsetzen.
    const nachlaufAbbrechen = () => {
        if (zustand.nachlaufAufraeumen) {
            zustand.nachlaufAufraeumen();
            zustand.nachlaufAufraeumen = null;
        }
    };

    const aufTouchStart = (ereignis) => {
        if (!istHandy() || ereignis.touches.length !== 1) {
            return;
        }

        nachlaufAbbrechen();

        const beruehrung = ereignis.touches[0];
        const imGriff = ereignis.target.closest('.lp-dialog__grabber, .lp-dialog__kopf') !== null;
        const inhalt = element.querySelector('.lp-dialog__inhalt');
        const amAnschlag = !inhalt || inhalt.scrollTop <= 0;

        // Im Griff-/Kopfbereich löst die Geste immer aus; im Inhalt nur, wenn er
        // bereits ganz oben steht — sonst gilt „Finger runter" als Scrollen (F-22).
        if (!imGriff && !amAnschlag) {
            return;
        }

        zustand.moeglich = true;
        zustand.zieht = false;
        zustand.imGriff = imGriff;
        zustand.startY = beruehrung.clientY;
        zustand.startZeit = ereignis.timeStamp;
        zustand.verschiebung = 0;
    };

    const aufTouchMove = (ereignis) => {
        if (!zustand.moeglich) {
            return;
        }

        const deltaY = ereignis.touches[0].clientY - zustand.startY;

        if (!zustand.zieht) {
            if (deltaY <= 0) {
                // Nach oben oder seitlich: keine Schließ-Geste. Im Inhaltsbereich
                // dem normalen Scrollen die Bewegung überlassen und aufgeben.
                if (!zustand.imGriff) {
                    zustand.moeglich = false;
                }
                return;
            }
            if (deltaY < ZIEH_TOTZONE_PX) {
                return;
            }
            zustand.zieht = true;
        }

        // Ab hier folgt das Sheet dem Finger — normales Scrollen unterbinden.
        ereignis.preventDefault();
        zustand.verschiebung = Math.max(0, deltaY);
        element.style.transform = `translateY(${zustand.verschiebung}px)`;
    };

    const aufTouchEnd = (ereignis) => {
        if (!zustand.moeglich || !zustand.zieht) {
            zustandZuruecksetzen();
            return;
        }

        const verschiebung = zustand.verschiebung;
        const dauer = ereignis.timeStamp - zustand.startZeit;
        const geschwindigkeit = dauer > 0 ? verschiebung / dauer : 0;
        const sheetHoehe = element.getBoundingClientRect().height;
        const streckenSchwelle = Math.min(sheetHoehe / 3, STRECKE_MAX_PX);

        const schliesst =
            verschiebung > streckenSchwelle ||
            geschwindigkeit > GESCHWINDIGKEIT_PX_PRO_MS;

        zustandZuruecksetzen();

        if (schliesst) {
            wegGleitenUndSchliessen();
        } else {
            zurueckSchnappen();
        }
    };

    const aufTouchCancel = () => {
        if (zustand.zieht) {
            zustandZuruecksetzen();
            zurueckSchnappen();
        } else {
            zustandZuruecksetzen();
        }
    };

    // Endübergang nach dem Loslassen. Bei reduzierter Bewegung springt das Sheet
    // ohne animiertes Nachlaufen direkt in seinen Endzustand (Planung, F/CLAUDE).
    const wegGleitenUndSchliessen = () => {
        if (reduzierteBewegung()) {
            element.style.transform = '';
            element.close();
            return;
        }
        nachlaufMitTransition('translateY(100%)', () => {
            element.style.transform = '';
            element.close();
        });
    };

    const zurueckSchnappen = () => {
        if (reduzierteBewegung()) {
            element.style.transform = '';
            return;
        }
        nachlaufMitTransition('translateY(0)', () => {
            element.style.transform = '';
        });
    };

    // Legt eine Transition auf transform, fährt zum Zielwert und ruft danach
    // (transitionend oder Sicherungs-Timeout) `abschluss`. Räumt Klasse/Listener
    // in jedem Fall genau einmal auf.
    const nachlaufMitTransition = (ziel, abschluss) => {
        element.classList.add('lp-dialog--nachlauf');
        // Reflow erzwingen, damit der Wechsel von der Ausgangs-Verschiebung zum
        // Ziel als Übergang gerendert wird und nicht zusammengefasst springt.
        void element.offsetHeight;
        element.style.transform = ziel;

        let erledigt = false;
        const fertig = () => {
            if (erledigt) {
                return;
            }
            erledigt = true;
            element.removeEventListener('transitionend', beiTransitionende);
            clearTimeout(sicherung);
            element.classList.remove('lp-dialog--nachlauf');
            zustand.nachlaufAufraeumen = null;
            abschluss();
        };
        const beiTransitionende = (ereignis) => {
            if (ereignis.propertyName === 'transform') {
                fertig();
            }
        };

        element.addEventListener('transitionend', beiTransitionende);
        const sicherung = setTimeout(fertig, NACHLAUF_SICHERUNG_MS);
        zustand.nachlaufAufraeumen = fertig;
    };

    element.addEventListener('close', aufSchliessen);
    element.addEventListener('touchstart', aufTouchStart, { passive: true });
    element.addEventListener('touchmove', aufTouchMove, { passive: false });
    element.addEventListener('touchend', aufTouchEnd, { passive: true });
    element.addEventListener('touchcancel', aufTouchCancel, { passive: true });

    zustand.aufSchliessen = aufSchliessen;
    zustand.aufTouchStart = aufTouchStart;
    zustand.aufTouchMove = aufTouchMove;
    zustand.aufTouchEnd = aufTouchEnd;
    zustand.aufTouchCancel = aufTouchCancel;
    zustand.nachlaufAbbrechen = nachlaufAbbrechen;
    gemerkterZustand.set(element, zustand);
}

export function oeffnen(element) {
    if (!element.open) {
        // Reste einer vorherigen Wisch-Geste zurücksetzen, damit die
        // Einfahr-Animation sauber von unten startet.
        element.style.transform = '';
        element.classList.remove('lp-dialog--nachlauf');
        element.showModal();
    }
}

export function schliessen(element) {
    if (element.open) {
        element.close();
    }
}

export function deaktivieren(element) {
    const zustand = gemerkterZustand.get(element);
    if (!zustand) {
        return;
    }

    if (zustand.nachlaufAbbrechen) {
        zustand.nachlaufAbbrechen();
    }

    element.removeEventListener('close', zustand.aufSchliessen);
    element.removeEventListener('touchstart', zustand.aufTouchStart);
    element.removeEventListener('touchmove', zustand.aufTouchMove);
    element.removeEventListener('touchend', zustand.aufTouchEnd);
    element.removeEventListener('touchcancel', zustand.aufTouchCancel);
    gemerkterZustand.delete(element);
}
