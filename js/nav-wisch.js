// Wisch-/Snap-Geste der seitenweisen Hauptnavigation (US-116).
//
// Die Leiste ist ohne Wischen bereits vollständig bedienbar (US-115: Dots und
// Ziele antippen). Diese Datei ist reine Zugabe (Progressive Enhancement): Sie
// erlaubt, die Seiten mit dem Finger (oder der Maus) durchzublättern. Fällt sie
// aus, bleibt die Leiste über Dots und Ziele voll benutzbar.
//
// Das Ziehen läuft KOMPLETT hier, nie Frame für Frame durch C# (CLAUDE.md).
// Während der Geste bewegt dieses Modul die `.nav-spur` per inline
// `translateX`. C# erfährt nur das ERGEBNIS: genau ein Aufruf von
// `SeiteGelandet(seite)`, wenn die Geste auf einer NEUEN Seite landet — damit
// C# die Dot-Markierung und `aria-selected` nachzieht.
//
// Eigentumsverhältnis der Verschiebung (bewusst konfliktfrei geteilt):
//   * C# schreibt ausschließlich die CSS-Variable `--nav-x` auf der Spur
//     (Fallback ohne JS: `.nav-spur { transform: translateX(var(--nav-x)) }`).
//   * Dieses Modul schreibt ausschließlich das inline `transform` der Spur.
// Ein inline `transform` überschreibt die CSS-Regel — sobald dieses Modul aktiv
// ist, ist es die sichtbare Instanz; C#'s `--nav-x` bleibt harmlose Reserve.
// Beide fassen also NIE dieselbe Eigenschaft an und können sich nicht gegenseitig
// überschreiben.
//
// Dot-Klick und Ortswechsel laufen über C# → `zeigeSeite(viewport, i)`: C# hat
// die Zielseite selbst gesetzt (Dots/aria), dieses Modul fährt die Spur animiert
// dorthin. Kein Rückruf nötig — C# kennt die Seite schon.
//
// `prefers-reduced-motion`: kein Momentum (gibt es hier ohnehin nicht) und keine
// gleitende Transition — Letzteres erledigt die `@media`-Regel in schale.css, die
// die Transition der `.nav-spur` dann auf `none` setzt; das Schnappen springt
// dadurch sofort. `prefers-reduced-transparency` betrifft nur den deckenden
// Fallback der `.navleiste` (schale.css), nicht dieses Modul.
//
// Wie indexeddb.js, gesten.js und dialog.js erreicht diese Datei kein Unit-Test.
// Geprüft wird von Hand im Browser (siehe manuelle PR-Checks in der Story).

// Der linke Bildschirmrand gehört der iOS-„Zurück"-Systemgeste; ein Zug, der dort
// beginnt, wird nicht als Blättern gewertet (Auftrags-Leitplanke, wie gesten.js).
const RAND_AUSSCHLUSS = 24;

// Totzone, bis eine Richtung feststeht — verhindert, dass ein Tipp oder ein
// senkrechtes Scrollen schon als Blättern gilt.
const RICHTUNGS_SPERRE = 8;

// Snap-Schwelle: erst ab 18 % der Seitenbreite schnappt die Leiste zur
// Nachbarseite, darunter federt sie zur Ausgangsseite zurück (Referenz `w*0.18`).
const SNAP_ANTEIL = 0.18;

const gemerkt = new WeakMap();

