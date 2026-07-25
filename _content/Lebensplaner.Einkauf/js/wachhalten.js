// Bildschirm-Wachhalten im Einkaufsmodus „Im Laden" (US-209).
//
// Progressive Enhancement: Fehlt die Wake-Lock-API (älteres iOS-Safari vor
// 16.4) oder verweigert der Browser die Anforderung (Akku-Sparmodus, kein
// Vordergrund), passiert nichts Schlimmes — der Einkaufsmodus funktioniert ohne
// wachen Bildschirm weiter. Jeder Zugriff steht darum in try/catch; ein
// Fehlschlag wird bewusst geschluckt (der wache Bildschirm ist reine
// Zusatz-Bequemlichkeit, kein Kern).
//
// Kein Interop pro Frame (CLAUDE.md-Gesten-Prinzip sinngemäß): C# ruft nur
// aktivieren() beim Betreten und deaktivieren() beim Verlassen des Modus. Das
// Halten und Neu-Anfordern läuft komplett hier; C# erfährt kein Zwischenergebnis.
//
// Der Wake-Lock erlischt, sobald der Tab in den Hintergrund geht (Tabwechsel,
// Bildschirm aus, App-Wechsel). Solange der Modus aktiv ist, fordert ein
// visibilitychange-Listener ihn beim Zurückkehren in den Vordergrund erneut an —
// sonst bliebe der Bildschirm nach dem ersten Wegschalten dunkel.
//
// Wie indexeddb.js, gesten.js, dialog.js und die übrigen JS-Module erreicht
// diese Datei kein Unit-Test. Das echte Wach-Verhalten wird von Hand im Browser
// und am iPhone geprüft (CLAUDE.md).

// Modulzustand: den laufenden Screen gibt es genau einmal, das import()-Cache
// hält dieses Modul über die Sitzung, darum trägt es die Sperre hier.
let sperre = null;
let sichtbarkeitsListener = null;
// Ob der Modus gerade aktiv sein SOLL. Das Flag entscheidet den Wettlauf
// zwischen dem async visibilitychange-Reacquire und deaktivieren(): Hängt
// anfordern() im await, während deaktivieren() dazwischenfunkt, darf die frisch
// erhaltene Sperre nicht zugewiesen werden (sie hätte sonst keinen
// Freigabe-Pfad mehr) — sie wird sofort wieder freigegeben.
let aktiv = false;

async function anfordern() {
    if (!('wakeLock' in navigator)) {
        // Ältere Browser (iOS-Safari vor 16.4) kennen die API nicht — kein Fehler,
        // nur kein Wachhalten.
        return;
    }

    // Eine noch gehaltene alte Sperre vor dem Neuanfordern freigeben, damit sich
    // bei einem Reacquire keine zweite ansammelt.
    await freigeben();

    try {
        const neue = await navigator.wakeLock.request('screen');
        if (!aktiv) {
            // deaktivieren() lief, während dieser Aufruf im await hing — die
            // frische Sperre gehört niemandem mehr, also sofort zurückgeben.
            try {
                await neue.release();
            } catch {
                // Schon erloschen — nichts zu tun.
            }
            return;
        }
        sperre = neue;
    } catch {
        // Verweigert (z. B. Akku-Sparmodus) oder Seite nicht im Vordergrund — der
        // Modus läuft ohne Wachhalten weiter.
        sperre = null;
    }
}

async function freigeben() {
    if (sperre) {
        try {
            await sperre.release();
        } catch {
            // Schon erloschen (Tab war im Hintergrund) — dann gibt es nichts mehr
            // freizugeben.
        }
        sperre = null;
    }
}

export async function aktivieren() {
    aktiv = true;
    await anfordern();

    if (sichtbarkeitsListener) {
        // Schon aktiv (doppeltes Betreten) — nicht zweimal lauschen.
        return;
    }
    sichtbarkeitsListener = async () => {
        // Beim Zurückkehren in den Vordergrund ist eine zuvor gehaltene Sperre
        // erloschen — neu anfordern, solange der Modus aktiv ist.
        if (aktiv && document.visibilityState === 'visible') {
            await anfordern();
        }
    };
    document.addEventListener('visibilitychange', sichtbarkeitsListener);
}

export async function deaktivieren() {
    // Zuerst das Flag: Ein gerade im await hängendes anfordern() (Reacquire) sieht
    // danach `aktiv === false` und weist keine frische Sperre mehr zu.
    aktiv = false;

    if (sichtbarkeitsListener) {
        document.removeEventListener('visibilitychange', sichtbarkeitsListener);
        sichtbarkeitsListener = null;
    }
    await freigeben();
}