export function aktivieren(viewport, spur, dotNetRef, startSeite) {
    const zustand = {
        idx: startSeite ?? 0,
        phase: 'ruhe',   // ruhe -> moeglich -> zieht | scrollt
        startX: 0,
        startY: 0,
        pointerId: null,
        breite: 0,
    };

    const seitenzahl = () => spur.children.length;
    const begrenze = (i) => Math.max(0, Math.min(seitenzahl() - 1, i));
    const setzeVersatz = (prozent) => { spur.style.transform = `translateX(${prozent}%)`; };

    // Fährt zur Seite i. Ohne `.zieht` greift die CSS-Transition (bzw. springt
    // unter prefers-reduced-motion sofort). Wird sowohl beim Snap als auch von
    // C# (Dot/Ortswechsel) über zeigeSeite() benutzt.
    const geheZu = (i) => {
        zustand.idx = begrenze(i);
        spur.classList.remove('zieht');
        setzeVersatz(-zustand.idx * 100);
    };

    const aufPointerDown = (ev) => {
        if (zustand.phase !== 'ruhe' || !ev.isPrimary) {
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
        zustand.breite = viewport.clientWidth;
    };

    const aufPointerMove = (ev) => {
        if (zustand.pointerId !== ev.pointerId) {
            return;
        }

        const dx = ev.clientX - zustand.startX;
        const dy = ev.clientY - zustand.startY;

        if (zustand.phase === 'moeglich') {
            if (Math.abs(dy) > RICHTUNGS_SPERRE && Math.abs(dy) >= Math.abs(dx)) {
                // Senkrecht gewinnt: Das ist Scrollen, nicht Blättern. touch-action:
                // pan-y erledigt das native Scrollen, wir rühren nichts an.
                zustand.phase = 'scrollt';
                return;
            }
            if (Math.abs(dx) >= RICHTUNGS_SPERRE && Math.abs(dx) > Math.abs(dy)) {
                zustand.phase = 'zieht';
                viewport.setPointerCapture(ev.pointerId);
                spur.classList.add('zieht'); // Transition aus — die Spur folgt dem Finger.
            } else {
                return;
            }
        }

        if (zustand.phase !== 'zieht') {
            return;
        }

        ev.preventDefault();
        const w = zustand.breite || viewport.clientWidth || 1;
        setzeVersatz(-zustand.idx * 100 + (dx / w) * 100);
    };

    const aufPointerEnde = (ev) => {
        if (zustand.pointerId !== ev.pointerId) {
            return;
        }

        const warZiehen = zustand.phase === 'zieht';
        if (warZiehen) {
            try {
                viewport.releasePointerCapture(ev.pointerId);
            } catch {
                // Schon losgelassen (z. B. nach pointercancel) — kein Problem.
            }
        }

        const dx = ev.clientX - zustand.startX;
        const w = zustand.breite || viewport.clientWidth || 1;
        const vorher = zustand.idx;

        zustand.phase = 'ruhe';
        zustand.pointerId = null;

        if (!warZiehen) {
            return;
        }

        let ziel = zustand.idx;
        if (dx < -w * SNAP_ANTEIL) {
            ziel = begrenze(zustand.idx + 1);
        } else if (dx > w * SNAP_ANTEIL) {
            ziel = begrenze(zustand.idx - 1);
        }

        // Schnappt zur Zielseite (oder federt zur Ausgangsseite zurück).
        geheZu(ziel);

        // C# erfährt nur das Ergebnis — und nur bei einem echten Seitenwechsel:
        // Beim Zurückfedern zur selben Seite ändert sich an Dots/aria nichts.
        if (ziel !== vorher) {
            dotNetRef.invokeMethodAsync('SeiteGelandet', ziel);
        }
    };

    const aufPointerCancel = (ev) => {
        if (zustand.pointerId !== ev.pointerId) {
            return;
        }

        const warZiehen = zustand.phase === 'zieht';
        zustand.phase = 'ruhe';
        zustand.pointerId = null;

        if (warZiehen) {
            // Abbruch (z. B. eingehender Anruf): zurück zur Ausgangsseite, kein Rückruf.
            geheZu(zustand.idx);
        }
    };

    viewport.addEventListener('pointerdown', aufPointerDown);
    viewport.addEventListener('pointermove', aufPointerMove, { passive: false });
    viewport.addEventListener('pointerup', aufPointerEnde);
    viewport.addEventListener('pointercancel', aufPointerCancel);

    // Ab jetzt übernimmt dieses Modul die sichtbare Verschiebung (inline transform).
    geheZu(zustand.idx);

    gemerkt.set(viewport, {
        aufPointerDown,
        aufPointerMove,
        aufPointerEnde,
        aufPointerCancel,
        geheZu,
    });
}

// Von C# gerufen (Dot-Klick, Ortswechsel): fährt animiert zur Zielseite. Kein
// Rückruf — C# hat die Seite selbst gesetzt (Dots/aria).
export function zeigeSeite(viewport, i) {
    const gemerktes = gemerkt.get(viewport);
    if (!gemerktes) {
        return;
    }
    gemerktes.geheZu(i);
}

export function deaktivieren(viewport) {
    const gemerktes = gemerkt.get(viewport);
    if (!gemerktes) {
        return;
    }

    viewport.removeEventListener('pointerdown', gemerktes.aufPointerDown);
    viewport.removeEventListener('pointermove', gemerktes.aufPointerMove);
    viewport.removeEventListener('pointerup', gemerktes.aufPointerEnde);
    viewport.removeEventListener('pointercancel', gemerktes.aufPointerCancel);
    gemerkt.delete(viewport);
}
